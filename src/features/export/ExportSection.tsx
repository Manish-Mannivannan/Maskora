"use client";

/**
 * Still export (architecture §2.2 step 6, §9.4): framing, size and background
 * are chosen explicitly; the export renders a frozen snapshot, shows each
 * step, and ends in exactly one of saved, replaced, cancelled or failed
 * (with the reason: permission, disk space, size, or a source that is not
 * back). PNG only: JPEG waits until its background and colour handling is
 * verified. Source files are never written.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { record } from "@/diagnostics/log";
import { addPngText } from "@/export/pngText";
import { exportPng } from "@/native/project";
import { useProject } from "@/project/ProjectContext";
import { blockedSources } from "@/project/store";
import { VIEWPORT_BACKGROUND } from "@/rendering/scene";
import {
  EXPORT_MAX,
  EXPORT_MIN,
  ExportStage,
  exportSize,
  type Captured,
  type ExportSnapshot,
  type ExportStep,
} from "./ExportStage";

type Progress =
  | { kind: "idle" }
  | { kind: ExportStep | "writing" }
  | { kind: "saved"; name: string; overwritten: boolean; bytes: number; width: number; height: number }
  | { kind: "cancelled"; when: "render" | "dialog" }
  | { kind: "failed"; code: string; message: string };

const STEP_TEXT: Record<ExportStep | "writing", string> = {
  preparing: "Preparing finish maps for the frozen settings…",
  relief: "Building raised-UV geometry for the frozen settings…",
  rendering: "Rendering…",
  encoding: "Encoding PNG…",
  writing: "Choose where to save…",
};

const BACKGROUNDS = {
  viewport: { label: "Viewport grey", color: VIEWPORT_BACKGROUND },
  white: { label: "White", color: "#ffffff" },
  transparent: { label: "Transparent", color: null },
} as const;

function viewportAspect() {
  // The static export prerenders without a window; the hint is filled in once it runs in one.
  if (typeof document === "undefined") return 1.5;
  const el = document.querySelector<HTMLElement>('[data-testid="viewport"]');
  return el && el.clientHeight > 0 ? el.clientWidth / el.clientHeight : 1.5;
}

const noSubscription = () => () => undefined;

export function ExportSection() {
  const [state, store] = useProject();
  const [framing, setFraming] = useState<"view" | "fit">("view");
  const [longSide, setLongSide] = useState(3840);
  const [background, setBackground] = useState<keyof typeof BACKGROUNDS>("viewport");
  const [snapshot, setSnapshot] = useState<ExportSnapshot | null>(null);
  const [progress, setProgress] = useState<Progress>({ kind: "idle" });
  const jobs = useRef(0);

  const blocked = useMemo(() => blockedSources(state), [state]);
  const sizeProblem =
    !Number.isInteger(longSide) || longSide < EXPORT_MIN
      ? `Choose at least ${EXPORT_MIN} px.`
      : longSide > EXPORT_MAX
        ? `${longSide} px is beyond the export budget of ${EXPORT_MAX} px per side.`
        : null;
  const running = snapshot !== null || progress.kind === "writing";
  const problem = !state.sources.length
    ? "Add a PDF first."
    : store.restoring
      ? "Sources are still loading."
      : blocked.size
        ? [...blocked.values()][0]
        : sizeProblem;

  const start = () => {
    if (running || problem) return;
    if (document.querySelector<HTMLElement>('[data-testid="viewport"]')?.dataset.gl === "lost") {
      setProgress({
        kind: "failed",
        code: "graphicsLost",
        message: "The graphics device is resetting; export once the 3D preview is back.",
      });
      return;
    }
    const id = (jobs.current += 1);
    setProgress({ kind: "preparing" });
    setSnapshot({
      id,
      // State is never mutated, so holding these references freezes them.
      model: state.model,
      overrides: state.overrides,
      view: state.view,
      selected: state.selected,
      lighting: state.lighting,
      camera: state.camera,
      aspect: viewportAspect(),
      options: { framing, longSide, background: BACKGROUNDS[background].color },
      appVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? "dev",
    });
  };

  const current = (id: number) => id === jobs.current;
  const onStep = useCallback((step: ExportStep) => setProgress({ kind: step }), []);
  const onError = useCallback((code: string, message: string) => {
    setSnapshot(null);
    setProgress({ kind: "failed", code, message });
  }, []);
  const onCaptured = useCallback(
    async (c: Captured) => {
      const id = jobs.current;
      // The render is done; its canvas is released before the dialog opens.
      setSnapshot(null);
      setProgress({ kind: "writing" });
      window.__maskora ??= { cspViolations: [] };
      window.__maskora.lastExport = c.probe;
      let png: Uint8Array;
      try {
        png = addPngText(c.png, c.probe.metadata);
      } catch (e) {
        setProgress({ kind: "failed", code: "encodeFailed", message: (e as Error).message });
        return;
      }
      const base =
        state.file.name?.replace(/\.maskora\.json$/i, "") ??
        state.sources[0]?.name.replace(/\.pdf$/i, "") ??
        "Maskora";
      try {
        const saved = await exportPng(png, `${base} finish preview.png`);
        if (!current(id)) return;
        setProgress(
          saved
            ? {
                kind: "saved",
                name: saved.name,
                overwritten: saved.overwritten,
                bytes: saved.bytes,
                width: c.width,
                height: c.height,
              }
            : { kind: "cancelled", when: "dialog" },
        );
      } catch (error) {
        const e = error as { code?: string; message?: string };
        setProgress({
          kind: "failed",
          code: e?.code ?? "writeFailed",
          message: e?.message ?? "The image could not be written.",
        });
      }
    },
    [state.file.name, state.sources],
  );

  // Each export's outcome goes to the diagnostics log with the coverage digests and source revisions it used.
  const revisions = useRef<number[]>([]);
  useEffect(() => {
    revisions.current = state.sources.map((s) => s.revision);
  }, [state.sources]);
  useEffect(() => {
    if (progress.kind !== "saved" && progress.kind !== "cancelled" && progress.kind !== "failed") return;
    const saved = progress.kind === "saved";
    record({
      kind: "export",
      export: jobs.current,
      digests: saved ? (window.__maskora?.lastExport?.faces.map((f) => f.digest) ?? []) : [],
      revisions: revisions.current,
      size: saved ? [progress.width, progress.height] : [0, 0],
      outcome: progress.kind,
      ...(progress.kind === "failed" ? { code: progress.code } : {}),
    });
  }, [progress]);

  const cancel = () => {
    if (!snapshot) return;
    jobs.current += 1;
    setSnapshot(null);
    setProgress({ kind: "cancelled", when: "render" });
  };

  const inWindow = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  const [w, h] = exportSize(longSide, framing === "view" ? viewportAspect() : 210 / 297);

  return (
    <>
      <div className="segmented" role="radiogroup" aria-label="Framing">
        <button
          type="button"
          role="radio"
          aria-checked={framing === "view"}
          data-testid="export-framing-view"
          onClick={() => setFraming("view")}
        >
          Current view
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={framing === "fit"}
          data-testid="export-framing-fit"
          onClick={() => setFraming("fit")}
        >
          Fit page
        </button>
      </div>
      <label>
        Longest side (px)
        <input
          type="number"
          data-testid="export-size"
          min={EXPORT_MIN}
          max={EXPORT_MAX}
          step={1}
          value={longSide}
          onChange={(e) => setLongSide(Number(e.target.value))}
        />
      </label>
      <p className="hint" data-testid="export-dimensions">
        {sizeProblem ??
          (framing === "fit"
            ? "Shaped to the page or spread."
            : inWindow
              ? `About ${w} × ${h} px, the viewport's shape.`
              : "Shaped like the viewport.")}
      </p>
      <label>
        Background
        <select
          data-testid="export-background"
          value={background}
          onChange={(e) => setBackground(e.target.value as keyof typeof BACKGROUNDS)}
        >
          {Object.entries(BACKGROUNDS).map(([id, b]) => (
            <option key={id} value={id}>
              {b.label}
            </option>
          ))}
        </select>
      </label>
      <div className="row">
        <button type="button" data-testid="export-png" disabled={running || !!problem} onClick={start}>
          Export PNG…
        </button>
        {snapshot ? (
          <button type="button" data-testid="export-cancel" onClick={cancel}>
            Stop
          </button>
        ) : null}
      </div>
      {problem && !running ? (
        <p className="hint" data-testid="export-problem">
          {problem}
        </p>
      ) : null}
      <p className="status" data-testid="export-status" data-kind={progress.kind} role="status">
        {progress.kind === "idle"
          ? "The export uses the settings as they are when it starts; later changes do not reach it."
          : progress.kind === "saved"
            ? `${progress.overwritten ? "Replaced" : "Saved"} ${progress.name} (${progress.width} × ${progress.height} px, ${(progress.bytes / 1e6).toFixed(1)} MB).`
            : progress.kind === "cancelled"
              ? progress.when === "dialog"
                ? "Export cancelled; nothing was written."
                : "Export stopped; nothing was written."
              : progress.kind === "failed"
                ? `Export failed (${progress.code}): ${progress.message}`
                : STEP_TEXT[progress.kind]}
      </p>
      <p className="hint">
        PNG only for now. The image says it is an approximation, and records its sources and how each finish
        was drawn.
      </p>
      {snapshot ? (
        <ExportStage
          key={snapshot.id}
          snapshot={snapshot}
          onStep={onStep}
          onCaptured={onCaptured}
          onError={onError}
        />
      ) : null}
    </>
  );
}
