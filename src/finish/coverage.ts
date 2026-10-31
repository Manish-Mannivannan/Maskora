/**
 * From mask pixels to finish coverage, and from coverage to the finish maps
 * that both the registration overlay and the material use (architecture §7.4).
 * Pure functions over pixel arrays, so they run anywhere and are tested
 * without a renderer.
 *
 * Combination rule (order-independent for the Phase 1 types):
 * - layers of the same type unite (per-pixel maximum), and an overlap between
 *   them is reported, because two masks for one finish usually mean a mistake;
 * - raised UV replaces ordinary UV where both cover: ordinary UV keeps only
 *   the part not under raised UV (uv × (1 − raised)).
 * Layer order is kept and shown; it decides nothing yet, and becomes
 * meaningful when stacking finishes (foil, emboss) arrive.
 */
import type { FinishType, MaskInterpretation } from "@/project/model";

/** Rec. 709 luma of 8-bit sRGB values, 0–1 (not linearized: masks are drawn as ink, not light). */
const luma = (r: number, g: number, b: number) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/** Coverage 0–255 per pixel. `pxPerMm` converts the feather radius. */
export function coverageFromPixels(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  interpretation: MaskInterpretation,
  pxPerMm: number,
): Uint8Array {
  const { mode, polarity, invert, threshold } = interpretation;
  const out = new Uint8Array(width * height);
  for (let i = 0; i < out.length; i += 1) {
    const p = i * 4;
    let v =
      mode === "alpha"
        ? rgba[p + 3] / 255
        : polarity === "dark"
          ? 1 - luma(rgba[p], rgba[p + 1], rgba[p + 2])
          : luma(rgba[p], rgba[p + 1], rgba[p + 2]);
    if (invert) v = 1 - v;
    out[i] = v >= threshold ? 255 : 0;
  }
  const radius = Math.round(interpretation.featherMm * pxPerMm);
  return radius > 0 ? boxBlur(out, width, height, radius) : out;
}

/** Three box-blur passes in each direction: a close, linear-time approximation of a Gaussian. */
export function boxBlur(src: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  let a = new Float32Array(src.length);
  a.set(src);
  let b = new Float32Array(src.length);
  const inv = 1 / (2 * radius + 1);
  // One sliding-window pass along lines of `len` samples spaced `step` apart, starting at `first(line)`.
  // Edges extend their last value, so coverage does not fade at the canvas border.
  const pass = (
    from: Float32Array,
    to: Float32Array,
    lines: number,
    len: number,
    lineStride: number,
    step: number,
  ) => {
    const last = (len - 1) * step;
    for (let line = 0; line < lines; line += 1) {
      const base = line * lineStride;
      let sum = from[base] * (radius + 1);
      for (let k = 1; k <= radius; k += 1) sum += from[base + Math.min(k, len - 1) * step];
      for (let k = 0; k < len; k += 1) {
        to[base + k * step] = sum * inv;
        const add = k + radius + 1 < len ? (k + radius + 1) * step : last;
        const sub = k - radius > 0 ? (k - radius) * step : 0;
        sum += from[base + add] - from[base + sub];
      }
    }
  };
  for (let n = 0; n < 3; n += 1) {
    pass(a, b, height, width, width, 1);
    [a, b] = [b, a];
    pass(a, b, width, height, 1, width);
    [a, b] = [b, a];
  }
  const out = new Uint8Array(src.length);
  for (let i = 0; i < out.length; i += 1) out[i] = Math.round(a[i]);
  return out;
}

/**
 * Whether rendered alpha carries information: the page's interior must be
 * partly opaque and partly transparent (alpha either side of 50 %). A page
 * painted edge to edge is not, even though anti-aliasing leaves its outermost
 * pixels part-transparent when the sheet edge falls between pixels, so a
 * border of `edge` pixels is ignored.
 */
export function alphaVaries(rgba: Uint8ClampedArray, width: number, height: number, edge = 2): boolean {
  let opaque = false;
  let clear = false;
  for (let y = edge; y < height - edge; y += 1)
    for (let x = edge; x < width - edge; x += 1) {
      if (rgba[(y * width + x) * 4 + 3] >= 128) opaque = true;
      else clear = true;
      if (opaque && clear) return true;
    }
  return false;
}

export interface FinishMaps {
  width: number;
  height: number;
  /** Ordinary UV after raised UV has replaced it where both cover. */
  uv: Uint8Array;
  raisedUv: Uint8Array;
}

export interface LayerCoverage {
  id: string;
  type: FinishType;
  coverage: Uint8Array;
}

export interface Overlap {
  a: string;
  b: string;
  /** Pixels covered (≥ 50 %) by both. */
  pixels: number;
}

export function compose(
  width: number,
  height: number,
  layers: LayerCoverage[],
): { maps: FinishMaps; overlaps: Overlap[] } {
  const n = width * height;
  const union = { uv: new Uint8Array(n), raisedUv: new Uint8Array(n) };
  for (const layer of layers) {
    const target = union[layer.type];
    for (let i = 0; i < n; i += 1) if (layer.coverage[i] > target[i]) target[i] = layer.coverage[i];
  }
  const uv = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) uv[i] = Math.round((union.uv[i] * (255 - union.raisedUv[i])) / 255);

  const overlaps: Overlap[] = [];
  for (let x = 0; x < layers.length; x += 1)
    for (let y = x + 1; y < layers.length; y += 1) {
      if (layers[x].type !== layers[y].type) continue;
      let pixels = 0;
      for (let i = 0; i < n; i += 1)
        if (layers[x].coverage[i] >= 128 && layers[y].coverage[i] >= 128) pixels += 1;
      if (pixels) overlaps.push({ a: layers[x].id, b: layers[y].id, pixels });
    }
  return { maps: { width, height, uv, raisedUv: union.raisedUv }, overlaps };
}

/** Covered pixels (≥ 50 %) outside `rect` = [x0, y0, x1, y1] in device pixels. */
export function coveredOutside(
  coverage: Uint8Array,
  width: number,
  height: number,
  rect: [number, number, number, number],
): number {
  const [x0, y0, x1, y1] = rect.map(Math.round);
  let count = 0;
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1)
      if ((x < x0 || x >= x1 || y < y0 || y >= y1) && coverage[y * width + x] >= 128) count += 1;
  return count;
}

/** Registration overlay colours: never part of a material or an export (§4.4). */
export const OVERLAY_COLORS: Record<FinishType, [number, number, number]> = {
  uv: [0, 200, 255],
  raisedUv: [255, 40, 200],
};

/** RGBA overlay of the finish maps; hidden types are left out. */
export function colorize(
  maps: FinishMaps,
  show: Record<FinishType, boolean>,
  opacity = 0.6,
): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(maps.width * maps.height * 4);
  for (let i = 0; i < maps.uv.length; i += 1) {
    const raised = show.raisedUv ? maps.raisedUv[i] : 0;
    const uv = show.uv ? maps.uv[i] : 0;
    const [c, a] = raised >= uv ? [OVERLAY_COLORS.raisedUv, raised] : [OVERLAY_COLORS.uv, uv];
    if (!a) continue;
    out.set([c[0], c[1], c[2], Math.round(a * opacity)], i * 4);
  }
  return out;
}
