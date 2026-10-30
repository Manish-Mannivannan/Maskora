import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_INTERPRETATION, type MaskInterpretation } from "@/project/model";
import {
  alphaVaries,
  colorize,
  compose,
  coverageFromPixels,
  coveredOutside,
  OVERLAY_COLORS,
} from "./coverage";
import { maskRegion, registrationWarnings, type PageFrame } from "./registration";
import type { Rect } from "@/pdf/transform";

const interp = (patch: Partial<MaskInterpretation> = {}) => ({ ...DEFAULT_INTERPRETATION, ...patch });
const pixels = (...rgba: number[][]) => Uint8ClampedArray.from(rgba.flat());

describe("coverage from mask pixels", () => {
  const black = [0, 0, 0, 255];
  const white = [255, 255, 255, 255];
  // Luma 100/255 = 0.392: dark coverage 0.608, light coverage 0.392.
  const grey = [100, 100, 100, 255];
  const clear = [0, 0, 0, 0];

  it("luminance, both polarities, invert and threshold", () => {
    const px = pixels(black, white, grey);
    expect([...coverageFromPixels(px, 3, 1, interp(), 1)]).toEqual([255, 0, 255]);
    expect([...coverageFromPixels(px, 3, 1, interp({ polarity: "light" }), 1)]).toEqual([0, 255, 0]);
    expect([...coverageFromPixels(px, 3, 1, interp({ invert: true }), 1)]).toEqual([0, 255, 0]);
    expect([...coverageFromPixels(px, 3, 1, interp({ threshold: 0.7 }), 1)]).toEqual([255, 0, 0]);
  });

  it("alpha mode reads transparency, not colour", () => {
    const px = pixels(black, clear, white);
    expect([...coverageFromPixels(px, 3, 1, interp({ mode: "alpha" }), 1)]).toEqual([255, 0, 255]);
  });

  it("feather softens an edge symmetrically and keeps the covered area", () => {
    const w = 40;
    const hard = new Uint8ClampedArray(w * 4);
    for (let x = 0; x < w; x += 1) hard.set(x < 20 ? black : white, x * 4);
    const soft = coverageFromPixels(hard, w, 1, interp({ featherMm: 1 }), 3);
    expect(soft[0]).toBe(255);
    expect(soft[w - 1]).toBe(0);
    expect(Math.abs(soft[19] + soft[20] - 255)).toBeLessThanOrEqual(2);
    const total = soft.reduce((s, v) => s + v, 0);
    expect(Math.abs(total - 20 * 255)).toBeLessThanOrEqual(w);
  });

  it("alpha is usable only when the interior is partly opaque and partly clear", () => {
    const page = (w: number, h: number, at: (x: number, y: number) => number[]) =>
      Uint8ClampedArray.from(Array.from({ length: w * h }, (_, i) => at(i % w, Math.floor(i / w))).flat());
    // Painted edge to edge, with anti-aliased part-transparent outer pixels: not usable.
    const painted = page(8, 8, (x, y) => (x === 7 || y === 0 ? [255, 255, 255, 90] : white));
    expect(alphaVaries(painted, 8, 8)).toBe(false);
    // Nothing painted at all: not usable either.
    expect(
      alphaVaries(
        page(8, 8, () => clear),
        8,
        8,
      ),
    ).toBe(false);
    // A shape on a transparent page: usable.
    expect(
      alphaVaries(
        page(8, 8, (x) => (x < 4 ? black : clear)),
        8,
        8,
      ),
    ).toBe(true);
  });
});

/** A width×height coverage with `rect` [x0,y0,x1,y1) covered. */
const rectCoverage = (w: number, h: number, [x0, y0, x1, y1]: number[]) => {
  const c = new Uint8Array(w * h);
  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) c[y * w + x] = 255;
  return c;
};

describe("combining finish layers", () => {
  const W = 20;
  const H = 10;
  const raised = { id: "r", type: "raisedUv" as const, coverage: rectCoverage(W, H, [0, 0, 8, 10]) };
  const uvA = { id: "a", type: "uv" as const, coverage: rectCoverage(W, H, [5, 0, 14, 10]) };
  const uvB = { id: "b", type: "uv" as const, coverage: rectCoverage(W, H, [12, 0, 18, 10]) };

  it("raised UV replaces ordinary UV where both cover; same-type layers unite and their overlap is reported", () => {
    const { maps, overlaps } = compose(W, H, [raised, uvA, uvB]);
    const at = (m: Uint8Array, x: number) => m[5 * W + x];
    expect([at(maps.raisedUv, 3), at(maps.uv, 3)]).toEqual([255, 0]);
    expect([at(maps.raisedUv, 6), at(maps.uv, 6)]).toEqual([255, 0]);
    expect([at(maps.raisedUv, 10), at(maps.uv, 10)]).toEqual([0, 255]);
    expect([at(maps.raisedUv, 13), at(maps.uv, 13)]).toEqual([0, 255]);
    expect([at(maps.raisedUv, 19), at(maps.uv, 19)]).toEqual([0, 0]);
    expect(overlaps).toEqual([{ a: "a", b: "b", pixels: 2 * H }]);
  });

  it("the result does not depend on layer order", () => {
    const one = compose(W, H, [raised, uvA, uvB]).maps;
    const two = compose(W, H, [uvB, uvA, raised]).maps;
    expect(two.uv).toEqual(one.uv);
    expect(two.raisedUv).toEqual(one.raisedUv);
  });

  it("the overlay is drawn from the same maps the material gets, with visibility per finish", () => {
    const { maps } = compose(W, H, [raised, uvA]);
    const overlay = colorize(maps, { uv: true, raisedUv: true }, 1);
    const px = (x: number) => [...overlay.slice((5 * W + x) * 4, (5 * W + x) * 4 + 4)];
    expect(px(3)).toEqual([...OVERLAY_COLORS.raisedUv, 255]);
    expect(px(10)).toEqual([...OVERLAY_COLORS.uv, 255]);
    expect(px(19)[3]).toBe(0);
    expect(colorize(maps, { uv: false, raisedUv: true }, 1)[(5 * W + 10) * 4 + 3]).toBe(0);
  });

  it("counts coverage outside the trim", () => {
    expect(coveredOutside(uvB.coverage, W, H, [0, 0, 16, 10])).toBe(2 * H);
    expect(coveredOutside(uvA.coverage, W, H, [0, 0, 16, 10])).toBe(0);
  });
});

describe("registration", () => {
  const k2m = JSON.parse(readFileSync(join(__dirname, "../../tests/fixtures/pdf/K2m.expected.json"), "utf8"));
  const pt = (mm: number) => (mm * 72) / 25.4;
  /** The fixture generator's page layout: a 100 × 150 mm trim at `at` mm on a sheet 3 mm larger to the top and right. */
  const frame = (at = [3, 3], trim = [100, 150], userUnit = 1): PageFrame => ({
    anchor: [pt(at[0]), pt(at[1]), pt(at[0] + trim[0]), pt(at[1] + trim[1])].map((v) => v / userUnit) as Rect,
    media: [0, 0, pt(at[0] + trim[0] + 3), pt(at[1] + trim[1] + 3)].map((v) => v / userUnit) as Rect,
    userUnit,
    rotation: 0,
  });

  it("aligns the boxes: the artwork's trim lands on the mask's trim wherever each sits on its sheet", () => {
    const art = frame();
    const mask = frame([13, 13]);
    const r = maskRegion(art.anchor, art, mask, [0, 0]);
    r.forEach((v, i) => expect(v).toBeCloseTo(mask.anchor[i], 9));
  });

  it("an offset shifts the mask by millimetres: +X right, +Y up", () => {
    const art = frame();
    const r = maskRegion(art.anchor, art, art, k2m.pages[2].correctionMm);
    // Moving the mask left 1.5 mm and up 1 mm means reading it from 1.5 mm further right and 1 mm lower.
    expect(r[0] - art.anchor[0]).toBeCloseTo(pt(1.5), 9);
    expect(r[1] - art.anchor[1]).toBeCloseTo(pt(-1), 9);
  });

  it("registers across UserUnits by physical size", () => {
    const art = frame();
    const mask = frame([3, 3], [100, 150], 2);
    const r = maskRegion(art.anchor, art, mask, [0, 0]);
    r.forEach((v, i) => expect(v).toBeCloseTo(mask.anchor[i], 9));
    expect(registrationWarnings(art, mask, "TrimBox")).toEqual([]);
  });

  it("reports K2m's size and origin mismatches, and rotation differences, without correcting them", () => {
    const codes = (m: PageFrame) => registrationWarnings(frame(), m, "TrimBox").map((w) => w.code);
    expect(codes(frame([13, 13]))).toEqual(k2m.pages[0].warnings);
    expect(codes(frame())).toEqual(k2m.pages[1].warnings);
    expect(codes(frame([3, 3], [101, 150]))).toEqual(k2m.pages[3].warnings);
    expect(codes({ ...frame(), rotation: 90 })).toEqual(["rotationMismatch"]);
  });
});
