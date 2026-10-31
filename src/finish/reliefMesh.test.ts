import { describe, expect, it } from "vitest";
import {
  buildBoundedReliefMesh,
  buildReliefMesh,
  distanceField,
  profileHeight,
  type ReliefProfile,
} from "./reliefMesh";

const W = 120;
const H = 80;
const PX_PER_MM = 10;
const PROFILE: ReliefProfile = { heightUm: 100, bevelMm: 0.5, crownUm: 0 };

/** Coverage from an inside test at pixel centres. */
const raster = (inside: (x: number, y: number) => boolean) =>
  Uint8Array.from({ length: W * H }, (_, i) => (inside(i % W, Math.floor(i / W)) ? 255 : 0));
const disc = (cx: number, cy: number, r: number) => (x: number, y: number) =>
  (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

describe("relief mesh prototype", () => {
  it("distance field: exact distances to the nearest outside pixel", () => {
    const inside = Uint8Array.from(
      raster((x, y) => x >= 10 && x < 30 && y >= 10 && y < 30),
      (v) => (v ? 1 : 0),
    );
    const d = distanceField(inside, W, H);
    expect(d[20 * W + 10]).toBe(1);
    expect(d[20 * W + 19]).toBe(10);
    expect(d[5 * W + 5]).toBe(0);
  });

  it("a rectangle: one shape, one full-height top, flat top merged, edge registered to the coverage", () => {
    const cov = raster((x, y) => x >= 20 && x < 60 && y >= 20 && y < 40);
    const m = buildReliefMesh(cov, W, H, PX_PER_MM, PROFILE);
    expect(m.shapes).toHaveLength(1);
    expect(m.shapes[0]).toMatchObject({ plateaus: 1, reachedUm: 100 });
    const z = Array.from({ length: m.vertices }, (_, i) => m.positions[i * 3 + 2]);
    expect(Math.max(...z)).toBeCloseTo(100, 6);
    // The footprint edge: zero-height vertices sit exactly half way between covered and uncovered pixel centres.
    const edge = Array.from({ length: m.vertices }, (_, i) => i)
      .filter((i) => z[i] === 0)
      .map((i) => [m.positions[i * 3], m.positions[i * 3 + 1]]);
    const left = edge.filter(([x, y]) => x < 25 && y > 21 && y < 38);
    const top = edge.filter(([x, y]) => y < 25 && x > 21 && x < 58);
    expect(left.length).toBeGreaterThan(10);
    expect(left.every(([x]) => x === 19.5)).toBe(true);
    expect(top.every(([, y]) => y === 19.5)).toBe(true);
  });

  it("geometry concentrates on the shoulders: a wide top costs two triangles", () => {
    const cov = raster((x, y) => x >= 20 && x < 100 && y >= 15 && y < 65);
    const merged = buildReliefMesh(cov, W, H, PX_PER_MM, PROFILE);
    // A crown curves the top, so nothing merges: the same shape, one pair of triangles per covered cell.
    const unmerged = buildReliefMesh(cov, W, H, PX_PER_MM, { ...PROFILE, crownUm: 10 });
    expect(merged.triangles).toBeLessThan(unmerged.triangles * 0.5);
  });

  it("a curved ring with a hole: shoulders on both edges, nothing built inside the hole", () => {
    const cov = raster((x, y) => disc(60, 40, 30)(x, y) && !disc(60, 40, 12)(x, y));
    const m = buildReliefMesh(cov, W, H, PX_PER_MM, PROFILE);
    expect(m.shapes).toHaveLength(1);
    expect(m.shapes[0].plateaus).toBe(1);
    for (let i = 0; i < m.vertices; i += 1) {
      const r = Math.hypot(m.positions[i * 3] - 60, m.positions[i * 3 + 1] - 40);
      expect(r).toBeGreaterThan(11);
    }
  });

  it("a dumbbell whose neck is narrower than twice the bevel: the inset splits into two tops, reported", () => {
    const neck = (x: number, y: number) => x >= 30 && x <= 90 && Math.abs(y - 40) <= 2;
    const cov = raster((x, y) => disc(25, 40, 15)(x, y) || disc(95, 40, 15)(x, y) || neck(x, y));
    const m = buildReliefMesh(cov, W, H, PX_PER_MM, PROFILE);
    expect(m.shapes).toHaveLength(1);
    expect(m.shapes[0].plateaus).toBe(2);
  });

  it("thin strokes never disappear: they keep their footprint at the height their width allows", () => {
    for (const halfWidth of [1, 0]) {
      const cov = raster((x, y) => x >= 10 && x < 110 && Math.abs(y - 40) <= halfWidth);
      const m = buildReliefMesh(cov, W, H, PX_PER_MM, PROFILE);
      expect(m.shapes).toHaveLength(1);
      expect(m.shapes[0].plateaus).toBe(0);
      expect(m.triangles).toBeGreaterThan(0);
      expect(m.shapes[0].reachedUm).toBeGreaterThan(0);
      expect(m.shapes[0].reachedUm).toBeLessThan(100);
      expect(m.shapes[0].reachedUm).toBeCloseTo(profileHeight(m.shapes[0].maxInsetMm, PROFILE), 6);
    }
  });

  it("height and bevel are independent; a crown raises only the middle of wide tops", () => {
    const cov = raster((x, y) => x >= 20 && x < 100 && y >= 10 && y < 70);
    const tall = buildReliefMesh(cov, W, H, PX_PER_MM, { ...PROFILE, heightUm: 200 });
    expect(tall.shapes[0].reachedUm).toBeCloseTo(200, 6);
    const wide = buildReliefMesh(cov, W, H, PX_PER_MM, { ...PROFILE, bevelMm: 1 });
    expect(wide.shapes[0].reachedUm).toBeCloseTo(100, 6);
    const crowned = buildReliefMesh(cov, W, H, PX_PER_MM, { ...PROFILE, crownUm: 20 });
    expect(crowned.shapes[0].reachedUm).toBeCloseTo(120, 6);
    expect(profileHeight(0.5, { ...PROFILE, crownUm: 20 })).toBeCloseTo(100, 6);
  });

  describe("smooth shoulders", () => {
    type Mesh = ReturnType<typeof buildReliefMesh>;
    const at = (m: Mesh, i: number) => [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]];
    /**
     * Stair-step error on a disc: angle between each tilted normal's direction and the outward
     * radial, weighted by tilt (a nearly vertical normal has no meaningful direction and shows no step).
     */
    const stairError = (m: Mesh, normals: Float32Array, cx: number, cy: number) => {
      let sum = 0;
      let weights = 0;
      let worst = 0;
      for (let i = 0; i < m.vertices; i += 1) {
        const tilt = Math.hypot(normals[i * 3], normals[i * 3 + 1]);
        if (tilt < Math.sin((5 * Math.PI) / 180)) continue;
        const [x, y] = at(m, i);
        const radial = Math.atan2(-(y - cy), x - cx);
        const dir = Math.atan2(normals[i * 3 + 1], normals[i * 3]);
        const e = (Math.abs(Math.atan2(Math.sin(dir - radial), Math.cos(dir - radial))) * 180) / Math.PI;
        sum += e * tilt;
        weights += tilt;
        worst = Math.max(worst, e);
      }
      return { mean: sum / weights, worst };
    };
    const disc30 = raster(disc(60, 40, 30));

    it("removes the pixel grid's stair-steps from curved shoulders", () => {
      const triangles = buildReliefMesh(disc30, W, H, PX_PER_MM, PROFILE, { exactNormals: false });
      const smooth = buildReliefMesh(disc30, W, H, PX_PER_MM, PROFILE);
      const before = stairError(triangles, triangles.normals, 60, 40);
      const after = stairError(smooth, smooth.normals, 60, 40);
      // Measured: triangles' normals 8.8° mean, 44° worst; the intended surface's normals well under both.
      expect(before.mean).toBeGreaterThan(5);
      expect(after.mean).toBeLessThan(2);
      expect(after.worst).toBeLessThan(15);
    });

    it("never moves a vertex sideways: footprint, registration and holes are unchanged", () => {
      const ring = raster((x, y) => disc(60, 40, 30)(x, y) && !disc(60, 40, 12)(x, y));
      const triangles = buildReliefMesh(ring, W, H, PX_PER_MM, PROFILE, { exactNormals: false });
      const smooth = buildReliefMesh(ring, W, H, PX_PER_MM, PROFILE);
      expect([...smooth.positions]).toEqual([...triangles.positions]);
      expect([...smooth.indices]).toEqual([...triangles.indices]);
      for (let i = 0; i < smooth.vertices; i += 1) {
        const [x, y] = at(smooth, i);
        expect(Math.hypot(x - 60, y - 40)).toBeGreaterThan(11);
      }
    });

    it("keeps the rim at height 0 and thin strokes at their height", () => {
      const stroke = raster((x, y) => x >= 10 && x < 110 && Math.abs(y - 40) <= 1);
      const m = buildReliefMesh(stroke, W, H, PX_PER_MM, PROFILE);
      const z = Array.from({ length: m.vertices }, (_, i) => at(m, i)[2]);
      expect(m.triangles).toBeGreaterThan(0);
      expect(Math.max(...z)).toBeGreaterThan(0);
      expect(Math.max(...z)).toBeCloseTo(m.shapes[0].reachedUm, 0);
      // Ridge vertices (local peaks) face straight up, so a stroke is not shaded as tilted to one side.
      const ridge = z.indexOf(Math.max(...z));
      expect(m.normals[ridge * 3 + 2]).toBeCloseTo(1, 6);
    });
  });
});

describe("bounded geometry", () => {
  /** A dense production-like pattern: a grid of small discs. */
  const dots = (r: number, pitch: number) =>
    raster((x, y) => {
      const dx = (x % pitch) - pitch / 2;
      const dy = (y % pitch) - pitch / 2;
      return dx * dx + dy * dy <= r * r;
    });

  it("builds at full resolution when it fits", () => {
    const b = buildBoundedReliefMesh(raster(disc(60, 40, 30)), W, H, PX_PER_MM, PROFILE);
    expect(b.mesh && b.step).toBe(1);
  });

  it("coarsens a dense mask to fit the budget, keeping every shape and the footprint's place", () => {
    const cov = dots(3, 10);
    const full = buildReliefMesh(cov, W, H, PX_PER_MM, PROFILE);
    const budget = Math.floor(full.triangles / 3);
    const b = buildBoundedReliefMesh(cov, W, H, PX_PER_MM, PROFILE, budget);
    expect(b.mesh).not.toBeNull();
    if (!b.mesh) return;
    expect(b.step).toBeGreaterThan(1);
    expect(b.mesh.triangles).toBeLessThanOrEqual(budget);
    expect(b.mesh.shapes).toHaveLength(full.shapes.length);
    // Positions are in full-raster pixels: every vertex lies within a step of a covered dot.
    for (let i = 0; i < b.mesh.vertices; i += 1) {
      const x = b.mesh.positions[i * 3];
      const y = b.mesh.positions[i * 3 + 1];
      const dx = ((((x + 0.5) % 10) + 10) % 10) - 5;
      const dy = ((((y + 0.5) % 10) + 10) % 10) - 5;
      expect(Math.hypot(dx, dy)).toBeLessThan(3 + b.step + 1);
    }
  });

  it("never fits the budget by losing shapes: no mesh, and the reason, instead", () => {
    // At 1/8 resolution these dots average below half coverage and would vanish.
    const b = buildBoundedReliefMesh(dots(3, 10), W, H, PX_PER_MM, PROFILE, 10);
    expect(b.mesh).toBeNull();
    if (b.mesh === null) expect(b.reason).toMatch(/loses some of the mask's \d+ shapes/);
  });
});
