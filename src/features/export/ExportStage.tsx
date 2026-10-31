"use client";

/**
 * One still export's render (architecture §9.4, §10.3).
 *
 * The export draws a snapshot of the project frozen when it started: model,
 * overrides, view, lighting and camera. Later edits in the live view cannot
 * reach it. It renders the same `SceneContent` as the viewport, offscreen, at
 * the requested pixel size, and captures only when everything it shows is
 * current for that snapshot:
 *
 * 1. every shown surface's finish maps have settled for the snapshot's key (a
 *    result still being replaced, or one for older settings, is not used);
 * 2. every face that draws raised UV has built its relief for those maps and
 *    the snapshot's recipe, in the snapshot's representation (coating
 *    geometry, or the normal-map fallback);
 * 3. a few frames have run, so the environment and shadow maps exist.
 *
 * A blocked or failed finish ends the export with that reason, never with a
 * partial image. The light gizmo and registration colours are not part of
 * the scene it draws.
 */
import { Canvas, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as THREE from "three";
import { usePageSummaries, pageName } from "@/features/document/usePages";
import { useFinish, type FrozenInputs } from "@/finish/useFinish";
import type { PageOverride } from "@/project/facts";
import type { PageRef, ProjectModel } from "@/project/model";
import { useProject } from "@/project/ProjectContext";
import type { CameraPose, Lighting } from "@/project/projectFile";
import type { ViewState } from "@/project/store";
import type { FinishLook } from "@/rendering/finishMaterial";
import {
  worldPoint,
  type ExportProbe,
  type FaceInput,
  type FaceName,
  type FaceRegistry,
  type ReliefStats,
} from "@/rendering/PageScene";
import {
  FOV,
  SceneContent,
  buildFaces,
  drawsRaised,
  presetPose,
  sceneBounds,
  useSlots,
} from "@/rendering/scene";

export interface ExportOptions {
  /** The camera as it was in the view, or the page fitted square-on. */
  framing: "view" | "fit";
  /** Pixels on the longest side. */
  longSide: number;
  /** A colour, or null for transparent. */
  background: string | null;
}

export interface ExportSnapshot {
  id: number;
  model: ProjectModel;
  overrides: Record<string, PageOverride>;
  view: ViewState;
  selected: PageRef | null;
  lighting: Lighting;
  camera: CameraPose | null;
  /** Width over height of the live viewport, for "view" framing. */
  aspect: number;
  options: ExportOptions;
  appVersion: string;
}

export type ExportStep = "preparing" | "relief" | "rendering" | "encoding";

export interface Captured {
  png: Uint8Array;
  width: number;
  height: number;
  probe: ExportProbe;
}

/** Export size budget (architecture §17.3): stills are at most this many pixels on a side. */
export const EXPORT_MAX = 8192;
export const EXPORT_MIN = 256;

/** Pixel size for a long side and aspect. */
export function exportSize(longSide: number, aspect: number): [number, number] {
  const a = Math.min(8, Math.max(1 / 8, aspect));
  return a >= 1
    ? [longSide, Math.max(1, Math.round(longSide / a))]
    : [Math.max(1, Math.round(longSide * a)), longSide];
}

const sameProfile = (s: ReliefStats, look: FinishLook) =>
  s.profile.heightUm === look.recipes.raisedUv.heightUm &&
  s.profile.bevelMm === look.recipes.raisedUv.bevelMm &&
  s.profile.crownUm === look.recipes.raisedUv.crownUm;

/** Whether a face's relief is the one this export must show. */
function reliefCurrent(face: FaceInput, stats: ReliefStats | undefined, look: FinishLook) {
  if (!drawsRaised(face, look)) return true;
  if (!stats || stats.digest !== face.result.digest || !sameProfile(stats, look)) return false;
  // A failed build is final for these settings; the export stops on it rather than waiting.
  if (stats.failed) return true;
  return look.raisedMode === "mesh" ? stats.mode === "mesh" : stats.mode === "normals";
}

/** How raised UV appears in the export, for its metadata and the panel. */
export function raisedRepresentation(
  faces: FaceInput[],
  stats: Partial<Record<FaceName, ReliefStats>>,
  look: FinishLook,
) {
  const drawn = faces.filter((f) => drawsRaised(f, look));
  if (!drawn.length) return "not shown";
  return drawn
    .map((f) => {
      const s = stats[f.name];
      const how = s?.fallback
        ? `surface normals (geometry fallback: ${s.fallback})`
        : s?.mode === "mesh"
          ? `coating geometry${(s.step ?? 1) > 1 ? ` at 1/${s.step} resolution` : ""}, casts shadows but does not receive them`
          : "surface normals only, no silhouette or cast shadow";
      return `${f.name}: approximate, ${how}`;
    })
    .join("; ");
}

function nextFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

/** Inside the export canvas: frame the camera, render once everything is current, and encode. */
function Capture({
  ready,
  pose,
  registry,
  onEncoding,
  onCaptured,
  onError,
}: {
  ready: boolean;
  pose: CameraPose;
  registry: FaceRegistry;
  onEncoding: () => void;
  onCaptured: (c: Omit<Captured, "probe"> & { project: ExportProbe["project"] }) => void;
  onError: (code: string, message: string) => void;
}) {
  const { gl, camera, size, invalidate } = useThree();
  const started = useRef(false);
  // The capture runs once; it reports through whatever callbacks are current when it finishes.
  const report = useRef({ onEncoding, onCaptured, onError });
  useEffect(() => {
    report.current = { onEncoding, onCaptured, onError };
  }, [onEncoding, onCaptured, onError]);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  useEffect(() => {
    camera.position.set(...pose.position);
    camera.lookAt(new THREE.Vector3(...pose.target));
    camera.updateMatrixWorld();
    invalidate();
  }, [camera, pose, invalidate]);

  useEffect(() => {
    if (!ready || started.current) return;
    started.current = true;
    const { onError } = report.current;
    void (async () => {
      const ctx = gl.getContext();
      // A browser may quietly give a smaller drawing buffer than asked for; that is not the requested export.
      if (ctx.drawingBufferWidth !== size.width || ctx.drawingBufferHeight !== size.height) {
        onError(
          "exportTooLarge",
          `The graphics device could only provide ${ctx.drawingBufferWidth} × ${ctx.drawingBufferHeight} px of the ${size.width} × ${size.height} px asked for. Choose a smaller size.`,
        );
        return;
      }
      // A few rendered frames build the environment and shadow maps before the one that is kept.
      for (let i = 0; i < 4; i += 1) {
        invalidate();
        await nextFrame();
      }
      await nextFrame();
      if (!mounted.current) return;
      report.current.onEncoding();
      const blob = await new Promise<Blob | null>((resolve) => gl.domElement.toBlob(resolve, "image/png"));
      if (!mounted.current) return;
      if (!blob) {
        onError("encodeFailed", "The image could not be encoded as PNG.");
        return;
      }
      const cam = camera.clone();
      // The faces leave the registry when the stage unmounts; the probe keeps them as they were rendered.
      const rendered = new Map(registry);
      const w = size.width;
      const h = size.height;
      const png = new Uint8Array(await blob.arrayBuffer());
      if (!mounted.current) return;
      report.current.onCaptured({
        png,
        width: w,
        height: h,
        project: (name, mm) => {
          const entry = rendered.get(name);
          if (!entry) return null;
          const p = worldPoint(entry, mm).world.project(cam);
          return [((p.x + 1) / 2) * w, ((1 - p.y) / 2) * h];
        },
      });
    })().catch((e: Error) => onError("renderFailed", e?.message ?? String(e)));
  }, [ready, gl, camera, size, invalidate, registry]);

  return null;
}

export function ExportStage({
  snapshot,
  onStep,
  onCaptured,
  onError,
}: {
  snapshot: ExportSnapshot;
  onStep: (step: ExportStep) => void;
  onCaptured: (c: Captured) => void;
  onError: (code: string, message: string) => void;
}) {
  const [{ sources }] = useProject();
  const frozen = useMemo<FrozenInputs>(
    () => ({ model: snapshot.model, overrides: snapshot.overrides }),
    [snapshot],
  );
  const summaries = usePageSummaries(snapshot.overrides);
  const slots = useSlots(snapshot.model, snapshot.view, snapshot.selected);
  const finishA = useFinish(slots.a, frozen);
  const finishB = useFinish(slots.b, frozen);
  const thicknessM = snapshot.model.stock.thicknessMm / 1000;
  const look = useMemo<FinishLook>(
    () => ({
      recipes: snapshot.model.recipes,
      stock: snapshot.model.stock,
      show: snapshot.view.show,
      printOnly: snapshot.view.printOnly,
      raisedMode: snapshot.view.raisedMode,
    }),
    [snapshot],
  );

  const expected = (slots.layout === "spread" ? [slots.a, slots.b] : [slots.a, slots.b].filter(Boolean))
    .length;
  const finishes = [finishA, finishB];
  const faces = useMemo(
    () => buildFaces(slots, [finishA, finishB], summaries, thicknessM, true),
    [slots, finishA, finishB, summaries, thicknessM],
  );
  const finishesReady = expected > 0 && faces.length === expected;

  const [stats, setStats] = useState<Partial<Record<FaceName, ReliefStats>>>({});
  const onRelief = useCallback(
    (name: FaceName, s: ReliefStats | null) => setStats((prev) => ({ ...prev, [name]: s ?? undefined })),
    [],
  );
  const reliefReady = finishesReady && faces.every((f) => reliefCurrent(f, stats[f.name], look));
  const registry = useMemo<FaceRegistry>(() => new Map(), []);
  // Whether a context loss still matters: the canvas drops its own context when it closes after capturing.
  const watching = useRef(true);
  useEffect(
    () => () => {
      watching.current = false;
    },
    [],
  );

  const reliefFailure = faces.map((f) => stats[f.name]?.failed).find(Boolean);
  // Stop with the reason when something it needs cannot be drawn.
  const problem = reliefFailure
    ? `Raised UV could not be drawn for the export: ${reliefFailure}.`
    : expected === 0 || (slots.layout === "spread" && (!slots.a || !slots.b))
      ? "Nothing to export: choose the printed pages the view shows."
      : (
          finishes.find((f) => f.status === "blocked" || f.status === "failed") as
            { message: string } | undefined
        )?.message;
  useEffect(() => {
    if (problem) onError("notReady", problem);
  }, [problem, onError]);

  const step: ExportStep = !finishesReady ? "preparing" : !reliefReady ? "relief" : "rendering";
  useEffect(() => {
    if (!problem) onStep(step);
  }, [step, problem, onStep]);

  const bounds = sceneBounds(faces, slots.layout);
  const fit = snapshot.options.framing === "fit" || !snapshot.camera;
  const aspect = fit ? bounds[0] / bounds[1] : snapshot.aspect;
  const [width, height] = exportSize(snapshot.options.longSide, aspect);
  const pose = useMemo(
    () => (fit ? presetPose("front", bounds, width / height, 1.08) : snapshot.camera!),
    // The bounds are fixed once the frozen faces exist.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fit, finishesReady, width, height, snapshot.camera],
  );

  const handleEncoding = useCallback(() => onStep("encoding"), [onStep]);
  const handleCaptured = useCallback(
    (c: Omit<Captured, "probe"> & { project: ExportProbe["project"] }) => {
      watching.current = false;
      const pages = faces.map((f, i) => {
        const surface = i === 0 ? slots.a : slots.b;
        return `${f.name}: ${surface ? pageName(sources, summaries, surface.artwork) : "?"} (${surface?.box ?? "?"})`;
      });
      const metadata: Record<string, string> = {
        Software: `Maskora ${snapshot.appVersion}`,
        Description:
          "Maskora finish preview: a visual approximation of print finishes, not a colour-accurate or certified proof.",
        "Creation Time": new Date().toISOString(),
        "Maskora sources": sources
          .map((s) => `${s.name} sha256:${s.digest.status === "available" ? s.digest.value : "unknown"}`)
          .join("\n"),
        "Maskora pages": pages.join("\n"),
        "Maskora ordinary UV":
          snapshot.view.printOnly || !snapshot.view.show.uv
            ? "not shown"
            : "implemented: masked clearcoat over unchanged artwork",
        "Maskora raised UV": raisedRepresentation(faces, stats, look),
        "Maskora coverage": faces.map((f) => `${f.name}: ${f.result.digest}`).join("\n"),
        "Maskora view": JSON.stringify({
          layout: slots.layout,
          framing: fit ? "fit" : "view",
          size: [c.width, c.height],
          background: snapshot.options.background ?? "transparent",
          lighting: snapshot.lighting,
          raisedMode: snapshot.view.raisedMode,
          printOnly: snapshot.view.printOnly,
        }),
      };
      onCaptured({
        png: c.png,
        width: c.width,
        height: c.height,
        probe: {
          width: c.width,
          height: c.height,
          faces: faces.map((f) => ({
            name: f.name,
            digest: f.result.digest,
            stats: stats[f.name] ?? null,
            coating: !!registry.get(f.name) && stats[f.name]?.mode === "mesh" && !stats[f.name]?.fallback,
          })),
          project: c.project,
          metadata,
        },
      });
    },
    [faces, slots, sources, summaries, snapshot, stats, look, fit, registry, onCaptured],
  );

  if (problem || !finishesReady) return null;
  return createPortal(
    <div
      aria-hidden
      data-testid="export-stage"
      // Laid out (so the canvas gets its size) but outside the window.
      style={{ position: "fixed", left: -(width + 100), top: 0, width, height, pointerEvents: "none" }}
    >
      <Canvas
        shadows
        dpr={1}
        frameloop="demand"
        camera={{ position: pose.position, fov: FOV, near: 0.01, far: 20 }}
        gl={{ preserveDrawingBuffer: true, alpha: true, antialias: true }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.NeutralToneMapping;
          gl.setClearColor(0x000000, 0);
          // A device reset mid-export would capture an empty or partial image: stop instead.
          gl.domElement.addEventListener("webglcontextlost", () => {
            if (watching.current)
              onError("graphicsLost", "The graphics device reset during the export. Try again.");
          });
        }}
      >
        <SceneContent
          faces={faces}
          look={look}
          layout={slots.layout}
          lighting={snapshot.lighting}
          thicknessM={thicknessM}
          roughness={snapshot.model.stock.roughness}
          background={snapshot.options.background}
          onRelief={onRelief}
          registry={registry}
        />
        <Capture
          ready={reliefReady}
          pose={pose}
          registry={registry}
          onEncoding={handleEncoding}
          onCaptured={handleCaptured}
          onError={onError}
        />
      </Canvas>
    </div>,
    document.body,
  );
}
