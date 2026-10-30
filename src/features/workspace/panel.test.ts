import { describe, expect, it } from "vitest";
import { PANEL_DEFAULT, PANEL_MAX, PANEL_MIN, clampPanelWidth } from "./panel";

describe("panel width", () => {
  it("clamps to the limits", () => {
    expect(clampPanelWidth(10)).toBe(PANEL_MIN);
    expect(clampPanelWidth(9999)).toBe(PANEL_MAX);
    expect(clampPanelWidth(400.4)).toBe(400);
  });
  it("falls back to the default for a non-number", () =>
    expect(clampPanelWidth(Number.NaN)).toBe(PANEL_DEFAULT));
});
