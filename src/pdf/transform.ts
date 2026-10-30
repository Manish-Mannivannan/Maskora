/**
 * The one source → physical → texture transform (architecture §4.3, §7.2).
 *
 * Every raster of a page (thumbnail, preview, mask, export) is planned here,
 * from PDF user space with its rotation and UserUnit, and from nothing else.
 * A plan names the region rendered (any page box, including content outside
 * the CropBox), the pixel size, the scale in device pixels per user-space
 * unit, and the offsets that place the region at the canvas origin. It also
 * carries the background and annotation policy, so no caller chooses them
 * implicitly. Screen pixels are never an alignment unit: positions convert
 * back to user space and millimetres through the plan.
 *
 * Budgets come from step 0.4's measurements on the reference machine:
 * interactive textures ≤ 4096 px on the longest side, exports 8192 px by
 * default and never above 16 384 px (a 16 384² RGBA texture is 1 GiB).
 */

/** [llx, lly, urx, ury] in PDF user space. */
export type Rect = [number, number, number, number];
export type Rotation = 0 | 90 | 180 | 270;
export type Purpose = "thumbnail" | "interactive" | "export";

export const BUDGETS = {
  thumbnail: 320,
  interactive: 4096,
  exportDefault: 8192,
  hardMax: 16384,
} as const;

export interface RenderPolicy {
  /** "paper" paints white behind the page; "transparent" keeps alpha (mask pages). */
  background: "paper" | "transparent";
  /** "none" renders artwork only; "print" adds annotations flagged for printing. */
  annotations: "none" | "print";
}

/** Printed artwork: white paper, no annotations unless the user asks for them. */
export const ARTWORK_POLICY: RenderPolicy = { background: "paper", annotations: "none" };

export interface RenderRequest {
  /** The engine's base box for the page (PDF.js `view`, the effective CropBox). */
  view: Rect;
  /** The user-space region to rasterize; may extend beyond `view` up to the MediaBox. */
  region: Rect;
  rotation: Rotation;
  userUnit: number;
  purpose: Purpose;
  /** Wanted longest side in pixels; exports default to BUDGETS.exportDefault. */
  longestSidePx?: number;
  policy: RenderPolicy;
}

export interface RenderPlan extends RenderRequest {
  width: number;
  height: number;
  /** Device pixels per user-space unit (UserUnit is not included: one unit = UserUnit/72 in). */
  pxPerUnit: number;
  /** Offsets for a viewport whose base box is `view`, placing `region` at the origin. */
  offsetX: number;
  offsetY: number;
  /** Set when a request above the purpose's budget was reduced to it. */
  clampedFrom?: number;
}

export type PlanResult =
  | { ok: true; plan: RenderPlan }
  | { ok: false; code: "budgetExceeded" | "emptyRegion" | "invalidRequest"; message: string };

/** Millimetres per user-space unit: mm = units × UserUnit × 25.4 / 72. */
export const mmPerUnit = (userUnit: number) => (userUnit * 25.4) / 72;

/** Width and height of a rectangle in millimetres. */
export function sizeMm(rect: Rect, userUnit: number): [number, number] {
  const k = mmPerUnit(userUnit);
  return [(rect[2] - rect[0]) * k, (rect[3] - rect[1]) * k];
}

/** The rotation a page is displayed with, or null for a value that is not a multiple of 90. */
export function asRotation(value: number | null | undefined): Rotation | null {
  if (value === null || value === undefined || !Number.isInteger(value) || value % 90 !== 0) return null;
  return (((value % 360) + 360) % 360) as Rotation;
}

/** Device position of a user-space point in an unoffset viewport over `box` (PDF.js's convention). */
function basePoint(box: Rect, rotation: Rotation, s: number, [x, y]: [number, number]): [number, number] {
  const [llx, lly, urx, ury] = box;
  switch (rotation) {
    case 0:
      return [(x - llx) * s, (ury - y) * s];
    case 90:
      return [(y - lly) * s, (x - llx) * s];
    case 180:
      return [(urx - x) * s, (y - lly) * s];
    case 270:
      return [(ury - y) * s, (urx - x) * s];
  }
}

export function planRender(request: RenderRequest): PlanResult {
  const { region, rotation, userUnit, purpose } = request;
  if (!(userUnit > 0) || asRotation(rotation) === null)
    return { ok: false, code: "invalidRequest", message: "Rotation or UserUnit is not usable." };
  const regionW = region[2] - region[0];
  const regionH = region[3] - region[1];
  if (!(regionW > 0 && regionH > 0))
    return { ok: false, code: "emptyRegion", message: "The requested region has no area." };

  const wanted = request.longestSidePx ?? (purpose === "export" ? BUDGETS.exportDefault : BUDGETS[purpose]);
  if (!(wanted >= 1))
    return { ok: false, code: "invalidRequest", message: "The requested size is not positive." };
  if (wanted > BUDGETS.hardMax)
    return {
      ok: false,
      code: "budgetExceeded",
      message: `${Math.round(wanted)} px exceeds the ${BUDGETS.hardMax} px limit.`,
    };
  const budget = purpose === "export" ? BUDGETS.hardMax : BUDGETS[purpose];
  const longest = Math.min(wanted, budget);

  const [w, h] = rotation % 180 === 0 ? [regionW, regionH] : [regionH, regionW];
  const pxPerUnit = longest / Math.max(w, h);
  const corners = [
    [region[0], region[1]],
    [region[0], region[3]],
    [region[2], region[1]],
    [region[2], region[3]],
  ].map((p) => basePoint(request.view, rotation, pxPerUnit, p as [number, number]));
  const plan: RenderPlan = {
    ...request,
    width: Math.max(1, Math.round(w * pxPerUnit)),
    height: Math.max(1, Math.round(h * pxPerUnit)),
    pxPerUnit,
    offsetX: -Math.min(...corners.map((c) => c[0])),
    offsetY: -Math.min(...corners.map((c) => c[1])),
    ...(wanted > budget ? { clampedFrom: wanted } : {}),
  };
  return { ok: true, plan };
}

/** Canvas pixel of a user-space point under a plan. */
export function toDevice(plan: RenderPlan, point: [number, number]): [number, number] {
  const [x, y] = basePoint(plan.view, plan.rotation, plan.pxPerUnit, point);
  return [x + plan.offsetX, y + plan.offsetY];
}
