/**
 * Still-export sizes (architecture §17.3): the pixel size for a longest side
 * and aspect, and the tiles a large still is rendered in. Pure, so the
 * arithmetic is tested without a renderer.
 */

/** Export size budget (architecture §17.3): stills are at most this many pixels on a side. */
export const EXPORT_MAX = 8192;
export const EXPORT_MIN = 256;
/** Largest side of the offscreen WebGL canvas; bigger stills are rendered in tiles of this size. */
export const EXPORT_TILE = 4096;

/** Tile origins covering a width × height image with square tiles of `tile` px. */
export function tilesFor(width: number, height: number, tile: number): [number, number][] {
  const out: [number, number][] = [];
  for (let y = 0; y < height; y += tile) for (let x = 0; x < width; x += tile) out.push([x, y]);
  return out;
}

/** Pixel size for a long side and aspect. */
export function exportSize(longSide: number, aspect: number): [number, number] {
  const a = Math.min(8, Math.max(1 / 8, aspect));
  return a >= 1
    ? [longSide, Math.max(1, Math.round(longSide / a))]
    : [Math.max(1, Math.round(longSide * a)), longSide];
}
