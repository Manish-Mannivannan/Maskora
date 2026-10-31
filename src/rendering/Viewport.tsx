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
 * a blank A4 placeholder. The still export draws the same `SceneContent`.
 *
 * Lighting and the camera pose belong to the project, so they are saved with
 * it; an opened project's camera is applied once its pages are shown again.
 * The current camera position and light angles are also mirrored onto the
 * container's data attributes so a native smoke run can observe what a drag
 * actually changed.
 */
import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from "react";
import * as THREE from "three";
import { usePageSummaries, pageName } from "@/features/document/usePages";
import { useFinish } from "@/finish/useFinish";
import { FINISH_NAMES, type PrintSurface } from "@/project/model";
import { useProject } from "@/project/ProjectContext";
import type { CameraPose } from "@/project/projectFile";
import type { FinishLook } from "./finishMaterial";
import { sizesDiffer } from "./layout";
import { dragLight, lightDirection, type LightAngles } from "./lighting";
import { SceneProbe, type FaceName, type ReliefStats } from "./PageScene";
import {
  FOV,
  SceneContent,
  VIEWPORT_BACKGROUND,
  buildFaces,
  presetPose,
  sceneBounds,
  useSlots,
} from "./scene";

export type InteractionMode = "camera" | "light";
export type CameraPreset = "reset" | "fit" | "front" | "back" | "low";

export interface ViewportProps {
  mode: InteractionMode;
  /** Incremented to apply `kind`. */
  camera: { kind: CameraPreset; n: number };
}

// The gizmo sits close to the page along the light direction so it stays in the default view.
const GIZMO_DISTANCE = 0.15;
const CAMERA_START: [number, number, number] = [0, 0.05, 0.62];

const round = (v: number) => Math.round(v * 1000) / 1000;

export default function Viewport({ mode, camera }: ViewportProps) {
  const [{ model, view, sources, selected, lighting, camera: savedCamera, cameraRestore, relink }, store] =
    useProject();
  const summaries = usePageSummaries();
  const container = useRef<HTMLDivElement>(null);
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const sun = useRef<THREE.DirectionalLight>(null);
  const drag = useRef<{ x: number; y: number; start: LightAngles } | null>(null);
  const [aspect, setAspect] = useState(1.5);
  /** The last opened project whose camera has been applied for good. */
  const restored = useRef(0);
  const restoring = Object.values(relink).some((r) => r.status === "loading");

  const slots = useSlots(model, view, selected);
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

  const faces = useMemo(
    () => buildFaces(slots, [finishA, finishB], summaries, thicknessM),
    [slots, finishA, finishB, summaries, thicknessM],
  );
  const bounds = sceneBounds(faces, slots.layout);
  const fitKey = `${slots.layout}|${slots.a?.id}|${slots.b?.id}|${bounds.map((v) => v.toFixed(4)).join("x")}`;
  const direction = useMemo(() => lightDirection(lighting), [lighting]);

  const recordCamera = () => {
    const cam = controls.current?.object;
    if (cam && container.current)
      container.current.dataset.camera = JSON.stringify(cam.position.toArray().map(round));
  };
  /** Keep the pose in the project once a move or preset has finished. */
  const saveCamera = () => {
    const c = controls.current;
    if (!c) return;
    store.setCamera({
      position: c.object.position.toArray() as CameraPose["position"],
      target: c.target.toArray() as CameraPose["target"],
    });
  };

  const apply = (pose: CameraPose) => {
    const c = controls.current;
    if (!c) return;
    c.target.set(...pose.target);
    c.object.position.set(...pose.position);
    c.update();
    recordCamera();
    saveCamera();
  };

  const place = (kind: CameraPreset) => {
    const c = controls.current;
    if (!c) return;
    if (kind === "reset" && !faces.length) {
      c.reset();
      recordCamera();
      saveCamera();
      return;
    }
    // Margin leaves room for the status line along the bottom.
    apply(presetPose(kind === "reset" ? "front" : kind, bounds, aspect, 1.3));
  };

  useEffect(() => {
    if (container.current) container.current.dataset.light = JSON.stringify(lighting);
  }, [lighting]);

  useEffect(() => {
    // The fitted shadow bounds take effect only once the shadow camera's projection is rebuilt.
    sun.current?.shadow.camera.updateProjectionMatrix();
  }, []);

  useEffect(() => {
    if (camera.n > 0) {
      restored.current = cameraRestore;
      place(camera.kind);
    }
    // Applied when a preset is requested, with the bounds of that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera.n]);

  useEffect(() => {
    if (!faces.length) return;
    // An opened project's camera is applied, not a fresh fit, until its sources have finished loading.
    if (cameraRestore > restored.current && savedCamera) {
      apply(savedCamera);
      if (!restoring) restored.current = cameraRestore;
      return;
    }
    // New content (another page, layout or size) is framed from the front.
    place("front");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, cameraRestore, restoring]);

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
  for (const f of [finishA, finishB]) {
    if (f.status === "failed") notes.push({ code: "renderFailed", text: f.message });
    if (f.status === "blocked") notes.push({ code: "sourceBlocked", text: f.message });
  }
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
      data-environment={lighting.environmentDeg}
      style={{ cursor: mode === "light" ? "crosshair" : "grab" }}
      onPointerDown={(e) => {
        if (mode !== "light" || e.button !== 0) return;
        (e.target as Element).setPointerCapture?.(e.pointerId);
        drag.current = { x: e.clientX, y: e.clientY, start: lighting };
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        store.setLighting(
          dragLight(drag.current.start, e.clientX - drag.current.x, e.clientY - drag.current.y),
        );
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
        <SceneContent
          faces={faces}
          look={look}
          layout={slots.layout}
          lighting={lighting}
          thicknessM={thicknessM}
          roughness={model.stock.roughness}
          background={VIEWPORT_BACKGROUND}
          onRelief={reportRelief}
          sunRef={sun}
          // A blank page stands in only while there is no document; a page that cannot be drawn shows nothing.
          placeholder={!sources.length && !Object.keys(relink).length}
        >
          {/* The light gizmo: where the light sits, shown in both modes, never exported. */}
          <mesh position={direction.map((v) => v * GIZMO_DISTANCE) as [number, number, number]}>
            <sphereGeometry args={[0.012, 16, 16]} />
            <meshBasicMaterial color={mode === "light" ? "#ffd166" : "#8a8f98"} />
          </mesh>
        </SceneContent>
        <OrbitControls
          ref={controls}
          enabled={mode === "camera"}
          makeDefault
          enableDamping={false}
          minDistance={0.05}
          maxDistance={3}
          onChange={recordCamera}
          onStart={() => (restored.current = cameraRestore)}
          onEnd={saveCamera}
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
