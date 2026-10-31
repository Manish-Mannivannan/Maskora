/**
 * The coverage pipeline for one print surface (architecture §7.4): render the
 * artwork region, render each finish layer's mask page over the same region
 * through the registration mapping, turn the pixels into coverage, and
 * combine the layers into finish maps. The registration overlay is drawn
 * from these maps, and the page material (step 1.3) takes the same maps, so
 * the two cannot disagree about where a finish is.
 *
 * Window-only: it renders with PDF.js into canvases.
 */
import type { PdfSession } from "@/pdf/adapter";
import { ARTWORK_POLICY, mmPerUnit, toDevice, type Rect, type RenderPlan } from "@/pdf/transform";
import type { PageSummary } from "@/project/facts";
import type { FinishLayer, PrintSurface } from "@/project/model";
import {
  alphaVaries,
  compose,
  coverageFromPixels,
  coveredOutside,
  type FinishMaps,
  type LayerCoverage,
  type Overlap,
} from "./coverage";
import { maskRegion, registrationWarnings, type PageFrame, type RegistrationWarning } from "./registration";

export interface PageInput {
  session: PdfSession;
  summary: PageSummary;
}

export interface LayerInput {
  layer: FinishLayer;
  mask: PageInput;
}

export interface LayerResult {
  id: string;
  warnings: RegistrationWarning[];
  /** Covered area outside the trim, in mm². */
  beyondTrimMm2: number;
  /** Alpha mode only: whether the rendered page's alpha varies at all. */
  alphaUsable: boolean | null;
  error: string | null;
}

export interface RegistrationResult {
  plan: RenderPlan;
  artwork: HTMLCanvasElement;
  maps: FinishMaps;
  /** Each layer's coverage, so a view can show a subset without recomputing. */
  coverages: LayerCoverage[];
  /** FNV-1a of the finish maps: equal digests mean byte-identical coverage. */
  digest: string;
  overlaps: (Overlap & { mm2: number })[];
  layers: LayerResult[];
  /** Device rectangles [x0, y0, x1, y1] for outlines. */
  trim: [number, number, number, number];
  bleed: [number, number, number, number];
  pxPerMm: number;
}

/** FNV-1a over both finish maps. */
export function mapsDigest(maps: FinishMaps): string {
  let h = 0x811c9dc5;
  for (const plane of [maps.uv, maps.raisedUv])
    for (let i = 0; i < plane.length; i += 1) {
      h ^= plane[i];
      h = Math.imul(h, 0x01000193);
    }
  return `${maps.width}x${maps.height}:${(h >>> 0).toString(16).padStart(8, "0")}`;
}

const box = (s: PageSummary, name: string) => s.boxes.find((b) => b.name === name)?.effective ?? null;

/** The page frame the registration mapping needs, or null until native geometry is known. */
export function frameOf(summary: PageSummary, anchorBox: string): PageFrame | null {
  const anchor = box(summary, anchorBox);
  const media = box(summary, "MediaBox");
  if (!anchor || !media) return null;
  return { anchor, media, userUnit: summary.userUnit, rotation: summary.rotation.displayed };
}

function deviceRect(plan: RenderPlan, r: Rect): [number, number, number, number] {
  const a = toDevice(plan, [r[0], r[1]]);
  const b = toDevice(plan, [r[2], r[3]]);
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
}

/** Pixels of `canvas` at exactly `width` × `height` (a mask plan may round one pixel differently). */
function pixelsAt(canvas: HTMLCanvasElement, width: number, height: number) {
  let source = canvas;
  if (canvas.width !== width || canvas.height !== height) {
    source = document.createElement("canvas");
    source.width = width;
    source.height = height;
    source.getContext("2d")!.drawImage(canvas, 0, 0, width, height);
  }
  return source.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, width, height).data;
}

export async function runRegistration(
  surface: PrintSurface,
  art: PageInput,
  layers: LayerInput[],
  longestSidePx: number,
  signal: AbortSignal,
): Promise<RegistrationResult> {
  const artFrame = frameOf(art.summary, surface.box);
  const bleedBox = box(art.summary, "BleedBox");
  if (!artFrame || !bleedBox) throw new Error("The artwork page's boxes are not known yet.");
  // Show the bleed around the surface's box, so coverage past the trim is visible.
  const region: Rect = [
    Math.min(bleedBox[0], artFrame.anchor[0]),
    Math.min(bleedBox[1], artFrame.anchor[1]),
    Math.max(bleedBox[2], artFrame.anchor[2]),
    Math.max(bleedBox[3], artFrame.anchor[3]),
  ];
  const rotation = art.summary.rotation.displayed;
  const artwork = document.createElement("canvas");
  const plan = await art.session.render(
    art.summary.index,
    { region, rotation, purpose: "interactive", longestSidePx, policy: ARTWORK_POLICY },
    artwork,
    { signal },
  );
  const { width, height } = plan;
  const pxPerMm = plan.pxPerUnit / mmPerUnit(art.summary.userUnit);
  const trim = deviceRect(plan, box(art.summary, "TrimBox") ?? artFrame.anchor);

  const coverages: LayerCoverage[] = [];
  const results: LayerResult[] = [];
  for (const { layer, mask } of layers) {
    if (signal.aborted) throw new DOMException("aborted", "AbortError");
    const maskFrame = frameOf(mask.summary, surface.box);
    if (!maskFrame) {
      results.push({
        id: layer.id,
        warnings: [],
        beyondTrimMm2: 0,
        alphaUsable: null,
        error: "The mask page's boxes are not known yet.",
      });
      continue;
    }
    const alpha = layer.interpretation.mode === "alpha";
    const canvas = document.createElement("canvas");
    try {
      await mask.session.render(
        mask.summary.index,
        {
          region: maskRegion(region, artFrame, maskFrame, layer.interpretation.offsetMm),
          rotation,
          purpose: "interactive",
          longestSidePx,
          policy: { background: alpha ? "transparent" : "paper", annotations: "none" },
        },
        canvas,
        { signal },
      );
    } catch (error) {
      if (signal.aborted) throw error;
      results.push({
        id: layer.id,
        warnings: [],
        beyondTrimMm2: 0,
        alphaUsable: null,
        error: String((error as Error)?.message ?? error),
      });
      continue;
    }
    const rgba = pixelsAt(canvas, width, height);
    const coverage = coverageFromPixels(rgba, width, height, layer.interpretation, pxPerMm);
    coverages.push({ id: layer.id, type: layer.type, coverage });
    results.push({
      id: layer.id,
      warnings: registrationWarnings(artFrame, maskFrame, surface.box),
      beyondTrimMm2: coveredOutside(coverage, width, height, trim) / pxPerMm ** 2,
      alphaUsable: alpha ? alphaVaries(rgba, width, height) : null,
      error: null,
    });
  }

  const { maps, overlaps } = compose(width, height, coverages);
  return {
    plan,
    artwork,
    maps,
    coverages,
    digest: mapsDigest(maps),
    overlaps: overlaps.map((o) => ({ ...o, mm2: o.pixels / pxPerMm ** 2 })),
    layers: results,
    trim,
    bleed: deviceRect(plan, bleedBox),
    pxPerMm,
  };
}

const alphaCache = new Map<string, Promise<boolean>>();

/** Whether a mask page has usable alpha: rendered small on a transparent background, once per source revision. */
export function maskAlphaUsable(
  session: PdfSession,
  sourceKey: string,
  page: number,
  rotation: number,
): Promise<boolean> {
  const key = `${sourceKey}:${page}`;
  let job = alphaCache.get(key);
  if (!job) {
    const canvas = document.createElement("canvas");
    job = session
      .render(
        page,
        {
          rotation: rotation as 0,
          purpose: "thumbnail",
          longestSidePx: 256,
          policy: { background: "transparent", annotations: "none" },
        },
        canvas,
      )
      .then((p) =>
        alphaVaries(
          canvas.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, p.width, p.height).data,
          p.width,
          p.height,
        ),
      );
    job.catch(() => alphaCache.delete(key));
    alphaCache.set(key, job);
  }
  return job;
}
