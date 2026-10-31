import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { compose } from "@/finish/coverage";
import { mapsDigest, type RegistrationResult } from "@/finish/pipeline";
import { DEFAULT_RECIPES, STOCK_PRESETS } from "@/project/model";
import { coatDigest, coatTexture, faceMaterial, reliefTexture, type FinishLook } from "./finishMaterial";

const W = 24;
const H = 16;
const rect = ([x0, y0, x1, y1]: number[]) => {
  const c = new Uint8Array(W * H);
  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) c[y * W + x] = 255;
  return c;
};

/** A pipeline result without rendering: only the maps matter to the material's coverage. */
function result(layers: Parameters<typeof compose>[2]): RegistrationResult {
  const { maps, overlaps } = compose(W, H, layers);
  return {
    maps,
    coverages: layers,
    overlaps: overlaps.map((o) => ({ ...o, mm2: 0 })),
    digest: mapsDigest(maps),
    pxPerMm: 4,
  } as unknown as RegistrationResult;
}

const look = (patch: Partial<FinishLook> = {}): FinishLook => ({
  recipes: DEFAULT_RECIPES,
  stock: { preset: "matte", ...STOCK_PRESETS.matte },
  show: { uv: true, raisedUv: true },
  printOnly: false,
  raisedMode: "normals",
  ...patch,
});

describe("face material", () => {
  const r = result([
    { id: "raised", type: "raisedUv", coverage: rect([2, 2, 10, 14]) },
    { id: "uv", type: "uv", coverage: rect([6, 2, 20, 14]) },
  ]);

  it("holds the pipeline's coverage byte for byte: the coat texture's digest equals the maps' digest", () => {
    const coat = coatTexture(r, look());
    expect(coatDigest(coat)).toBe(r.digest);
    // Toggling what is shown changes the coating drawn, never the coverage held.
    expect(coatDigest(coatTexture(r, look({ show: { uv: false, raisedUv: true } })))).toBe(r.digest);
  });

  it("coats where either finish covers, with each finish's own roughness; raised replaces ordinary", () => {
    const data = coatTexture(r, look()).image.data as Uint8Array;
    const px = (x: number, y: number) => [...data.slice((y * W + x) * 4, (y * W + x) * 4 + 4)];
    const rough = (gloss: number) => Math.round((1 - gloss) * 255);
    expect(px(4, 8)).toEqual([255, rough(DEFAULT_RECIPES.raisedUv.gloss), 255, 0]);
    expect(px(8, 8)).toEqual([255, rough(DEFAULT_RECIPES.raisedUv.gloss), 255, 0]);
    expect(px(15, 8)).toEqual([255, rough(DEFAULT_RECIPES.uv.gloss), 0, 255]);
    expect(px(22, 8)[0]).toBe(0);
  });

  it("print only: no coating and no relief, same artwork", () => {
    const artwork = new THREE.Texture();
    const coat = coatTexture(r, look());
    const relief = reliefTexture(r, DEFAULT_RECIPES.raisedUv);
    expect(relief).not.toBeNull();
    const on = faceMaterial(artwork, coat, relief, look());
    const off = faceMaterial(artwork, coat, relief, look({ printOnly: true }));
    expect([on.clearcoat, on.normalMap === relief]).toEqual([1, true]);
    expect([off.clearcoat, off.normalMap]).toEqual([0, null]);
    // Finishes never touch the base colour.
    expect(on.map).toBe(artwork);
    expect(off.map).toBe(artwork);
    expect(on.color.getHex()).toBe(off.color.getHex());
  });

  it("has no relief without raised coverage", () => {
    expect(
      reliefTexture(
        result([{ id: "uv", type: "uv", coverage: rect([6, 2, 20, 14]) }]),
        DEFAULT_RECIPES.raisedUv,
      ),
    ).toBeNull();
  });
});
