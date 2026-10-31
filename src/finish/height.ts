/**
 * Raised UV as surface relief (architecture §4.4, §7.4, §17.2).
 *
 * The coating's height is the same profile the coating mesh uses: zero at
 * the footprint's edge (the coverage's 0.5 contour), rising along a quarter
 * sine to the full height at the bevel distance inside, measured with an
 * exact distance field. Its slope becomes a tangent-space normal map, so
 * light catches the edges while the relief stays registered to the mask: it
 * never extends past the footprint. A normal map changes no silhouette and
 * casts no shadow. Units: height in micrometres, bevel in millimetres, slope
 * in mm per mm.
 *
 * Texture convention: rows run top to bottom and v grows downwards with them
 * (textures are uploaded unflipped), so the normal's green channel points
 * down the page.
 */
import { distanceField, profileHeight, type ReliefProfile } from "./reliefMesh";

/** Height profile in mm per pixel: 0 outside the footprint, the coating's height inside. */
export function heightProfile(
  raised: Uint8Array,
  width: number,
  height: number,
  pxPerMm: number,
  profile: ReliefProfile,
): Float32Array {
  const inside = new Uint8Array(raised.length);
  for (let i = 0; i < raised.length; i += 1) inside[i] = raised[i] >= 128 ? 1 : 0;
  const dist = distanceField(inside, width, height);
  const out = new Float32Array(raised.length);
  for (let i = 0; i < out.length; i += 1)
    if (inside[i]) out[i] = profileHeight(Math.max(0, dist[i] - 0.5) / pxPerMm, profile) / 1000;
  return out;
}

/** RGBA tangent-space normals from a height profile in mm; `pxPerMm` converts pixel steps to millimetres. */
export function normalMap(profile: Float32Array, width: number, height: number, pxPerMm: number): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  // Central differences: (h[+1] − h[−1]) / 2 per pixel, in mm of height per mm of page; edges clamp.
  const k = pxPerMm / 2;
  for (let y = 0; y < height; y += 1) {
    const up = (y > 0 ? y - 1 : 0) * width;
    const down = (y < height - 1 ? y + 1 : height - 1) * width;
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      const left = x > 0 ? x - 1 : 0;
      const right = x < width - 1 ? x + 1 : width - 1;
      const dx = (profile[row + right] - profile[row + left]) * k;
      const dy = (profile[down + x] - profile[up + x]) * k;
      // Surface z = h: the normal leans against the slope; +v is down the page.
      const nx = -dx;
      const ny = -dy;
      const len = Math.hypot(nx, ny, 1);
      const i = (y * width + x) * 4;
      out[i] = Math.round((nx / len) * 127.5 + 127.5);
      out[i + 1] = Math.round((ny / len) * 127.5 + 127.5);
      out[i + 2] = Math.round((1 / len) * 127.5 + 127.5);
      out[i + 3] = 255;
    }
  }
  return out;
}
