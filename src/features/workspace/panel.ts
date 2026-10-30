/** The control panel's width limits, in CSS pixels, and the keyboard step. */
export const PANEL_MIN = 260;
export const PANEL_MAX = 560;
export const PANEL_DEFAULT = 320;
export const PANEL_KEY_STEP = 16;

export function clampPanelWidth(width: number): number {
  if (!Number.isFinite(width)) return PANEL_DEFAULT;
  return Math.round(Math.min(PANEL_MAX, Math.max(PANEL_MIN, width)));
}
