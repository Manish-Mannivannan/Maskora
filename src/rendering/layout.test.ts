import { describe, expect, it } from "vitest";
import { heightProfile, normalMap } from "@/finish/height";
import { ARTWORK_POLICY, planRender, type Rect } from "@/pdf/transform";
import {
  faceGeometry,
  fitDistance,
  leafPlacements,
  localFromUv,
  planeUvs,
  sizesDiffer,
  spreadPlacements,
} from "./layout";

const pt = (mm: number) => (mm * 72) / 25.4;

describe("faces from the shared raster", () => {
  // K1's layout: 100 × 150 mm trim 3 mm inside a 106 × 156 mm sheet, raster of the bleed.
  const media: Rect = [0, 0, pt(106), pt(156)];
  const trim: Rect = [pt(3), pt(3), pt(103), pt(153)];
  const planned = planRender({
    view: media,
    region: media,
    rotation: 0,
    userUnit: 1,
    purpose: "interactive",
    longestSidePx: 2048,
    policy: ARTWORK_POLICY,
  });
  if (!planned.ok) throw new Error();
  const plan = planned.plan;
  const pxPerMm = plan.pxPerUnit / (25.4 / 72);

  it("is the trim at physical size, with texture coordinates selecting the trim", () => {
    const face = faceGeometry(plan, trim, pxPerMm);
    expect(face.size[0]).toBeCloseTo(0.1, 6);
    expect(face.size[1]).toBeCloseTo(0.15, 6);
    // The raster is whole pixels (plan.width is rounded), so coordinates are pixels over the raster's size.
    expect(face.uv.u0).toBeCloseTo((3 * pxPerMm) / plan.width, 9);
    expect(face.uv.v0).toBeCloseTo((3 * pxPerMm) / plan.height, 9);
    expect(face.uv.u1).toBeCloseTo((103 * pxPerMm) / plan.width, 9);
    expect(face.uv.v1).toBeCloseTo((153 * pxPerMm) / plan.height, 9);
    expect([...planeUvs(face)].map((v) => +v.toFixed(4))).toEqual(
      [face.uv.u0, face.uv.v0, face.uv.u1, face.uv.v0, face.uv.u0, face.uv.v1, face.uv.u1, face.uv.v1].map(
        (v) => +v.toFixed(4),
      ),
    );
  });

  it("maps a trim-relative point to the same raster position the overlay samples", () => {
    const face = faceGeometry(plan, trim, pxPerMm);
    // K1 sample (15, 30) mm from the trim's lower-left corner.
    const u = ((3 + 15) * pxPerMm) / plan.width;
    const v = ((156 - 3 - 30) * pxPerMm) / plan.height;
    const [x, y] = localFromUv(face, u, v);
    expect(x).toBeCloseTo(0.015 - 0.05, 6);
    expect(y).toBeCloseTo(0.03 - 0.075, 6);
  });
});

describe("leaf and spread placement", () => {
  it("puts the back behind the front, turned to read from behind", () => {
    const { front, back } = leafPlacements(0.0003);
    expect(front.position[2]).toBeCloseTo(0.00015);
    expect(back.position[2]).toBeCloseTo(-0.00015);
    expect(back.turn).toBeCloseTo(Math.PI);
  });

  it("meets on the spine at x = 0 and reports unequal pages", () => {
    const left: [number, number] = [0.148, 0.21];
    const right: [number, number] = [0.152, 0.2];
    const p = spreadPlacements(left, right, 0.0003);
    expect(p.left.position[0] + left[0] / 2).toBeCloseTo(0, 9);
    expect(p.right.position[0] - right[0] / 2).toBeCloseTo(0, 9);
    expect(sizesDiffer(left, right)).toBe(true);
    expect(sizesDiffer(left, [0.14805, 0.21])).toBe(false);
  });

  it("fits the camera to the larger of width and height", () => {
    const d = fitDistance(0.2, 0.3, 40, 1.5, 1);
    expect(Math.tan((20 * Math.PI) / 180) * d * 2).toBeCloseTo(0.3, 6);
  });
});

describe("raised UV relief", () => {
  const W = 21;
  const square = new Uint8Array(W * W);
  for (let y = 7; y < 14; y += 1) for (let x = 7; x < 14; x += 1) square[y * W + x] = 255;
  const profile = { heightUm: 80, bevelMm: 0.2, crownUm: 0 };

  it("is flat away from edges and leans away from the coating at its edges", () => {
    const n = normalMap(heightProfile(square, W, W, 10, profile), W, W, 10);
    const px = (x: number, y: number) => [...n.slice((y * W + x) * 4, (y * W + x) * 4 + 3)];
    expect(px(0, 0)).toEqual([128, 128, 255]);
    expect(px(10, 10)).toEqual([128, 128, 255]);
    // Left edge rises to the right: the normal leans left (red below 128). Top edge rises downwards: green below 128.
    expect(px(7, 10)[0]).toBeLessThan(120);
    expect(px(10, 7)[1]).toBeLessThan(120);
    // Right and bottom edges lean the other way.
    expect(px(13, 10)[0]).toBeGreaterThan(136);
    expect(px(10, 13)[1]).toBeGreaterThan(136);
  });

  it("stays inside the footprint: no slope two pixels outside the mask", () => {
    const h = heightProfile(square, W, W, 10, profile);
    const n = normalMap(h, W, W, 10);
    for (const [x, y] of [
      [5, 10],
      [15, 10],
      [10, 5],
      [10, 15],
    ])
      expect([...n.slice((y * W + x) * 4, (y * W + x) * 4 + 3)]).toEqual([128, 128, 255]);
    // Float32 storage: equal to 0.08 mm within single precision.
    expect(Math.max(...h)).toBeCloseTo(0.08, 6);
  });

  it("scales with height: zero height is flat everywhere", () => {
    const flat = normalMap(heightProfile(square, W, W, 10, { ...profile, heightUm: 0 }), W, W, 10);
    for (let i = 0; i < flat.length; i += 4)
      expect([flat[i], flat[i + 1], flat[i + 2]]).toEqual([128, 128, 255]);
  });
});
