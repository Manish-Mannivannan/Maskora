"use client";

/**
 * The flat registration view (architecture §2.4, §7.4): one printed page,
 * fitted and still (no orbit, no drift), with the finish overlay drawn from
 * the same finish maps the material uses, the trim and bleed outlined, and
 * every registration warning listed. Overlay colours are a viewing aid only
 * and never reach a material or an export (§4.4).
 *
 * The root mirrors its render plan and anchor box onto data attributes, so
 * the native smoke can check coverage at positions computed from fixtures.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { pageName, usePageSummaries } from "@/features/document/usePages";
import { colorize, compose, OVERLAY_COLORS } from "@/finish/coverage";
import { frameOf } from "@/finish/pipeline";
import { useFinish } from "@/finish/useFinish";
import { FINISH_NAMES, layerProblem, pageKey } from "@/project/model";
import { useProject } from "@/project/ProjectContext";

type Warning = { code: string; layer?: string; message: string };

export default function RegistrationView() {
  const [{ model, sources, view }] = useProject();
  const summaries = usePageSummaries();
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const artCanvas = useRef<HTMLCanvasElement>(null);
  const overlayCanvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<[number, number]>([0, 0]);

  const { list, surface, artSource, artSummary, targeting, renderable } = useMemo(() => {
    const list = sources.map((s) => ({ id: s.id, pageCount: s.pageCount }));
    const selectedLayer = model.layers.find((l) => l.id === view.selectedLayer);
    const surface =
      model.surfaces.find((s) => s.id === view.surfaceId) ??
      model.surfaces.find((s) => s.id === selectedLayer?.target) ??
      model.surfaces[0];
    const artSource = surface && sources.find((s) => s.id === surface.artwork.sourceId);
    const artSummary = surface && summaries.get(pageKey(surface.artwork));
    const targeting = surface ? model.layers.filter((l) => l.target === surface.id) : [];
    const renderable = targeting.filter((l) => l.enabled && !layerProblem(model, l, list));
    return { list, surface, artSource, artSummary, targeting, renderable };
  }, [model, sources, summaries, view.surfaceId, view.selectedLayer]);

  // The same shared job the 3D material uses: one result, one resolution.
  const finish = useFinish(surface);
  const result = finish.status === "ready" || finish.status === "rendering" ? finish.result : null;
  const state = finish.status === "none" ? "idle" : finish.status;
  const error = finish.status === "failed" ? finish.message : "";

  useEffect(() => {
    if (!stage) return;
    const ro = new ResizeObserver(([e]) => setSize([e.contentRect.width, e.contentRect.height]));
    ro.observe(stage);
    return () => ro.disconnect();
  }, [stage]);

  const hiddenKey = view.hiddenLayers.join(",");
  useEffect(() => {
    if (!result || !artCanvas.current || !overlayCanvas.current) return;
    const { width, height } = result.plan;
    for (const c of [artCanvas.current, overlayCanvas.current]) {
      c.width = width;
      c.height = height;
    }
    artCanvas.current.getContext("2d")!.drawImage(result.artwork, 0, 0);
    const hidden = new Set(hiddenKey.split(","));
    const shown = compose(
      width,
      height,
      result.coverages.filter((c) => !hidden.has(c.id)),
    ).maps;
    const overlay = colorize(shown, { uv: true, raisedUv: true });
    overlayCanvas.current.getContext("2d")!.putImageData(new ImageData(overlay, width, height), 0, 0);
  }, [result, hiddenKey]);

  if (!surface)
    return (
      <div className="registration empty" data-testid="registration" data-state="empty">
        <p>Mark a page as Print and give it a finish to see its registration here.</p>
      </div>
    );

  const nameOf = (id: string) => {
    const l = model.layers.find((x) => x.id === id);
    return l && l.mask.kind === "pdfPage" ? pageName(sources, summaries, l.mask) : "?";
  };
  const warnings: Warning[] = [];
  for (const l of targeting) {
    const problem = layerProblem(model, l, list);
    if (problem) warnings.push({ code: problem.code, layer: nameOf(l.id), message: problem.message });
  }
  // Layers elsewhere in the project that cannot render, grouped by the actual reason.
  const elsewhere = new Map<string, { message: string; count: number }>();
  for (const l of model.layers) {
    if (l.target === surface.id) continue;
    const problem = layerProblem(model, l, list);
    if (!problem) continue;
    const entry = elsewhere.get(problem.code) ?? { message: problem.message, count: 0 };
    entry.count += 1;
    elsewhere.set(problem.code, entry);
  }
  const ELSEWHERE: Record<string, (n: number) => string> = {
    missingTarget: (n) => `${n} finish layer${n > 1 ? "s have" : " has"} no printed page yet.`,
    missingMask: (n) =>
      n > 1
        ? `${n} finish layers have lost their mask pages (their file left the project).`
        : "1 finish layer has lost its mask page (its file left the project).",
    maskRoleChanged: (n) => `${n} finish layer${n > 1 ? "s use" : " uses"} a page no longer marked Mask.`,
  };
  for (const [code, { message, count }] of elsewhere)
    warnings.push({ code, message: ELSEWHERE[code]?.(count) ?? `${count} × ${message}` });
  for (const r of result?.layers ?? []) {
    for (const w of r.warnings) warnings.push({ code: w.code, layer: nameOf(r.id), message: w.message });
    if (r.beyondTrimMm2 > 0.5)
      warnings.push({
        code: "beyondTrim",
        layer: nameOf(r.id),
        message: `${Math.round(r.beyondTrimMm2)} mm² of this finish lies outside the trim and will be cut off.`,
      });
    if (r.alphaUsable === false)
      warnings.push({
        code: "alphaUniform",
        layer: nameOf(r.id),
        message: "Alpha mode on a page painted edge to edge covers everything.",
      });
    if (r.error) warnings.push({ code: "layerFailed", layer: nameOf(r.id), message: r.error });
  }
  for (const o of result?.overlaps ?? [])
    if (o.mm2 > 0.5) {
      const type = model.layers.find((l) => l.id === o.a)?.type ?? "uv";
      warnings.push({
        code: "sameTypeOverlap",
        layer: `${nameOf(o.a)} + ${nameOf(o.b)}`,
        message: `Two ${FINISH_NAMES[type]} masks overlap over ${Math.round(o.mm2)} mm²; the finish covers their union.`,
      });
    }

  const plan = result?.plan;
  // Fit the plan's aspect inside the view.
  const fit = plan ? Math.min(size[0] / plan.width, size[1] / plan.height) : 0;
  const display = plan ? { width: plan.width * fit, height: plan.height * fit } : undefined;

  return (
    <div
      className="registration"
      data-testid="registration"
      data-state={state}
      data-surface={artSource ? pageName(sources, summaries, surface.artwork) : ""}
    >
      <div className="registration-stage" ref={setStage}>
        {plan ? (
          <div
            className="registration-page"
            style={display}
            data-testid="registration-page"
            data-plan={JSON.stringify({
              view: plan.view,
              region: plan.region,
              rotation: plan.rotation,
              pxPerUnit: plan.pxPerUnit,
              offsetX: plan.offsetX,
              offsetY: plan.offsetY,
              width: plan.width,
              height: plan.height,
            })}
            data-anchor={JSON.stringify(frameOf(artSummary!, surface.box)?.anchor)}
            data-user-unit={artSummary!.userUnit}
            data-digest={result!.digest}
          >
            <canvas ref={artCanvas} aria-label="Artwork" />
            <canvas ref={overlayCanvas} data-testid="overlay" aria-label="Finish coverage overlay" />
            <svg viewBox={`0 0 ${plan.width} ${plan.height}`} aria-hidden="true">
              <rect
                x={result!.bleed[0]}
                y={result!.bleed[1]}
                width={result!.bleed[2] - result!.bleed[0]}
                height={result!.bleed[3] - result!.bleed[1]}
                fill="none"
                stroke="#ff7a6b"
                strokeDasharray={`${plan.width / 80} ${plan.width / 120}`}
                strokeWidth={Math.max(1, plan.width / 500)}
              />
              <rect
                x={result!.trim[0]}
                y={result!.trim[1]}
                width={result!.trim[2] - result!.trim[0]}
                height={result!.trim[3] - result!.trim[1]}
                fill="none"
                stroke="#4fd18b"
                strokeWidth={Math.max(1, plan.width / 500)}
              />
            </svg>
          </div>
        ) : (
          <p className="muted">{state === "failed" ? `Could not render: ${error}` : "Rendering…"}</p>
        )}
      </div>
      <aside className="registration-info">
        <p>
          <strong>{artSource ? pageName(sources, summaries, surface.artwork) : "Missing page"}</strong> ·{" "}
          {surface.box.replace("Box", "")} box · {renderable.length} finish
          {renderable.length === 1 ? "" : "es"},{" "}
          {renderable.filter((l) => !view.hiddenLayers.includes(l.id)).length} in the overlay
          {state === "rendering" ? " · updating…" : ""}
        </p>
        <p className="legend">
          <span>
            <i style={{ background: `rgb(${OVERLAY_COLORS.uv.join(",")})` }} /> Ordinary UV
          </span>
          <span>
            <i style={{ background: `rgb(${OVERLAY_COLORS.raisedUv.join(",")})` }} /> Raised UV
          </span>
          <span>
            <i className="line" style={{ borderColor: "#4fd18b" }} /> Trim
          </span>
          <span>
            <i className="line dashed" style={{ borderColor: "#ff7a6b" }} /> Bleed
          </span>
          <span className="muted">Overlay colours are for checking registration only.</span>
        </p>
        {warnings.length ? (
          <ul className="diagnostics" data-testid="registration-warnings">
            {warnings.map((w, i) => (
              <li key={i} data-level="warning" data-code={w.code} data-layer={w.layer ?? ""}>
                {w.layer ? <strong>{w.layer}: </strong> : null}
                {w.message}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted" data-testid="registration-ok">
            No registration warnings.
          </p>
        )}
      </aside>
    </div>
  );
}
