"use client";

/**
 * The selected page of any source: its role (Print, Mask, Ignore), label,
 * size, rotation, the five boxes with provenance, a MediaBox render with
 * every box outlined, and manual trim/bleed. An override replaces a box's
 * effective value; the source fact stays listed.
 */
import { useEffect, useRef, useState } from "react";
import { ARTWORK_POLICY, sizeMm, toDevice, type Rect, type RenderPlan } from "@/pdf/transform";
import { BOX_NAMES, insetBy, outsetBy, type BoxRow, type PageSummary } from "@/project/facts";
import { useProject } from "@/project/ProjectContext";
import { CapabilityText } from "./SourcesSection";
import { ORIGIN_TEXT, mm, noSizeText, sizeText } from "./format";
import { pageName, usePageSummaries } from "./usePages";
import {
  FINISH_NAMES,
  pageKey,
  roleOf,
  surfaceFor,
  type PageRef,
  type PageRole,
  type SurfaceBox,
} from "@/project/model";
import type { SourceView } from "@/project/store";

const OUTLINE: Record<string, string> = {
  CropBox: "#8fb3ff",
  BleedBox: "#ff7a6b",
  TrimBox: "#4fd18b",
  ArtBox: "#d9a6ff",
};

function BoxPreview({ page, source }: { page: PageSummary; source: SourceView }) {
  const revision = source.revision;
  const [, store] = useProject();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [plan, setPlan] = useState<RenderPlan | null>(null);
  const [state, setState] = useState<"rendering" | "rendered" | "failed">("rendering");
  const [error, setError] = useState("");
  const media = page.boxes[0].effective;

  useEffect(() => {
    const session = store.session(source.id, revision);
    const el = canvas.current;
    if (!session || !el) return;
    const abort = new AbortController();
    const cssWidth = el.parentElement?.clientWidth ?? 300;
    setState("rendering");
    session
      .render(
        page.index,
        {
          // The whole MediaBox, so content outside the CropBox shows; until native geometry arrives, the base box.
          region: media ?? undefined,
          rotation: page.rotation.displayed,
          purpose: "interactive",
          longestSidePx: Math.round(cssWidth * (window.devicePixelRatio || 1)),
          policy: ARTWORK_POLICY,
        },
        el,
        { signal: abort.signal },
      )
      .then(
        (p) => {
          if (abort.signal.aborted) return;
          setPlan(p);
          setState("rendered");
        },
        (e: { code?: string; message?: string }) => {
          if (abort.signal.aborted) return;
          setError(e?.code ? `${e.code}: ${e.message}` : String(e?.message ?? e));
          setState("failed");
        },
      );
    return () => abort.abort();
    // `media` is compared by value through its string form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, revision, page.index, page.rotation.displayed, String(media)]);

  const outline = (rect: Rect) =>
    plan
      ? (
          [
            [rect[0], rect[1]],
            [rect[2], rect[1]],
            [rect[2], rect[3]],
            [rect[0], rect[3]],
          ] as [number, number][]
        )
          .map((pt) => toDevice(plan, pt).join(","))
          .join(" ")
      : "";

  return (
    <figure className="box-preview" data-testid="box-preview" data-state={state}>
      <div className="box-preview-frame">
        <canvas ref={canvas} aria-label={`Page ${page.index + 1} rendered with its boxes outlined`} />
        {plan ? (
          <svg viewBox={`0 0 ${plan.width} ${plan.height}`} aria-hidden="true">
            {page.boxes
              .slice(1)
              .map((b) =>
                b.effective ? (
                  <polygon
                    key={b.name}
                    points={outline(b.effective)}
                    fill="none"
                    stroke={OUTLINE[b.name]}
                    strokeWidth={Math.max(1.5, plan.width / 260)}
                    strokeDasharray={
                      b.origin === "default" ? `${plan.width / 60} ${plan.width / 90}` : undefined
                    }
                  />
                ) : null,
              )}
          </svg>
        ) : null}
      </div>
      {state === "failed" ? (
        <p className="status" data-state="failed">
          The preview could not be rendered ({error}).
        </p>
      ) : null}
      <figcaption className="legend">
        {Object.entries(OUTLINE).map(([name, color]) => (
          <span key={name}>
            <i style={{ borderColor: color }} /> {name.replace("Box", "")}
          </span>
        ))}
        <span className="muted">dashed: format default</span>
      </figcaption>
    </figure>
  );
}

function BoxTable({ page }: { page: PageSummary }) {
  return (
    <table className="boxes" data-testid="box-table">
      <thead>
        <tr>
          <th scope="col">Box</th>
          <th scope="col">Size (mm)</th>
          <th scope="col">Where it comes from</th>
        </tr>
      </thead>
      <tbody>
        {page.boxes.map((b: BoxRow) => (
          <tr key={b.name} data-box={b.name} data-origin={b.origin}>
            <th scope="row">{b.name.replace("Box", "")}</th>
            <td>{b.effective ? sizeText(sizeMm(b.effective, page.userUnit)).replace(" mm", "") : "—"}</td>
            <td>
              <span className="origin" data-origin={b.origin}>
                {ORIGIN_TEXT[b.origin]}
              </span>
              {b.derivation ? <span className="muted"> ({b.derivation})</span> : null}
              {b.source?.adjustments?.length ? (
                <span className="muted"> · {b.source.adjustments.join(", ")}</span>
              ) : null}
              {b.origin === "override" && b.source ? (
                <span className="muted" data-testid="source-fact">
                  {" "}
                  · file: {ORIGIN_TEXT[b.source.origin]},{" "}
                  {sizeText(sizeMm(b.source.effective, page.userUnit))}
                </span>
              ) : null}
              {b.origin === "invalid" && b.source?.raw ? (
                <span className="muted"> · file says [{b.source.raw.join(", ")}]</span>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Overrides({ page, source }: { page: PageSummary; source: SourceView }) {
  const pageCount = source.pageCount;
  const [{ overrides }, store] = useProject();
  const [inset, setInset] = useState("3");
  const [bleed, setBleed] = useState("3");
  const [allPages, setAllPages] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const media = page.boxes[0].effective;
  const trim = page.boxes[BOX_NAMES.indexOf("TrimBox")].effective;
  const targets: PageRef[] = (allPages ? Array.from({ length: pageCount }, (_, i) => i) : [page.index]).map(
    (i) => ({
      sourceId: source.id,
      page: i,
    }),
  );
  const hasOverride = targets.some((ref) => overrides[pageKey(ref)]);

  if (!media || !trim)
    return <p className="hint">Manual trim and bleed become available once the page boxes are read.</p>;

  const setTrim = () => {
    const r = insetBy(media, Number(inset), page.userUnit);
    if (!r.ok) return setMessage(r.message);
    store.setOverride(targets, {
      trim: { rect: r.rect, derivation: `MediaBox inset ${mm(Number(inset))} mm` },
    });
    setMessage(null);
  };
  const setBleedBox = () => {
    const r = outsetBy(trim, Number(bleed), page.userUnit, media);
    if (!r.ok) return setMessage(r.message);
    store.setOverride(targets, { bleed: { rect: r.rect, derivation: `trim + ${mm(Number(bleed))} mm` } });
    setMessage(r.note ?? null);
  };

  return (
    <div className="overrides" data-testid="overrides">
      <label className="inline">
        Trim: MediaBox inset by
        <input
          type="number"
          min={0}
          step={0.5}
          value={inset}
          data-testid="trim-inset"
          onChange={(e) => setInset(e.target.value)}
        />
        mm
        <button type="button" data-testid="set-trim" onClick={setTrim}>
          Set
        </button>
      </label>
      <label className="inline">
        Bleed: trim plus
        <input
          type="number"
          min={0}
          step={0.5}
          value={bleed}
          data-testid="bleed-outset"
          onChange={(e) => setBleed(e.target.value)}
        />
        mm
        <button type="button" data-testid="set-bleed" onClick={setBleedBox}>
          Set
        </button>
      </label>
      {pageCount > 1 ? (
        <label className="check">
          <input type="checkbox" checked={allPages} onChange={(e) => setAllPages(e.target.checked)} /> Apply
          to all {pageCount} pages
        </label>
      ) : null}
      <button
        type="button"
        data-testid="clear-overrides"
        disabled={!hasOverride}
        onClick={() => store.setOverride(targets, { trim: undefined, bleed: undefined })}
      >
        Clear manual trim and bleed
      </button>
      {message ? (
        <p className="hint" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}

const ROLES: [PageRole, string][] = [
  ["unassigned", "Unassigned"],
  ["print", "Print"],
  ["mask", "Mask"],
  ["ignore", "Ignore"],
];

const SURFACE_BOXES: SurfaceBox[] = ["TrimBox", "BleedBox", "CropBox", "MediaBox"];

/** Role, and what the role means for this page: its surface, or the finishes it supplies. */
function PageRoleControls({ refPage }: { refPage: PageRef }) {
  const [{ model, sources }, store] = useProject();
  const summaries = usePageSummaries();
  const role = roleOf(model, refPage);
  const surface = surfaceFor(model, refPage);
  const finishes = model.layers.filter(
    (l) => l.mask.kind === "pdfPage" && l.mask.sourceId === refPage.sourceId && l.mask.page === refPage.page,
  );
  const targeting = surface ? model.layers.filter((l) => l.target === surface.id) : [];
  const nameOf = (id: string | null) => {
    const s = model.surfaces.find((x) => x.id === id);
    return s ? pageName(sources, summaries, s.artwork) : "no page yet";
  };
  return (
    <div className="role" data-testid="role" data-role={role}>
      <div className="segmented" role="radiogroup" aria-label="Page role">
        {ROLES.map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={role === value}
            data-testid={`role-${value}`}
            onClick={() => store.setRole(refPage, value)}
          >
            {label}
          </button>
        ))}
      </div>
      {surface ? (
        <label className="inline">
          Printed page uses its
          <select
            data-testid="surface-box"
            value={surface.box}
            onChange={(e) => store.setSurfaceBox(surface.id, e.target.value as SurfaceBox)}
          >
            {SURFACE_BOXES.map((b) => (
              <option key={b} value={b}>
                {b.replace("Box", "")}
              </option>
            ))}
          </select>
          box
        </label>
      ) : null}
      {surface ? (
        <p className="hint">
          {targeting.length
            ? `Finishes on this page: ${targeting.map((l) => FINISH_NAMES[l.type]).join(", ")}.`
            : "No finish targets this page yet."}
        </p>
      ) : null}
      {role === "mask" ? (
        <p className="hint">
          {finishes.map((l) => `${FINISH_NAMES[l.type]} → ${nameOf(l.target)}`).join("; ")}.{" "}
          <button type="button" className="link" onClick={() => store.addLayer(refPage, "uv")}>
            Use this page for another finish
          </button>
        </p>
      ) : null}
    </div>
  );
}

export function PageInspector() {
  const [{ sources, selected }] = useProject();
  const summaries = usePageSummaries();
  const source = sources.find((s) => s.id === selected?.sourceId);
  const page = selected ? summaries.get(pageKey(selected)) : undefined;
  if (!source || !page || !selected) return <p className="hint">Select a page to inspect it.</p>;
  const r = page.rotation;
  return (
    <div data-testid="inspector" data-page={page.index} data-source={source.name}>
      <PageRoleControls refPage={selected} />
      <dl className="facts">
        <dt>Page</dt>
        <dd>
          {page.index + 1} of {source.pageCount} in {source.name}
        </dd>
        <dt>Label</dt>
        <dd data-testid="page-label">
          {page.label ?? (
            <CapabilityText
              cap={
                source.labels.status === "available"
                  ? { status: "absent", provenance: source.labels.provenance }
                  : source.labels
              }
              absent="none"
            />
          )}
        </dd>
        <dt>Trim size</dt>
        <dd data-testid="trim-size">
          {page.trimMm
            ? `${sizeText(page.trimMm)} (${ORIGIN_TEXT[page.trimOrigin]})`
            : noSizeText(source.geometry)}
        </dd>
        <dt>Rotation</dt>
        <dd data-testid="rotation" data-invalid={r.invalid}>
          {r.invalid
            ? `${r.raw}° is not a multiple of 90°; shown unrotated`
            : `${r.displayed}° (${r.from === "native" ? ORIGIN_TEXT[r.origin as BoxRow["origin"]] : "PDF.js, boxes not read yet"})`}
        </dd>
        {page.userUnit !== 1 ? (
          <>
            <dt>UserUnit</dt>
            <dd>
              {page.userUnit} (1 unit = {page.userUnit}/72 in)
            </dd>
          </>
        ) : null}
      </dl>
      {source.geometry.status === "failed" ? (
        <p className="status" data-state="failed" data-testid="geometry-failed">
          Page boxes could not be read ({source.geometry.code}): {source.geometry.message} The page is shown
          from PDF.js alone.
        </p>
      ) : null}
      <BoxPreview key={source.id} page={page} source={source} />
      <BoxTable page={page} />
      <Overrides page={page} source={source} />
    </div>
  );
}
