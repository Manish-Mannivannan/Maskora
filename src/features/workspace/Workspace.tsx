"use client";

/**
 * The application shell: one resizable vertical control panel beside one
 * viewport (architecture §2.4). Sections arrive with their phases; this step
 * provides Document (native selection and a first local PDF.js read),
 * Lighting, and View.
 *
 * Document states are distinct on screen — idle, selecting, cancelled,
 * loaded, failed — so a cancelled dialog never reads as an empty document and
 * a refusal shows its code.
 */
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { isSourceError, readSource, selectSource, type SourceInfo } from "@/native/sources";
import { openDocument } from "@/pdf/pdfjs";
import { normalizeAngles, type LightAngles } from "@/rendering/lighting";
import type { InteractionMode } from "@/rendering/Viewport";
import { PANEL_DEFAULT, PANEL_KEY_STEP, PANEL_MAX, PANEL_MIN, clampPanelWidth } from "./panel";

// WebGL exists only in the window, never during the static export's prerender.
const Viewport = dynamic(() => import("@/rendering/Viewport"), {
  ssr: false,
  loading: () => <div className="viewport viewport-loading">Preparing viewport…</div>,
});

type DocumentState =
  | { kind: "idle" }
  | { kind: "selecting" }
  | { kind: "cancelled" }
  | { kind: "loaded"; source: SourceInfo; bytesRead: number; header: string; pages: number }
  | { kind: "failed"; code: string; message: string };

declare global {
  interface Window {
    __maskora?: { cspViolations: string[] };
  }
}

export default function Workspace() {
  const [panelWidth, setPanelWidth] = useState(PANEL_DEFAULT);
  const [mode, setMode] = useState<InteractionMode>("camera");
  const [light, setLight] = useState<LightAngles>({ azimuth: 35, elevation: 40 });
  const [intensity, setIntensity] = useState(2.5);
  const [resetSignal, setResetSignal] = useState(0);
  const [doc, setDoc] = useState<DocumentState>({ kind: "idle" });
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

  const openPdf = useCallback(async () => {
    setDoc({ kind: "selecting" });
    try {
      const source = await selectSource();
      if (!source) {
        setDoc({ kind: "cancelled" });
        return;
      }
      const bytes = await readSource(source.handle);
      const header = new TextDecoder("latin1").decode(bytes.slice(0, 8));
      const pdf = await openDocument(bytes.slice());
      setDoc({ kind: "loaded", source, bytesRead: bytes.length, header, pages: pdf.document.numPages });
      await pdf.close();
    } catch (error) {
      if (isSourceError(error)) setDoc({ kind: "failed", code: error.code, message: error.message });
      else
        setDoc({
          kind: "failed",
          code: "pdfReadFailed",
          message: String((error as Error)?.message ?? error),
        });
    }
  }, []);

  const setAngles = (next: Partial<LightAngles>) => setLight((prev) => normalizeAngles({ ...prev, ...next }));

  return (
    <div className="workspace" style={{ gridTemplateColumns: `${panelWidth}px 6px 1fr` }}>
      <aside className="panel" data-testid="panel" aria-label="Controls">
        <h1 className="app-name">Maskora</h1>

        <section aria-labelledby="doc-heading">
          <h2 id="doc-heading">Document</h2>
          <button type="button" data-testid="open-pdf" onClick={openPdf} disabled={doc.kind === "selecting"}>
            Open PDF…
          </button>
          <p className="status" data-testid="doc-status" data-state={doc.kind}>
            {doc.kind === "idle" && "No document open."}
            {doc.kind === "selecting" && "Waiting for a file to be chosen…"}
            {doc.kind === "cancelled" && "Selection cancelled; nothing was opened."}
            {doc.kind === "loaded" &&
              `${doc.source.name}: ${doc.bytesRead} bytes read locally (${doc.header.trim()}), ${doc.pages} page${doc.pages === 1 ? "" : "s"}.`}
            {doc.kind === "failed" && `Could not open (${doc.code}): ${doc.message}`}
          </p>
        </section>

        <section aria-labelledby="light-heading">
          <h2 id="light-heading">Lighting</h2>
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
        </section>

        <section aria-labelledby="view-heading">
          <h2 id="view-heading">View</h2>
          <button type="button" data-testid="reset-camera" onClick={() => setResetSignal((n) => n + 1)}>
            Reset camera
          </button>
          <p className="hint">Camera: left-drag orbits, right-drag pans, wheel zooms.</p>
        </section>
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

      <Viewport
        mode={mode}
        light={light}
        intensity={intensity}
        onLightChange={setLight}
        resetSignal={resetSignal}
      />
    </div>
  );
}
