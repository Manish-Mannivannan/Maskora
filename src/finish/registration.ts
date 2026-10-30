/**
 * Registering a mask page to an artwork page (architecture §4.3, §7.4).
 *
 * Both pages are aligned by the surface's box (TrimBox by default): the box's
 * lower-left corners coincide, measured in millimetres so differing UserUnits
 * line up. The layer's X/Y offset then shifts the mask (+X right, +Y up).
 * Alignment happens in unrotated page space; the artwork's rotation is then
 * applied to both. Nothing here guesses a shift: mismatches are reported, and
 * correcting them is the user's explicit offset.
 */
import { mmPerUnit, sizeMm, type Rect } from "@/pdf/transform";

export interface PageFrame {
  /** The anchor box (the surface's box) in the page's user space. */
  anchor: Rect;
  media: Rect;
  userUnit: number;
  rotation: number;
}

/** The region of the mask page that lands on `artRegion` of the artwork page. */
export function maskRegion(
  artRegion: Rect,
  art: PageFrame,
  mask: PageFrame,
  offsetMm: [number, number],
): Rect {
  const kA = mmPerUnit(art.userUnit);
  const kM = mmPerUnit(mask.userUnit);
  const [dx, dy] = offsetMm;
  const x = (v: number) => mask.anchor[0] + ((v - art.anchor[0]) * kA - dx) / kM;
  const y = (v: number) => mask.anchor[1] + ((v - art.anchor[1]) * kA - dy) / kM;
  return [x(artRegion[0]), y(artRegion[1]), x(artRegion[2]), y(artRegion[3])];
}

export interface RegistrationWarning {
  code: "sizeMismatch" | "originMismatch" | "rotationMismatch";
  message: string;
}

const mm1 = (v: number) => v.toFixed(1);

/** What differs between the two pages' geometry, beyond `toleranceMm`. */
export function registrationWarnings(
  art: PageFrame,
  mask: PageFrame,
  boxName: string,
  toleranceMm = 0.1,
): RegistrationWarning[] {
  const out: RegistrationWarning[] = [];
  const [aw, ah] = sizeMm(art.anchor, art.userUnit);
  const [mw, mh] = sizeMm(mask.anchor, mask.userUnit);
  if (Math.abs(aw - mw) > toleranceMm || Math.abs(ah - mh) > toleranceMm)
    out.push({
      code: "sizeMismatch",
      message: `The mask page's ${boxName} is ${mm1(mw)} × ${mm1(mh)} mm; the artwork's is ${mm1(aw)} × ${mm1(ah)} mm.`,
    });
  const at = (f: PageFrame) => [
    (f.anchor[0] - f.media[0]) * mmPerUnit(f.userUnit),
    (f.anchor[1] - f.media[1]) * mmPerUnit(f.userUnit),
  ];
  const [ax, ay] = at(art);
  const [mx, my] = at(mask);
  if (Math.abs(ax - mx) > toleranceMm || Math.abs(ay - my) > toleranceMm)
    out.push({
      code: "originMismatch",
      message: `The ${boxName} sits at (${mm1(mx)}, ${mm1(my)}) mm on the mask sheet and at (${mm1(ax)}, ${mm1(ay)}) mm on the artwork sheet; the pages are aligned by the ${boxName}.`,
    });
  if (art.rotation !== mask.rotation)
    out.push({
      code: "rotationMismatch",
      message: `The mask page is rotated ${mask.rotation}° and the artwork ${art.rotation}°; registration uses the unrotated pages.`,
    });
  return out;
}
