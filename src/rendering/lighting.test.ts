import { describe, expect, it } from "vitest";
import { dragLight, lightDirection, normalizeAngles } from "./lighting";

const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 9));

describe("light angles", () => {
  it("points at the viewer at azimuth 0, elevation 0", () =>
    close(lightDirection({ azimuth: 0, elevation: 0 }), [0, 0, 1]));
  it("points along +X at azimuth 90", () => close(lightDirection({ azimuth: 90, elevation: 0 }), [1, 0, 0]));
  it("points straight up at elevation 90", () =>
    close(lightDirection({ azimuth: 37, elevation: 90 }), [0, 1, 0]));
  it("is always a unit vector", () => {
    const [x, y, z] = lightDirection({ azimuth: 123, elevation: 31 });
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 12);
  });
  it("wraps azimuth and clamps elevation", () => {
    expect(normalizeAngles({ azimuth: -30, elevation: 120 })).toEqual({ azimuth: 330, elevation: 89 });
    expect(normalizeAngles({ azimuth: 720, elevation: -40 })).toEqual({ azimuth: 0, elevation: -10 });
  });
  it("drags right to increase azimuth and up to raise elevation", () => {
    expect(dragLight({ azimuth: 10, elevation: 20 }, 100, -100)).toEqual({ azimuth: 50, elevation: 50 });
  });
});
