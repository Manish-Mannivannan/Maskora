/**
 * Where page faces sit in the scene, in metres (architecture §4.3, §7.5).
 *
 * A face shows its surface's box (TrimBox by default) at physical size. Its
 * texture coordinates select that box from the shared finish raster, so the
 * artwork, the coating and the relief all use the raster the registration
 * view shows. A leaf has a front and an optional back; the back is turned
 * about the vertical axis so it reads correctly from behind. A spread puts the
 * left page's right edge and the right page's left edge on the spine at x = 0,
 * centred vertically; unequal pages are reported, never stretched.
 */
import { toDevice, type Rect, type RenderPlan } from "@/pdf/transform";

export interface FaceGeometry {
  /** Width and height in metres. */
  size: [number, number];
  /** Texture coordinates of the box in the raster: u0 left, u1 right, v0 top, v1 bottom (v grows downwards). */
  uv: { u0: number; v0: number; u1: number; v1: number };
}

/** The face for `box` (user space) of a planned raster. */
export function faceGeometry(plan: RenderPlan, box: Rect, pxPerMm: number): FaceGeometry {
  const a = toDevice(plan, [box[0], box[1]]);
  const b = toDevice(plan, [box[2], box[3]]);
  const [x0, x1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])];
  const [y0, y1] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
  return {
    size: [(x1 - x0) / pxPerMm / 1000, (y1 - y0) / pxPerMm / 1000],
    uv: { u0: x0 / plan.width, v0: y0 / plan.height, u1: x1 / plan.width, v1: y1 / plan.height },
  };
}

/** Plane UVs in three.js PlaneGeometry vertex order: top-left, top-right, bottom-left, bottom-right. */
export function planeUvs({ uv }: FaceGeometry): Float32Array {
  return new Float32Array([uv.u0, uv.v0, uv.u1, uv.v0, uv.u0, uv.v1, uv.u1, uv.v1]);
}

/** Face-local position (metres, origin at the centre, +y up) of raster coordinates (u, v). */
export function localFromUv(face: FaceGeometry, u: number, v: number): [number, number] {
  const { u0, v0, u1, v1 } = face.uv;
  return [((u - u0) / (u1 - u0) - 0.5) * face.size[0], (0.5 - (v - v0) / (v1 - v0)) * face.size[1]];
}

export interface Placement {
  position: [number, number, number];
  /** Rotation about Y in radians. */
  turn: number;
}

/** Front at +thickness/2 facing the viewer; back at −thickness/2 turned to face away. */
export function leafPlacements(thicknessM: number): { front: Placement; back: Placement } {
  return {
    front: { position: [0, 0, thicknessM / 2], turn: 0 },
    back: { position: [0, 0, -thicknessM / 2], turn: Math.PI },
  };
}

export function spreadPlacements(left: [number, number], right: [number, number], thicknessM: number) {
  return {
    left: { position: [-left[0] / 2, 0, thicknessM / 2] as [number, number, number], turn: 0 },
    right: { position: [right[0] / 2, 0, thicknessM / 2] as [number, number, number], turn: 0 },
  };
}

/** Sizes differing by more than `toleranceMm` on either axis. */
export function sizesDiffer(a: [number, number], b: [number, number], toleranceMm = 0.1): boolean {
  return Math.abs(a[0] - b[0]) * 1000 > toleranceMm || Math.abs(a[1] - b[1]) * 1000 > toleranceMm;
}

/** Camera distance that fits a `width` × `height` m area in a view of `fovDeg` and `aspect`, with a margin. */
export function fitDistance(
  width: number,
  height: number,
  fovDeg: number,
  aspect: number,
  margin = 1.15,
): number {
  const t = Math.tan(((fovDeg / 2) * Math.PI) / 180);
  return (Math.max(height, width / aspect) / 2 / t) * margin;
}
