"use client";

/**
 * The scene one canvas draws, shared by the live viewport and the still
 * export (architecture §7.5, §9.4): which surfaces are shown, their faces at
 * physical size, the stock edge, the light and the built-in environment. The
 * export renders this same component offscreen from a frozen snapshot, so a
 * still cannot differ from the view in anything but framing, size and
 * background. Interface aids (the light gizmo) are passed in by the viewport
 * and never reach an export.
 */
import { Environment, Lightformer } from "@react-three/drei";
import { useMemo, type ReactNode, type Ref } from "react";
import * as THREE from "three";
import type { PageSummary } from "@/project/facts";
import { pageKey, surfaceFor, type PageRef, type PrintSurface, type ProjectModel } from "@/project/model";
import type { CameraPose, Lighting } from "@/project/projectFile";
import type { ViewState } from "@/project/store";
import { frameOf } from "@/finish/pipeline";
import type { FinishState } from "@/finish/useFinish";
import type { FinishLook } from "./finishMaterial";
import { faceGeometry, fitDistance, leafPlacements, spreadPlacements } from "./layout";
import { lightDirection } from "./lighting";
import {
  Face,
  StockEdge,
  type FaceInput,
  type FaceName,
  type FaceRegistry,
  type ReliefStats,
} from "./PageScene";

/** A blank A4 page in metres, shown until a document is open. */
export const PAGE: [number, number] = [0.21, 0.297];
export const LIGHT_DISTANCE = 1.2;
export const FOV = 40;
export const VIEWPORT_BACKGROUND = "#1d1f22";

export interface Slots {
  layout: "page" | "spread";
  a: PrintSurface | null;
  b: PrintSurface | null;
  names: [FaceName, FaceName];
}

/** The surfaces a view shows, resolved from explicit choices and the panel selection. */
export function useSlots(
  model: ProjectModel,
  view: Pick<ViewState, "layout">,
  selected: PageRef | null,
): Slots {
  const selectedKey = selected ? pageKey(selected) : null;
  // A selected page that is not a print surface is still shown, as plain artwork at its trim size.
  const followed = useMemo<PrintSurface | null>(() => {
    if (!selected) return null;
    return surfaceFor(model, selected) ?? { id: `page:${selectedKey}`, artwork: selected, box: "TrimBox" };
    // Stable identity per selected page, so its finish job is not re-keyed on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, model.surfaces]);
  const find = (id: string | null) => model.surfaces.find((s) => s.id === id) ?? null;
  const a = view.layout === "spread" ? find(model.scene.left) : (find(model.scene.front) ?? followed);
  const b = view.layout === "spread" ? find(model.scene.right) : find(model.scene.back);
  return useMemo(
    () => ({
      layout: view.layout,
      a,
      b,
      names: view.layout === "spread" ? ["left", "right"] : ["front", "back"],
    }),
    [view.layout, a, b],
  );
}

/** The faces to draw for two finish states; `ready` alone takes only settled results. */
export function buildFaces(
  slots: Slots,
  finishes: [FinishState, FinishState],
  summaries: Map<string, PageSummary>,
  thicknessM: number,
  ready = false,
): FaceInput[] {
  const build = (surface: PrintSurface | null, finish: FinishState, name: FaceName) => {
    const result =
      finish.status === "ready" || (!ready && finish.status === "rendering") ? finish.result : null;
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
  const a = build(slots.a, finishes[0], slots.names[0]);
  const b = build(slots.b, finishes[1], slots.names[1]);
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
}

/** The area to fit: the leaf, or both pages of the spread. */
export function sceneBounds(faces: FaceInput[], layout: Slots["layout"]): [number, number] {
  if (!faces.length) return PAGE;
  return layout === "spread"
    ? [
        faces[0].geometry.size[0] + (faces[1]?.geometry.size[0] ?? 0),
        Math.max(...faces.map((f) => f.geometry.size[1])),
      ]
    : [Math.max(...faces.map((f) => f.geometry.size[0])), Math.max(...faces.map((f) => f.geometry.size[1]))];
}

/** Where to put the camera to fit `bounds` from a preset direction, looking at the origin. */
export function presetPose(
  kind: "front" | "fit" | "back" | "low",
  bounds: [number, number],
  aspect: number,
  margin: number,
): CameraPose {
  const d = fitDistance(bounds[0], bounds[1], FOV, aspect, margin);
  if (kind === "low") {
    // Low along the page from below, to judge relief silhouettes and shadows.
    const a = (6 * Math.PI) / 180;
    return { position: [0, -Math.cos(a) * d * 0.8, Math.sin(a) * d * 0.8], target: [0, 0, 0] };
  }
  return { position: [0, 0, kind === "back" ? -d : d], target: [0, 0, 0] };
}

/** Whether a face draws raised UV at all with this look. */
export function drawsRaised(face: FaceInput, look: FinishLook) {
  return !look.printOnly && look.show.raisedUv && face.result.maps.raisedUv.some((v) => v > 0);
}

export function SceneContent({
  faces,
  look,
  layout,
  lighting,
  thicknessM,
  roughness,
  background,
  onRelief,
  registry,
  sunRef,
  placeholder = false,
  children,
}: {
  faces: FaceInput[];
  look: FinishLook;
  layout: Slots["layout"];
  lighting: Lighting;
  thicknessM: number;
  roughness: number;
  /** A colour, or null for a transparent background. */
  background: string | null;
  onRelief?: (name: FaceName, stats: ReliefStats | null) => void;
  registry?: FaceRegistry;
  sunRef?: Ref<THREE.DirectionalLight>;
  /** Draw a blank page when there are no faces: only for a project with no document at all. */
  placeholder?: boolean;
  /** Interface aids drawn by the live viewport only. */
  children?: ReactNode;
}) {
  const direction = useMemo(() => lightDirection(lighting), [lighting]);
  const lightPos = direction.map((v) => v * LIGHT_DISTANCE) as [number, number, number];
  return (
    <>
      {background ? <color attach="background" args={[background]} /> : null}
      <ambientLight intensity={0.05} />
      <directionalLight
        ref={sunRef}
        position={lightPos}
        intensity={lighting.intensity}
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
      {children}
      {faces.length ? (
        <>
          {faces.map((f) => (
            <Face key={f.name} input={f} look={look} onRelief={onRelief} registry={registry} />
          ))}
          {layout === "page" ? (
            <StockEdge
              size={faces[0].geometry.size}
              position={[0, 0, 0]}
              thicknessM={thicknessM}
              roughness={roughness}
            />
          ) : (
            faces.map((f) => (
              <StockEdge
                key={`edge-${f.name}`}
                size={f.geometry.size}
                position={f.placement.position}
                thicknessM={thicknessM}
                roughness={roughness}
              />
            ))
          )}
        </>
      ) : placeholder ? (
        <mesh castShadow receiveShadow position={[0, 0, 0.002]}>
          <planeGeometry args={PAGE} />
          <meshPhysicalMaterial color="#f4f1ea" roughness={0.55} clearcoat={0} />
        </mesh>
      ) : null}
      <mesh receiveShadow position={[0, 0, -0.02]}>
        <planeGeometry args={[3, 3]} />
        <shadowMaterial transparent opacity={0.25} />
      </mesh>
      <Environment
        resolution={256}
        frames={1}
        environmentRotation={[0, (lighting.environmentDeg * Math.PI) / 180, 0]}
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
    </>
  );
}
