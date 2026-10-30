"use client";

/**
 * The 3D viewport (architecture §2.4, §7.5).
 *
 * Camera and light never compete for one drag: in camera mode OrbitControls
 * own the pointer (left orbit, right pan, wheel zoom); in Move Light mode the
 * controls are disabled and a drag edits the light's azimuth and elevation.
 * The environment is built in the scene from light panels, so no HDR file or
 * remote preset is ever fetched (§3.3).
 *
 * The current camera position and light angles are mirrored onto the
 * container's data attributes so a native smoke run can observe what a drag
 * actually changed.
 */
import { Environment, Lightformer, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type ComponentRef } from "react";
import { dragLight, lightDirection, type LightAngles } from "./lighting";

export type InteractionMode = "camera" | "light";

export interface ViewportProps {
  mode: InteractionMode;
  light: LightAngles;
  intensity: number;
  onLightChange: (next: LightAngles) => void;
  resetSignal: number;
}

// A placeholder A4 page in metres until real page surfaces arrive (Phase 1).
const PAGE: [number, number] = [0.21, 0.297];
const LIGHT_DISTANCE = 1.2;
// The gizmo sits close to the page along the light direction so it stays in the default view.
const GIZMO_DISTANCE = 0.15;
const CAMERA_START: [number, number, number] = [0, 0.05, 0.62];

const round = (v: number) => Math.round(v * 1000) / 1000;

export default function Viewport({ mode, light, intensity, onLightChange, resetSignal }: ViewportProps) {
  const container = useRef<HTMLDivElement>(null);
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const drag = useRef<{ x: number; y: number; start: LightAngles } | null>(null);

  const direction = useMemo(() => lightDirection(light), [light]);
  const lightPos = direction.map((v) => v * LIGHT_DISTANCE) as [number, number, number];

  useEffect(() => {
    if (container.current) container.current.dataset.light = JSON.stringify(light);
  }, [light]);

  useEffect(() => {
    if (resetSignal === 0) return;
    controls.current?.reset();
  }, [resetSignal]);

  const recordCamera = () => {
    const camera = controls.current?.object;
    if (camera && container.current) {
      container.current.dataset.camera = JSON.stringify(camera.position.toArray().map(round));
    }
  };

  return (
    <div
      ref={container}
      className="viewport"
      data-testid="viewport"
      data-mode={mode}
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
        camera={{ position: CAMERA_START, fov: 40, near: 0.01, far: 20 }}
        gl={{ preserveDrawingBuffer: true }}
        onCreated={recordCamera}
      >
        <color attach="background" args={["#1d1f22"]} />
        <ambientLight intensity={0.05} />
        <directionalLight
          position={lightPos}
          intensity={intensity}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-bias={-0.0002}
        />
        {/* The light gizmo: where the light sits, shown in both modes. */}
        <mesh position={direction.map((v) => v * GIZMO_DISTANCE) as [number, number, number]}>
          <sphereGeometry args={[0.012, 16, 16]} />
          <meshBasicMaterial color={mode === "light" ? "#ffd166" : "#8a8f98"} />
        </mesh>
        <mesh castShadow receiveShadow position={[0, 0, 0.002]}>
          <planeGeometry args={PAGE} />
          <meshPhysicalMaterial color="#f4f1ea" roughness={0.55} clearcoat={0} />
        </mesh>
        <mesh receiveShadow position={[0, 0, -0.001]}>
          <planeGeometry args={[3, 3]} />
          <shadowMaterial transparent opacity={0.25} />
        </mesh>
        <Environment resolution={256} frames={1}>
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
        </Environment>
        <OrbitControls
          ref={controls}
          enabled={mode === "camera"}
          makeDefault
          enableDamping={false}
          minDistance={0.15}
          maxDistance={3}
          onChange={recordCamera}
        />
      </Canvas>
    </div>
  );
}
