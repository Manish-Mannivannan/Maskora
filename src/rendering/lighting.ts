/**
 * Light direction from azimuth and elevation, in degrees.
 *
 * Azimuth turns about the vertical (+Y) axis, 0° pointing from the page
 * towards the viewer (+Z) and 90° towards +X; elevation is the angle above the
 * page's horizon. The sliders, numeric fields and Move Light drag all edit
 * these two numbers, never a raw vector, so every path agrees (§2.4).
 */
export interface LightAngles {
  azimuth: number;
  elevation: number;
}

export const ELEVATION_MIN = -10;
export const ELEVATION_MAX = 89;

/** Wrap azimuth into [0, 360) and clamp elevation to the supported range. */
export function normalizeAngles({ azimuth, elevation }: LightAngles): LightAngles {
  const wrapped = ((azimuth % 360) + 360) % 360;
  return {
    azimuth: Object.is(wrapped, -0) ? 0 : wrapped,
    elevation: Math.min(ELEVATION_MAX, Math.max(ELEVATION_MIN, elevation)),
  };
}

/** Unit vector pointing from the scene origin towards the light. */
export function lightDirection({ azimuth, elevation }: LightAngles): [number, number, number] {
  const az = (azimuth * Math.PI) / 180;
  const el = (elevation * Math.PI) / 180;
  return [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
}

/** Degrees moved per pixel of a Move Light drag. */
export const DRAG_DEGREES_PER_PIXEL = { azimuth: 0.4, elevation: 0.3 };

/** Apply a Move Light drag of (dx, dy) pixels. Dragging up raises the light. */
export function dragLight(angles: LightAngles, dx: number, dy: number): LightAngles {
  return normalizeAngles({
    azimuth: angles.azimuth + dx * DRAG_DEGREES_PER_PIXEL.azimuth,
    elevation: angles.elevation - dy * DRAG_DEGREES_PER_PIXEL.elevation,
  });
}
