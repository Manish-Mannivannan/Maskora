import { describe, expect, it } from "vitest";
import { EXPORT_TILE, exportSize, tilesFor } from "./size";

describe("still-export sizes", () => {
  it("keeps the longest side and the aspect", () => {
    expect(exportSize(8192, 207 / 257.2)).toEqual([6593, 8192]);
    expect(exportSize(3840, 1.5)).toEqual([3840, 2560]);
  });

  it("covers a large still with tiles no bigger than the GPU-safe size, exactly once", () => {
    const [w, h] = exportSize(8192, 207 / 257.2);
    const tiles = tilesFor(w, h, EXPORT_TILE);
    expect(tiles).toEqual([
      [0, 0],
      [4096, 0],
      [0, 4096],
      [4096, 4096],
    ]);
    // Every pixel is in exactly one tile once each tile is cropped to the image.
    let area = 0;
    for (const [x, y] of tiles) area += Math.min(EXPORT_TILE, w - x) * Math.min(EXPORT_TILE, h - y);
    expect(area).toBe(w * h);
  });

  it("needs a single tile up to the tile size", () => {
    expect(tilesFor(3091, 3840, EXPORT_TILE)).toEqual([[0, 0]]);
  });
});
