"use client";

/**
 * Page faces in the 3D scene (architecture §7.5). Each face is a plane at
 * physical size whose material is built from the shared finish result; the
 * stock's edge is a thin box behind the faces. Owned textures, geometries and
 * materials are disposed when replaced or unmounted.
 *
 * `SceneProbe` publishes a read-only `window.__maskora.scene` for the native
 * smoke: it samples a face's coverage by casting a ray through the real mesh
 * at a trim-relative point and reading the texture the material was built
 * from at the hit's texture coordinates, and reports texture counts. It
 * changes nothing.
 */
import { useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { RegistrationResult } from "@/finish/pipeline";
import { latestOnly } from "@/finish/jobs";
import type { BoundedRelief, ReliefShape } from "@/finish/reliefMesh";
import { buildReliefOffThread } from "@/finish/reliefWorker";
import type { FinishRecipe } from "@/project/model";
import { mmPerUnit, toDevice, type Rect } from "@/pdf/transform";
import {
  artworkTexture,
  coatDigest,
  coatTexture,
  faceMaterial,
  reliefTexture,
  type FinishLook,
} from "./finishMaterial";
import { localFromUv, planeUvs, type FaceGeometry, type Placement } from "./layout";

export type FaceName = "front" | "back" | "left" | "right";

export interface FaceInput {
  name: FaceName;
  result: RegistrationResult;
  geometry: FaceGeometry;
  /** The surface's box in the artwork page's user space, and that page's UserUnit. */
  anchor: Rect;
  userUnit: number;
  placement: Placement;
}

/** What drawing raised UV cost on this face, and how it was drawn. */
export interface ReliefStats {
  mode: "normals" | "mesh";
  /** Time to build the normal map or the mesh, ms. */
  ms: number;
  /** GPU-side bytes: the RGBA normal map, or vertex positions, normals, UVs and indices. */
  bytes: number;
  triangles: number;
  vertices: number;
  shapes: ReliefShape[];
  /** Mesh only: raster step it was built at (1 = full resolution) to stay within the triangle budget. */
  step?: number;
  /** Triangles a full-resolution mesh was estimated to need. */
  estimated?: number;
  /** Set when the mesh could not be built within budget and normals were drawn instead. */
  fallback?: string;
  /** The recipe the relief was built from, so a stale build can be recognised. */
  profile: { heightUm: number; bevelMm: number; crownUm: number };
}

interface FaceEntry {
  input: FaceInput;
  mesh: THREE.Mesh;
  coat: THREE.DataTexture;
  relief: THREE.DataTexture | null;
  material: THREE.MeshPhysicalMaterial;
  stats: ReliefStats | null;
}

/** The raised-UV normal map and how long it took to build. */
function timedReliefTexture(result: RegistrationResult, recipe: FinishRecipe) {
  const t0 = performance.now();
  const texture = reliefTexture(result, recipe);
  return { texture, ms: performance.now() - t0 };
}

const profileOf = (r: FinishRecipe) => ({ heightUm: r.heightUm, bevelMm: r.bevelMm, crownUm: r.crownUm });

interface Coating {
  /** The raster it was built from: shown only on the page it belongs to. */
  result: RegistrationResult;
  geometry: THREE.BufferGeometry | null;
  stats: ReliefStats;
}

/**
 * The coating mesh in face-local metres, within the triangle budget, with the
 * intended surface's normals. Null geometry means the budget could not be met
 * without losing shapes; the stats then say why.
 */
function coatingGeometry(
  result: RegistrationResult,
  geo: FaceGeometry,
  recipe: FinishRecipe,
  bounded: BoundedRelief,
  ms: number,
): Coating {
  const { width, height } = result.maps;
  const m = bounded.mesh;
  const base = { ms, step: bounded.step, estimated: bounded.estimated, profile: profileOf(recipe) };
  if (!m)
    return {
      result,
      geometry: null,
      stats: {
        mode: "mesh",
        ...base,
        bytes: 0,
        triangles: 0,
        vertices: 0,
        shapes: [],
        fallback: bounded.reason,
      },
    };
  const pos = new Float32Array(m.vertices * 3);
  const uv = new Float32Array(m.vertices * 2);
  for (let i = 0; i < m.vertices; i += 1) {
    const u = (m.positions[i * 3] + 0.5) / width;
    const v = (m.positions[i * 3 + 1] + 0.5) / height;
    const [x, y] = localFromUv(geo, u, v);
    // Lifted a hair above the face so the zero-height rim does not fight the page's depth.
    pos.set([x, y, m.positions[i * 3 + 2] * 1e-6 + 2e-6], i * 3);
    uv.set([u, v], i * 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  // The intended surface's normals (x right, y up, z out: the face's own axes), not the triangles'.
  g.setAttribute("normal", new THREE.BufferAttribute(m.normals, 3));
  // Raster y runs down and face-local y up, which mirrors the triangles: reverse each one so it faces the viewer.
  const indices = new Uint32Array(m.indices.length);
  for (let t = 0; t < m.indices.length; t += 3)
    indices.set([m.indices[t], m.indices[t + 2], m.indices[t + 1]], t);
  g.setIndex(new THREE.BufferAttribute(indices, 1));
  return {
    result,
    geometry: g,
    stats: {
      mode: "mesh",
      ...base,
      bytes: m.vertices * (12 + 12 + 8) + m.indices.length * 4,
      triangles: m.triangles,
      vertices: m.vertices,
      shapes: m.shapes,
    },
  };
}

const faces = new Map<FaceName, FaceEntry>();

/** Delay before rebuilding the coating, so a dragged control rebuilds once, after it settles. */
const COATING_DEBOUNCE_MS = 200;

export function Face({
  input,
  look,
  onRelief,
}: {
  input: FaceInput;
  look: FinishLook;
  /** Told how raised UV is drawn on this face (mode, simplification, fallback). */
  onRelief?: (name: FaceName, stats: ReliefStats | null) => void;
}) {
  const mesh = useRef<THREE.Mesh>(null);
  const { result, geometry: geo, placement } = input;
  const raisedRecipe = look.recipes.raisedUv;
  const hasRaised = useMemo(() => result.maps.raisedUv.some((v) => v > 0), [result]);
  const meshMode = look.raisedMode === "mesh" && !look.printOnly && look.show.raisedUv && hasRaised;

  // The coating mesh is built after edits settle and replaced when ready; the previous one stays meanwhile.
  const [coating, setCoating] = useState<Coating | null>(null);
  const latest = useRef(latestOnly<{ result: BoundedRelief; ms: number }>());
  useEffect(() => {
    if (!meshMode) return;
    let live = true;
    const timer = setTimeout(() => {
      // Built in a worker so a detailed mask never freezes the window; an answer for older settings is ignored.
      const { raisedUv, width, height } = result.maps;
      latest
        .current(buildReliefOffThread(raisedUv, width, height, result.pxPerMm, profileOf(raisedRecipe)))
        .then(
          (r) => {
            if (live && r.current)
              setCoating(coatingGeometry(result, geo, raisedRecipe, r.value.result, r.value.ms));
          },
          () => undefined,
        );
    }, COATING_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [meshMode, result, geo, raisedRecipe]);
  useEffect(() => () => coating?.geometry?.dispose(), [coating]);
  // Only a coating built from this page's raster is drawn: never the previous page's.
  const current = meshMode && coating?.result === result ? coating : null;
  const fallback = current?.stats.fallback !== undefined;

  // Normals: the chosen mode, or the fallback when a mesh could not be built within budget.
  const needNormals = hasRaised && (look.raisedMode === "normals" || fallback);
  const timedRelief = useMemo(
    () => (needNormals ? timedReliefTexture(result, raisedRecipe) : null),
    [needNormals, result, raisedRecipe],
  );
  const relief = timedRelief?.texture ?? null;

  const artwork = useMemo(() => artworkTexture(result), [result]);
  const coatingMaterial = useMemo(
    () =>
      current?.geometry
        ? new THREE.MeshPhysicalMaterial({
            map: artwork,
            roughness: look.stock.roughness,
            clearcoat: raisedRecipe.strength,
            clearcoatRoughness: 1 - raisedRecipe.gloss,
          })
        : null,
    [current, artwork, look.stock.roughness, raisedRecipe],
  );
  const coat = useMemo(
    () => coatTexture(result, { recipes: look.recipes, show: look.show }),
    [result, look.recipes, look.show],
  );
  const faceLook = useMemo(
    () => (fallback ? { ...look, raisedMode: "normals" as const } : look),
    [look, fallback],
  );
  const material = useMemo(
    () => faceMaterial(artwork, coat, relief, faceLook),
    [artwork, coat, relief, faceLook],
  );
  const plane = useMemo(() => {
    const g = new THREE.PlaneGeometry(geo.size[0], geo.size[1]);
    g.setAttribute("uv", new THREE.BufferAttribute(planeUvs(geo), 2));
    return g;
  }, [geo]);

  useEffect(() => () => artwork.dispose(), [artwork]);
  useEffect(() => () => relief?.dispose(), [relief]);
  useEffect(() => () => coat.dispose(), [coat]);
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => () => plane.dispose(), [plane]);
  useEffect(() => () => coatingMaterial?.dispose(), [coatingMaterial]);

  const stats = useMemo<ReliefStats | null>(() => {
    if (current && !fallback) return current.stats;
    if (!relief || !timedRelief) return null;
    return {
      mode: "normals",
      ms: timedRelief.ms,
      bytes: result.maps.width * result.maps.height * 4,
      triangles: 0,
      vertices: 0,
      shapes: [],
      profile: profileOf(raisedRecipe),
      ...(fallback ? { fallback: current?.stats.fallback } : {}),
    };
  }, [current, fallback, relief, timedRelief, result.maps.width, result.maps.height, raisedRecipe]);

  useEffect(() => {
    onRelief?.(input.name, stats);
  }, [onRelief, input.name, stats]);

  useEffect(() => {
    const node = mesh.current;
    if (!node) return;
    faces.set(input.name, { input, mesh: node, coat, relief, material, stats });
    return () => {
      if (faces.get(input.name)?.mesh === node) faces.delete(input.name);
    };
  }, [input, coat, relief, material, stats]);

  return (
    <group position={placement.position} rotation-y={placement.turn}>
      <mesh
        ref={mesh}
        name={`face-${input.name}`}
        geometry={plane}
        material={material}
        castShadow
        receiveShadow
      />
      {current?.geometry && coatingMaterial ? (
        <mesh
          name={`coating-${input.name}`}
          geometry={current.geometry}
          material={coatingMaterial}
          // Casts onto the page; receiving would shadow itself, being thinner than the shadow biases.
          castShadow
        />
      ) : null}
    </group>
  );
}

/** The stock seen edge-on: a thin box just inside the faces. */
export function StockEdge({
  size,
  position,
  thicknessM,
  roughness,
}: {
  size: [number, number];
  position: [number, number, number];
  thicknessM: number;
  roughness: number;
}) {
  return (
    <mesh position={[position[0], position[1], 0]} castShadow receiveShadow>
      <boxGeometry args={[size[0] * 0.999, size[1] * 0.999, thicknessM * 0.98]} />
      <meshStandardMaterial color="#efece4" roughness={roughness} />
    </mesh>
  );
}

declare global {
  interface Window {
    __maskora?: { cspViolations: string[]; scene?: SceneProbeApi };
  }
}

export interface FaceSample {
  hit: boolean;
  /** Texture coordinates the ray hit, and those the point should have. */
  hitUv: [number, number] | null;
  expectedUv: [number, number];
  /** Coverage 0–255 read from the material's own coat texture at the hit. */
  uv: number;
  raisedUv: number;
  /** Clearcoat amount actually applied there (0 when print-only or hidden). */
  coat: number;
  /** Relief normal there, or null without raised UV. */
  normal: [number, number, number] | null;
}

export interface SceneProbeApi {
  faces(): {
    name: FaceName;
    digest: string;
    sizeMm: [number, number];
    clearcoat: number;
    relief: boolean;
    stats: ReliefStats | null;
  }[];
  sample(name: FaceName, pointsMm: [number, number][]): FaceSample[];
  project(name: FaceName, pointMm: [number, number]): [number, number] | null;
  memory(): { textures: number; geometries: number };
  /** Shadow settings actually in effect, for diagnosing relief shadows. */
  shadows(): {
    enabled: boolean;
    lights: { castShadow: boolean; frustum: number[]; mapSize: number[]; hasMap: boolean }[];
  };
}

/** Raster (u, v) of a point given in mm from the face box's lower-left corner. */
function uvOf(input: FaceInput, [mx, my]: [number, number]): [number, number] {
  const k = mmPerUnit(input.userUnit);
  const [x, y] = toDevice(input.result.plan, [input.anchor[0] + mx / k, input.anchor[1] + my / k]);
  return [x / input.result.plan.width, y / input.result.plan.height];
}

function worldPoint(entry: FaceEntry, pointMm: [number, number]) {
  const [u, v] = uvOf(entry.input, pointMm);
  const [lx, ly] = localFromUv(entry.input.geometry, u, v);
  return { uv: [u, v] as [number, number], world: entry.mesh.localToWorld(new THREE.Vector3(lx, ly, 0)) };
}

export function SceneProbe() {
  const { camera, gl, size, scene } = useThree();
  useEffect(() => {
    window.__maskora ??= { cspViolations: [] };
    const raycaster = new THREE.Raycaster();
    window.__maskora.scene = {
      faces: () =>
        [...faces.values()].map((e) => ({
          name: e.input.name,
          digest: coatDigest(e.coat),
          sizeMm: [e.input.geometry.size[0] * 1000, e.input.geometry.size[1] * 1000],
          clearcoat: e.material.clearcoat,
          relief: e.material.normalMap !== null,
          stats: e.stats,
        })),
      sample: (name, points) => {
        const entry = faces.get(name);
        if (!entry) return [];
        const normal = new THREE.Vector3(0, 0, 1).transformDirection(entry.mesh.matrixWorld);
        const coat = entry.coat.image as { data: Uint8Array; width: number; height: number };
        const relief = entry.relief?.image as { data: Uint8Array } | undefined;
        return points.map((p) => {
          const { uv, world } = worldPoint(entry, p);
          // Cast along the face's own normal, so the check does not depend on where the camera is.
          raycaster.set(world.clone().addScaledVector(normal, 0.05), normal.clone().negate());
          const hit = raycaster.intersectObject(entry.mesh, false)[0];
          if (!hit?.uv)
            return { hit: false, hitUv: null, expectedUv: uv, uv: 0, raisedUv: 0, coat: 0, normal: null };
          const x = Math.min(coat.width - 1, Math.floor(hit.uv.x * coat.width));
          const y = Math.min(coat.height - 1, Math.floor(hit.uv.y * coat.height));
          const i = (y * coat.width + x) * 4;
          return {
            hit: true,
            hitUv: [hit.uv.x, hit.uv.y],
            expectedUv: uv,
            uv: coat.data[i + 3],
            raisedUv: coat.data[i + 2],
            coat: entry.material.clearcoat ? coat.data[i] : 0,
            normal:
              relief && entry.material.normalMap
                ? [relief.data[i], relief.data[i + 1], relief.data[i + 2]]
                : null,
          };
        });
      },
      project: (name, pointMm) => {
        const entry = faces.get(name);
        if (!entry) return null;
        const p = worldPoint(entry, pointMm).world.project(camera);
        return [((p.x + 1) / 2) * size.width, ((1 - p.y) / 2) * size.height];
      },
      memory: () => ({ textures: gl.info.memory.textures, geometries: gl.info.memory.geometries }),
      shadows: () => {
        const lights: THREE.DirectionalLight[] = [];
        scene.traverse((o) => {
          if ((o as THREE.DirectionalLight).isDirectionalLight) lights.push(o as THREE.DirectionalLight);
        });
        return {
          enabled: gl.shadowMap.enabled,
          lights: lights.map((l) => {
            const c = l.shadow.camera;
            return {
              castShadow: l.castShadow,
              frustum: [c.left, c.right, c.top, c.bottom, c.near, c.far],
              mapSize: [l.shadow.mapSize.x, l.shadow.mapSize.y],
              hasMap: l.shadow.map !== null,
            };
          }),
        };
      },
    };
    return () => {
      if (window.__maskora) delete window.__maskora.scene;
    };
  }, [camera, gl, size, scene]);
  return null;
}
