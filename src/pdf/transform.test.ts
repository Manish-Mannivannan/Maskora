import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ARTWORK_POLICY,
  BUDGETS,
  planRender,
  sizeMm,
  toDevice,
  type Rect,
  type RenderRequest,
  type Rotation,
} from "./transform";

const fixture = (id: string) =>
  JSON.parse(readFileSync(join(__dirname, "../../tests/fixtures/pdf", `${id}.expected.json`), "utf8"));

function plan(request: Partial<RenderRequest> & { region: Rect }) {
  const result = planRender({
    view: request.region,
    rotation: 0,
    userUnit: 1,
    purpose: "interactive",
    longestSidePx: 1000,
    policy: ARTWORK_POLICY,
    ...request,
  });
  if (!result.ok) throw new Error(result.message);
  return result.plan;
}

describe("transform contract", () => {
  // Corners clockwise around the unrotated page, and canvas corners clockwise from top-left.
  const corners = ([x0, y0, x1, y1]: Rect): [number, number][] => [
    [x0, y1],
    [x1, y1],
    [x1, y0],
    [x0, y0],
  ];
  const canvasCorners = (w: number, h: number) => [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ];

  for (const rotation of [0, 90, 180, 270] as Rotation[]) {
    it(`rotation ${rotation}: Rotate turns the page clockwise, region corners land on canvas corners`, () => {
      const media: Rect = [1000, -500, 1300, -100];
      const crop: Rect = [1018, -478, 1284, -114];
      const p = plan({ view: crop, region: media, rotation });
      const steps = rotation / 90;
      corners(media).forEach((corner, i) => {
        const [x, y] = toDevice(p, corner);
        const [ex, ey] = canvasCorners(p.width, p.height)[(i + steps) % 4];
        expect(x).toBeCloseTo(ex, 6);
        expect(y).toBeCloseTo(ey, 6);
      });
    });
  }

  it("renders a region outside the base box: R1's MediaBox over its CropBox", () => {
    const { boxes } = fixture("R1").pages[0];
    const p = plan({ view: boxes.CropBox, region: boxes.MediaBox, longestSidePx: 800 });
    expect([p.width, p.height]).toEqual([600, 800]);
    expect(toDevice(p, [0, 400])).toEqual([0, 0]);
    const mark = fixture("R1").pages[0].marks.find((m: { id: string }) => m.id === "mediaMarginLeft");
    const [x, y] = toDevice(p, [mark.rect[0], mark.rect[1]]);
    expect(x).toBeCloseTo(mark.rect[0] * 2, 6);
    expect(y).toBeCloseTo((400 - mark.rect[1]) * 2, 6);
  });

  it("states pixels per user-space unit independently of UserUnit; physical size includes it", () => {
    const { boxes, mediaSizeMm } = fixture("G6").pages[0];
    const media = boxes.MediaBox.effective as Rect;
    expect(plan({ region: media, userUnit: 2 }).pxPerUnit).toBe(
      plan({ region: media, userUnit: 1 }).pxPerUnit,
    );
    const [w, h] = sizeMm(media, 2);
    expect(w).toBeCloseTo(mediaSizeMm[0], 3);
    expect(h).toBeCloseTo(mediaSizeMm[1], 3);
    const [a4w, a4h] = sizeMm([0, 0, 595.2756, 841.8898], 1);
    expect(a4w).toBeCloseTo(210, 3);
    expect(a4h).toBeCloseTo(297, 3);
  });

  it("keeps background and annotation policy on the plan", () => {
    const p = plan({ region: [0, 0, 100, 100] });
    expect(p.policy).toEqual({ background: "paper", annotations: "none" });
  });
});

describe("budgets", () => {
  const region: Rect = [0, 0, 600, 300];
  const request = { view: region, region, rotation: 0 as const, userUnit: 1, policy: ARTWORK_POLICY };

  it("clamps interactive and thumbnail requests to their budget and says so", () => {
    const r = planRender({ ...request, purpose: "interactive", longestSidePx: 5000 });
    expect(r.ok && [r.plan.width, r.plan.clampedFrom]).toEqual([BUDGETS.interactive, 5000]);
    const t = planRender({ ...request, purpose: "thumbnail" });
    expect(t.ok && t.plan.width).toBe(BUDGETS.thumbnail);
  });

  it("exports at 8192 px by default, allows up to 16 384 px and refuses more", () => {
    const d = planRender({ ...request, purpose: "export" });
    expect(d.ok && d.plan.width).toBe(8192);
    const max = planRender({ ...request, purpose: "export", longestSidePx: 16384 });
    expect(max.ok && max.plan.width).toBe(16384);
    const over = planRender({ ...request, purpose: "export", longestSidePx: 16385 });
    expect(over).toMatchObject({ ok: false, code: "budgetExceeded" });
  });

  it("refuses empty regions and unusable rotation", () => {
    expect(planRender({ ...request, region: [0, 0, 0, 10], purpose: "interactive" })).toMatchObject({
      ok: false,
      code: "emptyRegion",
    });
    expect(planRender({ ...request, rotation: 45 as Rotation, purpose: "interactive" })).toMatchObject({
      ok: false,
      code: "invalidRequest",
    });
  });
});
