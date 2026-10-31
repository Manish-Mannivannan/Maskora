"use client";

/**
 * A surface's finish maps for any view. Builds the inputs from the project,
 * keys the job by every value the result depends on (source revisions, page
 * boxes, layer types, interpretations and order), and returns the shared
 * result. Overlay visibility is not part of the key: it changes what the
 * registration view draws, never the coverage itself.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { usePageSummaries } from "@/features/document/usePages";
import { layerProblem, pageKey, type PrintSurface } from "@/project/model";
import { useProject } from "@/project/ProjectContext";
import { FINISH_RESOLUTION, finishJob, latestOnly } from "./jobs";
import { frameOf, runRegistration, type LayerInput, type RegistrationResult } from "./pipeline";

export type FinishState =
  | { status: "none" }
  | { status: "rendering"; result: RegistrationResult | null }
  | { status: "ready"; result: RegistrationResult }
  | { status: "failed"; message: string };

/**
 * Finish maps for `surface`, which may also be a page that is not (yet) a
 * print surface: it then simply has no finish layers.
 */
export function useFinish(surface: PrintSurface | null | undefined): FinishState {
  const [{ model, sources }, store] = useProject();
  const summaries = usePageSummaries();
  // The settled outcome of the latest job, and the last good result to show while a new one runs.
  const [settled, setSettled] = useState<{ key: string; state: FinishState } | null>(null);
  const [last, setLast] = useState<RegistrationResult | null>(null);
  const latest = useRef(latestOnly<RegistrationResult>());

  const job = useMemo(() => {
    if (!surface) return null;
    const artSource = sources.find((s) => s.id === surface.artwork.sourceId);
    const artSummary = summaries.get(pageKey(surface.artwork));
    if (!artSource || !artSummary || !frameOf(artSummary, surface.box)) return null;
    const list = sources.map((s) => ({ id: s.id, pageCount: s.pageCount }));
    const layers = model.layers
      .filter((l) => l.target === surface.id && l.enabled && !layerProblem(model, l, list))
      .flatMap((layer) => {
        if (layer.mask.kind !== "pdfPage") return [];
        const ref = layer.mask;
        const src = sources.find((s) => s.id === ref.sourceId)!;
        const summary = summaries.get(pageKey(ref));
        return summary ? [{ layer, src, summary }] : [];
      });
    const key = JSON.stringify({
      surface,
      art: [
        artSource.id,
        artSource.revision,
        artSummary.boxes.map((b) => b.effective),
        artSummary.rotation.displayed,
      ],
      layers: layers.map(({ layer, src, summary }) => [
        layer.id,
        layer.type,
        layer.interpretation,
        src.id,
        src.revision,
        summary.index,
        summary.boxes.map((b) => b.effective),
        summary.rotation.displayed,
      ]),
      resolution: FINISH_RESOLUTION,
    });
    return { key, surface, artSource, artSummary, layers };
  }, [model, sources, summaries, surface]);

  useEffect(() => {
    if (!job) return;
    const artSession = store.session(job.artSource.id, job.artSource.revision);
    if (!artSession) return;
    const inputs: LayerInput[] = [];
    for (const { layer, src, summary } of job.layers) {
      const session = store.session(src.id, src.revision);
      if (session) inputs.push({ layer, mask: { session, summary } });
    }
    // Rapid edits (a dragged slider) settle before a job starts; the shared job itself is never aborted.
    const timer = setTimeout(() => {
      const request = finishJob(job.key, () =>
        runRegistration(
          job.surface,
          { session: artSession, summary: job.artSummary },
          inputs,
          FINISH_RESOLUTION,
          new AbortController().signal,
        ),
      );
      latest.current(request).then(
        (r) => {
          if (!r.current) return;
          setSettled({ key: job.key, state: { status: "ready", result: r.value } });
          setLast(r.value);
        },
        (e: Error) =>
          setSettled({ key: job.key, state: { status: "failed", message: e?.message ?? String(e) } }),
      );
    }, 120);
    return () => clearTimeout(timer);
  }, [job, store]);

  if (!job) return { status: "none" };
  if (settled?.key === job.key) return settled.state;
  return { status: "rendering", result: last };
}
