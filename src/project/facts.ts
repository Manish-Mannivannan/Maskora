/**
 * Combining the two engines' facts about a page (architecture §4.2, §7.2).
 *
 * The native reader is the only source of page boxes and rotation; PDF.js
 * contributes its base box and labels. Neither answer is presented as the
 * other's, and where they disagree a diagnostic says so. A manual override
 * replaces a box's effective value but keeps the source fact beside it.
 */
import type { OptionalContentSummary, PdfPageFacts } from "@/pdf/adapter";
import { asRotation, mmPerUnit, sizeMm, type Rect, type Rotation } from "@/pdf/transform";
import type { BoxFact, FactOrigin, GeometryReport, PageGeometry } from "@/native/sources";

export const BOX_NAMES = ["MediaBox", "CropBox", "BleedBox", "TrimBox", "ArtBox"] as const;
export type BoxName = (typeof BOX_NAMES)[number];

export interface OverrideRect {
  rect: Rect;
  /** How the user derived it, e.g. "MediaBox inset 3 mm". */
  derivation: string;
}

export interface PageOverride {
  trim?: OverrideRect;
  bleed?: OverrideRect;
}

export interface BoxRow {
  name: BoxName;
  /** The value used, or null when no engine has stated it yet. */
  effective: Rect | null;
  origin: FactOrigin | "override" | "unknown";
  /** The native fact, kept even when an override replaces it. */
  source: BoxFact | null;
  derivation?: string;
}

export interface PageSummary {
  index: number;
  label: string | null;
  userUnit: number;
  rotation: {
    /** The rotation pages are displayed and rendered with. */
    displayed: Rotation;
    /** "native" when the page dictionary was read; "pdfjs" until then or if it failed. */
    from: "native" | "pdfjs";
    origin: FactOrigin | "unknown";
    raw: number | null;
    invalid: boolean;
  };
  boxes: BoxRow[];
  /** Physical size of the effective TrimBox, unrotated, in mm. */
  trimMm: [number, number] | null;
  trimOrigin: BoxRow["origin"];
}

export interface Diagnostic {
  level: "error" | "warning" | "limitation";
  code: string;
  message: string;
  page?: number;
}

const boxFact = (native: PageGeometry | undefined, name: BoxName) =>
  native?.boxes.find(([n]) => n === name)?.[1] ?? null;

export function summarizePage(
  index: number,
  pdf: PdfPageFacts | undefined,
  native: PageGeometry | undefined,
  label: string | null,
  override: PageOverride | undefined,
): PageSummary {
  const boxes: BoxRow[] = BOX_NAMES.map((name) => {
    const source = boxFact(native, name);
    const manual = name === "TrimBox" ? override?.trim : name === "BleedBox" ? override?.bleed : undefined;
    if (manual)
      return { name, effective: manual.rect, origin: "override", source, derivation: manual.derivation };
    if (source) return { name, effective: source.effective, origin: source.origin, source };
    return { name, effective: null, origin: "unknown", source: null };
  });

  const nativeRotation = native ? asRotation(native.rotate.effective) : null;
  const invalid = native?.rotate.origin === "invalid";
  const rotation: PageSummary["rotation"] = native
    ? {
        // An invalid rotation is shown as invalid and rendered unrotated, with a diagnostic.
        displayed: nativeRotation ?? 0,
        from: "native",
        origin: native.rotate.origin,
        raw: native.rotate.raw,
        invalid,
      }
    : {
        displayed: asRotation(pdf?.rotate) ?? 0,
        from: "pdfjs",
        origin: "unknown",
        raw: null,
        invalid: false,
      };

  const userUnit = native?.userUnit ?? pdf?.userUnit ?? 1;
  const trim = boxes[3];
  return {
    index,
    label,
    userUnit,
    rotation,
    boxes,
    trimMm: trim.effective ? sizeMm(trim.effective, userUnit) : null,
    trimOrigin: trim.origin,
  };
}

const TOLERANCE_PT = 0.002;
const sameRect = (a: Rect, b: Rect) => a.every((v, i) => Math.abs(v - b[i]) <= TOLERANCE_PT);

/** Where the engines disagree, or the file reports something the app must not hide. */
export function diagnose(input: {
  pdfPages?: PdfPageFacts[];
  pageCount: number;
  native?: GeometryReport;
  digest?: string;
  optionalContent?: OptionalContentSummary;
}): Diagnostic[] {
  const out: Diagnostic[] = [];
  const { native, pdfPages } = input;
  if (native && input.digest && native.sha256 !== input.digest)
    out.push({
      level: "error",
      code: "sourceChangedWhileOpening",
      message:
        "The file changed while it was being opened; the two readers saw different content. Open it again.",
    });
  if (native && native.pages.length !== input.pageCount)
    out.push({
      level: "error",
      code: "pageCountDisagrees",
      message: `The native reader found ${native.pages.length} pages and PDF.js ${input.pageCount}.`,
    });
  if (native && pdfPages)
    for (const page of pdfPages) {
      const crop = boxFact(native.pages[page.index], "CropBox");
      if (crop && !sameRect(crop.effective, page.view))
        out.push({
          level: "warning",
          code: "cropBoxDisagrees",
          message: `Page ${page.index + 1}: the readers disagree on the CropBox.`,
          page: page.index,
        });
    }
  for (const page of native?.pages ?? [])
    if (page.rotate.origin === "invalid")
      out.push({
        level: "warning",
        code: "invalidRotation",
        message: `Page ${page.index + 1}: rotation ${page.rotate.raw ?? "?"} is not a multiple of 90°; the page is shown unrotated.`,
        page: page.index,
      });
  const differs = input.optionalContent?.printDiffers ?? [];
  if (differs.length)
    out.push({
      level: "limitation",
      code: "printLayersDiffer",
      message: `Layers that change for printing (${differs.join(", ")}): previews follow the on-screen layer state, so print-only content may be missing.`,
    });
  return out;
}

export type DerivedRect = { ok: true; rect: Rect; note?: string } | { ok: false; message: string };

/** A trim override: `from` inset by `mm` on every side. */
export function insetBy(from: Rect, mm: number, userUnit: number): DerivedRect {
  if (!Number.isFinite(mm) || mm < 0) return { ok: false, message: "Enter an inset of 0 mm or more." };
  const d = mm / mmPerUnit(userUnit);
  const rect: Rect = [from[0] + d, from[1] + d, from[2] - d, from[3] - d];
  if (!(rect[2] > rect[0] && rect[3] > rect[1])) return { ok: false, message: "That inset leaves no page." };
  return { ok: true, rect };
}

/** A bleed override: `trim` extended by `mm` on every side, clipped to the MediaBox. */
export function outsetBy(trim: Rect, mm: number, userUnit: number, media: Rect): DerivedRect {
  if (!Number.isFinite(mm) || mm < 0) return { ok: false, message: "Enter a bleed of 0 mm or more." };
  const d = mm / mmPerUnit(userUnit);
  const wanted: Rect = [trim[0] - d, trim[1] - d, trim[2] + d, trim[3] + d];
  const rect: Rect = [
    Math.max(wanted[0], media[0]),
    Math.max(wanted[1], media[1]),
    Math.min(wanted[2], media[2]),
    Math.min(wanted[3], media[3]),
  ];
  const clipped = rect.some((v, i) => v !== wanted[i]);
  return {
    ok: true,
    rect,
    ...(clipped ? { note: "clipped to the MediaBox: the file has less bleed than requested" } : {}),
  };
}
