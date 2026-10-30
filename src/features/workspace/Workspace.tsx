"use client";

/**
 * The application shell: one resizable, scrolling control panel beside one
 * viewport (architecture §2.4). The panel's sections collapse and remember
 * whether they are open; sections arrive with their phases. All document
 * state belongs to the project instance the provider creates.
 */
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { SourcesSection } from "@/features/document/SourcesSection";
import { pageName, usePageSummaries } from "@/features/document/usePages";
import { FinishesSection } from "@/features/finishes/FinishesSection";
import RegistrationView from "@/features/registration/RegistrationView";
import { PageInspector } from "@/features/document/PageInspector";
import { PagesSection } from "@/features/document/PagesSection";
import { ProjectProvider, useProject } from "@/project/ProjectContext";
import { normalizeAngles, type LightAngles } from "@/rendering/lighting";
import type { InteractionMode } from "@/rendering/Viewport";
import { PANEL_DEFAULT, PANEL_KEY_STEP, PANEL_MAX, PANEL_MIN, clampPanelWidth } from "./panel";
import { Section } from "./Section";

// WebGL exists only in the window, never during the static export's prerender.
const Viewport = dynamic(() => import("@/rendering/Viewport"), {
  ssr: false,
  loading: () => <div className="viewport viewport-loading">Preparing viewport…</div>,
});

declare global {
  interface Window {
    __maskora?: { cspViolations: string[] };
  }
}

export default function Workspace() {
  return (
    <ProjectProvider>
      <Shell />
    </ProjectProvider>
  );
}

function PagesSummary() {
  const [{ sources }] = useProject();
  const total = sources.reduce((n, s) => n + s.pageCount, 0);
  return total ? <>{total}</> : null;
}

function ViewControls({ onResetCamera }: { onResetCamera: () => void }) {
  const [{ view, model, sources }, store] = useProject();
  const summaries = usePageSummaries();
  return (
    <>
      <div className="segmented" role="radiogroup" aria-label="Main view">
        <button
          type="button"
          role="radio"
          aria-checked={view.mode === "3d"}
          data-testid="view-3d"
          onClick={() => store.setView({ mode: "3d" })}
        >
          3D view
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={view.mode === "registration"}
          data-testid="view-registration"
          onClick={() => store.setView({ mode: "registration" })}
        >
          Registration
        </button>
      </div>
      {view.mode === "registration" ? (
        <label>
          Printed page shown
          <select
            data-testid="registration-surface"
            value={view.surfaceId ?? ""}
            onChange={(e) => store.setView({ surfaceId: e.target.value || null })}
          >
            <option value="">Follow the selected finish</option>
            {model.surfaces.map((s) => (
              <option key={s.id} value={s.id}>
                {pageName(sources, summaries, s.artwork)}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <>
          <button type="button" data-testid="reset-camera" onClick={onResetCamera}>
            Reset camera
          </button>
          <p className="hint">Camera: left-drag orbits, right-drag pans, wheel zooms.</p>
        </>
      )}
    </>
  );
}

function MainView({ children }: { children: React.ReactNode }) {
  const [{ view }] = useProject();
  // The 3D view stays mounted while hidden, so its camera and light are kept.
  return (
    <div className="main-view">
      <div className="main-layer" hidden={view.mode !== "3d"}>
        {children}
      </div>
      {view.mode === "registration" ? <RegistrationView /> : null}
    </div>
  );
}

function Shell() {
  const [panelWidth, setPanelWidth] = useState(PANEL_DEFAULT);
  const [mode, setMode] = useState<InteractionMode>("camera");
  const [light, setLight] = useState<LightAngles>({ azimuth: 35, elevation: 40 });
  const [intensity, setIntensity] = useState(2.5);
  const [resetSignal, setResetSignal] = useState(0);
  const resizing = useRef<{ x: number; width: number } | null>(null);

  // Record content-security-policy violations so a smoke run can prove none occurred.
  useEffect(() => {
    window.__maskora ??= { cspViolations: [] };
    const record = (e: SecurityPolicyViolationEvent) =>
      window.__maskora?.cspViolations.push(`${e.effectiveDirective} ${e.blockedURI}`);
    document.addEventListener("securitypolicyviolation", record);
    return () => document.removeEventListener("securitypolicyviolation", record);
  }, []);

  // The Phase 0.4 compatibility probe exists only in builds made with
  // NEXT_PUBLIC_MASKORA_PROBE=1; the constant is inlined, so normal builds drop it.
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_MASKORA_PROBE === "1") void import("@/pdf/probe").then((m) => m.install());
  }, []);

  const setAngles = (next: Partial<LightAngles>) => setLight((prev) => normalizeAngles({ ...prev, ...next }));

  return (
    <div className="workspace" style={{ gridTemplateColumns: `${panelWidth}px 6px 1fr` }}>
      <aside className="panel" data-testid="panel" aria-label="Controls">
        <h1 className="app-name">Maskora</h1>

        <Section id="sources" title="Sources">
          <SourcesSection />
        </Section>
        <Section id="pages" title="Pages" summary={<PagesSummary />}>
          <PagesSection />
        </Section>
        <Section id="page" title="Selected page">
          <PageInspector />
        </Section>
        <Section id="finishes" title="Finishes">
          <FinishesSection />
        </Section>

        <Section id="lighting" title="Lighting">
          <div className="segmented" role="radiogroup" aria-label="Pointer drag moves">
            <button
              type="button"
              role="radio"
              aria-checked={mode === "camera"}
              data-testid="mode-camera"
              onClick={() => setMode("camera")}
            >
              Move camera
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mode === "light"}
              data-testid="mode-light"
              onClick={() => setMode("light")}
            >
              Move light
            </button>
          </div>
          <label>
            Azimuth (°)
            <input
              type="range"
              min={0}
              max={359}
              step={1}
              value={Math.round(light.azimuth)}
              onChange={(e) => setAngles({ azimuth: Number(e.target.value) })}
            />
            <input
              type="number"
              data-testid="azimuth"
              value={Math.round(light.azimuth)}
              onChange={(e) => setAngles({ azimuth: Number(e.target.value) })}
            />
          </label>
          <label>
            Elevation (°)
            <input
              type="range"
              min={-10}
              max={89}
              step={1}
              value={Math.round(light.elevation)}
              onChange={(e) => setAngles({ elevation: Number(e.target.value) })}
            />
            <input
              type="number"
              data-testid="elevation"
              value={Math.round(light.elevation)}
              onChange={(e) => setAngles({ elevation: Number(e.target.value) })}
            />
          </label>
          <label>
            Intensity
            <input
              type="range"
              min={0}
              max={6}
              step={0.1}
              value={intensity}
              onChange={(e) => setIntensity(Number(e.target.value))}
            />
            <output>{intensity.toFixed(1)}</output>
          </label>
        </Section>

        <Section id="view" title="View">
          <ViewControls onResetCamera={() => setResetSignal((n) => n + 1)} />
        </Section>
      </aside>

      <div
        className="resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize controls"
        aria-valuemin={PANEL_MIN}
        aria-valuemax={PANEL_MAX}
        aria-valuenow={panelWidth}
        tabIndex={0}
        data-testid="resize-handle"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          resizing.current = { x: e.clientX, width: panelWidth };
        }}
        onPointerMove={(e) => {
          if (resizing.current)
            setPanelWidth(clampPanelWidth(resizing.current.width + e.clientX - resizing.current.x));
        }}
        onPointerUp={() => (resizing.current = null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") setPanelWidth((w) => clampPanelWidth(w - PANEL_KEY_STEP));
          if (e.key === "ArrowRight") setPanelWidth((w) => clampPanelWidth(w + PANEL_KEY_STEP));
        }}
      />

      <MainView>
        <Viewport
          mode={mode}
          light={light}
          intensity={intensity}
          onLightChange={setLight}
          resetSignal={resetSignal}
        />
      </MainView>
    </div>
  );
}
