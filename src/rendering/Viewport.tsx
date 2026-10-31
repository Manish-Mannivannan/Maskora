"use client";

/**
 * The 3D viewport (architecture §2.4, §7.5).
 *
 * Camera and light never compete for one drag: in camera mode OrbitControls
 * own the pointer (left orbit, right pan, wheel zoom); in Move Light mode the
 * controls are disabled and a drag edits the light's azimuth and elevation.
 * The environment is built in the scene from light panels, so no HDR file or
 * remote preset is ever fetched (§3.3); it can be turned about the vertical.
 *
 * The scene shows a leaf (front and optional back) or a spread (left and
 * right), each page at its physical size, with materials built from the same
 * shared finish jobs the registration view uses. Without a document it shows
 * a blank A4 placeholder.
 *
 * The current camera position and light angles are mirrored onto the
 * container's data attributes so a native smoke run can observe what a drag
 * actually changed.
 */
import { Environment, Lightformer, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from "react";
import * as THREE from "three";
import { usePageSummaries, pageName } from "@/features/document/usePages";
import { frameOf } from "@/finish/pipeline";
import { useFinish, type FinishState } from "@/finish/useFinish";
import { FINISH_NAMES, pageKey, surfaceFor, type PrintSurface } from "@/project/model";
import { useProject } from "@/project/ProjectContext";
import type { FinishLook } from "./finishMaterial";
import { faceGeometry, fitDistance, leafPlacements, sizesDiffer, spreadPlacements } from "./layout";
import { dragLight, lightDirection, type LightAngles } from "./lighting";
import { Face, SceneProbe, StockEdge, type FaceInput, type FaceName, type ReliefStats } from "./PageScene";

export type InteractionMode = "camera" | "light";
export type CameraPreset = "reset" | "fit" | "front" | "back" | "low";

export interface ViewportProps {
  mode: InteractionMode;
  light: LightAngles;
  intensity: number;
  onLightChange: (next: LightAngles) => void;
  /** Incremented to apply `kind`. */
  camera: { kind: CameraPreset; n: number };
  /** Environment rotation about the vertical, degrees. */
  environmentDeg: number;
}

// A blank A4 page in metres, shown until a document is open.
const PAGE: [number, number] = [0.21, 0.297];
const LIGHT_DISTANCE = 1.2;
// The gizmo sits close to the page along the light direction so it stays in the default view.
const GIZMO_DISTANCE = 0.15;
const CAMERA_START: [number, number, number] = [0, 0.05, 0.62];
const FOV = 40;

const round = (v: number) => Math.round(v * 1000) / 1000;

/** The surfaces the 3D view shows, resolved from explicit choices and the panel selection. */
function useSlots(): {
  layout: "page" | "spread";
  a: PrintSurface | null;
  b: PrintSurface | null;
  names: [FaceName, FaceName];
} {
  const [{ model, view, selected }] = useProject();
  const find = (id: string | null) => model.surfaces.find((s) => s.id === id) ?? null;
  const selectedKey = selected ? pageKey(selected) : null;
  // A selected page that is not a print surface is still shown, as plain artwork at its trim size.
  const followed = useMemo<PrintSurface | null>(() => {
    if (!selected) return null;
    return surfaceFor(model, selected) ?? { id: `page:${selectedKey}`, artwork: selected, box: "TrimBox" };
    // Stable identity per selected page, so its finish job is not re-keyed on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, model.surfaces]);
  if (view.layout === "spread")
    return {
      layout: "spread",
      a: find(model.scene.left),
      b: find(model.scene.right),
      names: ["left", "right"],
    };
  return {
    layout: "page",
    a: find(model.scene.front) ?? followed,
    b: find(model.scene.back),
    names: ["front", "back"],
  };
}

export default function Viewport({
  mode,
  light,
  intensity,
  onLightChange,
  camera,
  environmentDeg,
}: ViewportProps) {
  const [{ model, view, sources }] = useProject();
  const summaries = usePageSummaries();
  const container = useRef<HTMLDivElement>(null);
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const sun = useRef<THREE.DirectionalLight>(null);
  const drag = useRef<{ x: number; y: number; start: LightAngles } | null>(null);
  const [aspect, setAspect] = useState(1.5);

  const slots = useSlots();
  // How each face draws raised UV, as the faces report it, for the status line.
  const [relief, setRelief] = useState<Partial<Record<FaceName, ReliefStats>>>({});
  const reportRelief = useCallback(
    (name: FaceName, stats: ReliefStats | null) =>
      setRelief((prev) =>
        prev[name] === (stats ?? undefined) ? prev : { ...prev, [name]: stats ?? undefined },
      ),
    [],
  );
  const finishA = useFinish(slots.a);
  const finishB = useFinish(slots.b);
  const thicknessM = model.stock.thicknessMm / 1000;

  const look = useMemo<FinishLook>(
    () => ({
      recipes: model.recipes,
      stock: model.stock,
      show: view.show,
      printOnly: view.printOnly,
      raisedMode: view.raisedMode,
    }),
    [model.recipes, model.stock, view.show, view.printOnly, view.raisedMode],
  );

  const faces = useMemo(() => {
    const build = (surface: PrintSurface | null, finish: FinishState, name: FaceName) => {
      const result = finish.status === "ready" || finish.status === "rendering" ? finish.result : null;
      const summary = surface && summaries.get(pageKey(surface.artwork));
      const frame = summary && surface && frameOf(summary, surface.box);
      if (!result || !frame || !summary) return null;
      return {
        name,
        result,
        anchor: frame.anchor,
        userUnit: summary.userUnit,
        geometry: faceGeometry(result.plan, frame.anchor, result.pxPerMm),
      };
    };
    const a = build(slots.a, finishA, slots.names[0]);
    const b = build(slots.b, finishB, slots.names[1]);
    const out: FaceInput[] = [];
    if (slots.layout === "page") {
      const p = leafPlacements(thicknessM);
      if (a) out.push({ ...a, placement: p.front });
      if (b) out.push({ ...b, placement: p.back });
    } else if (a && b) {
      const p = spreadPlacements(a.geometry.size, b.geometry.size, thicknessM);
      out.push({ ...a, placement: p.left }, { ...b, placement: p.right });
    }
    return out;
  }, [slots.a, slots.b, slots.layout, slots.names, finishA, finishB, summaries, thicknessM]);

  // The area to fit: the leaf, or both pages of the spread.
  const bounds: [number, number] = faces.length
    ? slots.layout === "spread"
      ? [
          faces[0].geometry.size[0] + (faces[1]?.geometry.size[0] ?? 0),
          Math.max(...faces.map((f) => f.geometry.size[1])),
        ]
      : [Math.max(...faces.map((f) => f.geometry.size[0])), Math.max(...faces.map((f) => f.geometry.size[1]))]
    : PAGE;
  const fitKey = `${slots.layout}|${slots.a?.id}|${slots.b?.id}|${bounds.map((v) => v.toFixed(4)).join("x")}`;

  const direction = useMemo(() => lightDirection(light), [light]);
  const lightPos = direction.map((v) => v * LIGHT_DISTANCE) as [number, number, number];

  const recordCamera = () => {
    const cam = controls.current?.object;
    if (cam && container.current)
      container.current.dataset.camera = JSON.stringify(cam.position.toArray().map(round));
  };

  const place = (kind: CameraPreset) => {
    const c = controls.current;
    if (!c) return;
    if (kind === "reset" && !faces.length) {
      c.reset();
      recordCamera();
      return;
    }
    // Margin leaves room for the status line along the bottom.
    const d = fitDistance(bounds[0], bounds[1], FOV, aspect, 1.3);
    c.target.set(0, 0, 0);
    if (kind === "low") {
      // Low along the page from below, to judge relief silhouettes and shadows.
      const a = (6 * Math.PI) / 180;
      c.object.position.set(0, -Math.cos(a) * d * 0.8, Math.sin(a) * d * 0.8);
    } else c.object.position.set(0, 0, kind === "back" ? -d : d);
    c.update();
    recordCamera();
  };

  useEffect(() => {
    if (container.current) container.current.dataset.light = JSON.stringify(light);
  }, [light]);

  useEffect(() => {
    // The fitted shadow bounds take effect only once the shadow camera's projection is rebuilt.
    sun.current?.shadow.camera.updateProjectionMatrix();
  }, []);

  useEffect(() => {
    if (camera.n > 0) place(camera.kind);
    // Applied when a preset is requested, with the bounds of that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera.n]);

  useEffect(() => {
    // New content (another page, layout or size) is framed from the front.
    if (faces.length) place("front");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) =>
      setAspect(e.contentRect.width / Math.max(1, e.contentRect.height)),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // What the view says about itself: pages shown, finish status, warnings.
  const name = (s: PrintSurface | null) =>
    s ? `${pageName(sources, summaries, s.artwork)} (${s.box.replace("Box", "")})` : "—";
  const notes: { code: string; text: string }[] = [];
  if (slots.layout === "spread" && (!slots.a || !slots.b))
    notes.push({ code: "spreadIncomplete", text: "Choose the left and right printed pages in View." });
  if (faces.length === 2 && sizesDiffer(faces[0].geometry.size, faces[1].geometry.size))
    notes.push({
      code: "unequalSizes",
      text: `The ${slots.layout === "spread" ? "two pages" : "front and back"} differ in size (${faces
        .map(
          (f) => `${(f.geometry.size[0] * 1000).toFixed(1)} × ${(f.geometry.size[1] * 1000).toFixed(1)} mm`,
        )
        .join(" and ")}); each is shown at its own size.`,
    });
  for (const f of [finishA, finishB])
    if (f.status === "failed") notes.push({ code: "renderFailed", text: f.message });
  const busy = [finishA, finishB].some((f) => f.status === "rendering");
  const hasRaised = faces.some((f) => f.result.maps.raisedUv.some((v) => v > 0));
  const shownRelief = faces.map((f) => relief[f.name]).filter((s): s is ReliefStats => !!s);
  for (const s of shownRelief) {
    if (s.fallback)
      notes.push({
        code: "reliefFallback",
        text: `${FINISH_NAMES.raisedUv} drawn with surface normals instead of geometry: ${s.fallback}.`,
      });
    else if (s.mode === "mesh" && (s.step ?? 1) > 1)
      notes.push({
        code: "reliefSimplified",
        text: `${FINISH_NAMES.raisedUv} geometry simplified to 1/${s.step} resolution (${s.triangles.toLocaleString("en")} triangles) to stay within the triangle budget.`,
      });
  }
  const raisedText = !hasRaised
    ? ""
    : view.raisedMode === "mesh" && shownRelief.some((s) => s.mode === "mesh")
      ? `${FINISH_NAMES.raisedUv}: approximate coating geometry — it casts shadows on the page but does not receive them, and its height profile is an adjustable approximation.`
      : `${FINISH_NAMES.raisedUv}: approximate — surface normals only, so its edges catch light but it has no true height silhouette or cast shadow.`;

  return (
    <div
      ref={container}
      className="viewport"
      data-testid="viewport"
      data-mode={mode}
      data-faces={faces.map((f) => f.name).join(",")}
      data-busy={busy}
      data-environment={environmentDeg}
      style={{ cursor: mode === "light" ? "crosshair" : "grab" }}
      onPointerDown={(e) => {
        if (mode !== "light" || e.button !== 0) return;
        (e.target as Element).setPointerCapture?.(e.pointerId);
        drag.current = { x: e.clientX, y: e.clientY, start: light };
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        onLightChange(dragLight(drag.current.start, e.clientX - drag.current.x, e.clientY - drag.current.y));
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
    >
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: CAMERA_START, fov: FOV, near: 0.01, far: 20 }}
        gl={{ preserveDrawingBuffer: true }}
        onCreated={({ gl }) => {
          // Neutral tone mapping keeps the artwork's colours, where the default filmic curve shifts them.
          gl.toneMapping = THREE.NeutralToneMapping;
          recordCamera();
        }}
      >
        <color attach="background" args={["#1d1f22"]} />
        <ambientLight intensity={0.05} />
        <directionalLight
          ref={sun}
          position={lightPos}
          intensity={intensity}
          castShadow
          // Shadows fitted to the page area, so a texel is about 0.1 mm and a coating's shadow can show.
          shadow-mapSize={[4096, 4096]}
          shadow-camera-left={-0.25}
          shadow-camera-right={0.25}
          shadow-camera-top={0.25}
          shadow-camera-bottom={-0.25}
          shadow-camera-near={0.5}
          shadow-camera-far={2}
          shadow-bias={-0.00002}
          shadow-normalBias={0.00005}
        />
        {/* The light gizmo: where the light sits, shown in both modes. */}
        <mesh position={direction.map((v) => v * GIZMO_DISTANCE) as [number, number, number]}>
          <sphereGeometry args={[0.012, 16, 16]} />
          <meshBasicMaterial color={mode === "light" ? "#ffd166" : "#8a8f98"} />
        </mesh>
        {faces.length ? (
          <>
            {faces.map((f) => (
              <Face key={f.name} input={f} look={look} onRelief={reportRelief} />
            ))}
            {slots.layout === "page" ? (
              <StockEdge
                size={faces[0].geometry.size}
                position={[0, 0, 0]}
                thicknessM={thicknessM}
                roughness={model.stock.roughness}
              />
            ) : (
              faces.map((f) => (
                <StockEdge
                  key={`edge-${f.name}`}
                  size={f.geometry.size}
                  position={f.placement.position}
                  thicknessM={thicknessM}
                  roughness={model.stock.roughness}
                />
              ))
            )}
          </>
        ) : (
          <mesh castShadow receiveShadow position={[0, 0, 0.002]}>
            <planeGeometry args={PAGE} />
            <meshPhysicalMaterial color="#f4f1ea" roughness={0.55} clearcoat={0} />
          </mesh>
        )}
        <mesh receiveShadow position={[0, 0, -0.02]}>
          <planeGeometry args={[3, 3]} />
          <shadowMaterial transparent opacity={0.25} />
        </mesh>
        <Environment
          resolution={256}
          frames={1}
          environmentRotation={[0, (environmentDeg * Math.PI) / 180, 0]}
        >
          <Lightformer form="rect" intensity={1.5} position={[0, 2, 2]} scale={[3, 1, 1]} />
          <Lightformer
            form="rect"
            intensity={0.6}
            position={[-2.5, 0.5, 1]}
            rotation-y={Math.PI / 2}
            scale={[2, 1, 1]}
          />
          <Lightformer
            form="rect"
            intensity={0.4}
            position={[2.5, 0.5, 1]}
            rotation-y={-Math.PI / 2}
            scale={[2, 1, 1]}
          />
          {/* Soft fill from behind, so the back of a leaf can be inspected from behind. */}
          <Lightformer
            form="rect"
            intensity={0.8}
            position={[0, 1, -2]}
            rotation-y={Math.PI}
            scale={[3, 1, 1]}
          />
        </Environment>
        <OrbitControls
          ref={controls}
          enabled={mode === "camera"}
          makeDefault
          enableDamping={false}
          minDistance={0.05}
          maxDistance={3}
          onChange={recordCamera}
        />
        <SceneProbe />
      </Canvas>
      {faces.length || notes.length ? (
        <div className="scene-hud" data-testid="scene-hud">
          <p>
            {slots.layout === "page" ? (
              <>
                Front: {name(slots.a)} · Back: {name(slots.b)}
              </>
            ) : (
              <>
                Left: {name(slots.a)} · Right: {name(slots.b)}
              </>
            )}
            {busy ? " · updating finishes…" : ""}
            {view.printOnly ? " · print only" : ""}
          </p>
          <p className="muted">
            {FINISH_NAMES.uv}: implemented as a masked clearcoat. {raisedText}
          </p>
          {notes.map((n) => (
            <p key={n.code} className="scene-note" data-code={n.code}>
              {n.text}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
