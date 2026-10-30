/**
 * The project's intent: page roles, print surfaces and finish layers
 * (architecture §7.4, §8.1). Pure data and pure operations; the store applies
 * them and the UI shows their results and refusals.
 *
 * - A page of any source is unassigned, Print, Mask or Ignore. Marking a page
 *   Print makes it a print surface with an explicit box (TrimBox by default).
 * - A finish layer has one mask source, one type, and at most one target
 *   surface; several layers may share a target. Targets are validated: a
 *   layer can only point at an existing surface.
 * - Mask sources are a versioned union. `pdfPage` is supported; the kinds the
 *   architecture names for later, and any unknown kind, are kept verbatim as
 *   unsupported so a newer project survives being opened here.
 */
import type { BoxName } from "./facts";

export type PageRole = "unassigned" | "print" | "mask" | "ignore";
export type FinishType = "uv" | "raisedUv";
export const FINISH_TYPES: FinishType[] = ["uv", "raisedUv"];
export const FINISH_NAMES: Record<FinishType, string> = { uv: "Ordinary UV", raisedUv: "Raised UV" };

export interface PageRef {
  sourceId: string;
  page: number;
}

export const pageKey = (ref: PageRef) => `${ref.sourceId}:${ref.page}`;

/** Box a surface uses as the physical page and the registration anchor. */
export type SurfaceBox = Exclude<BoxName, "ArtBox">;

export interface PrintSurface {
  id: string;
  artwork: PageRef;
  box: SurfaceBox;
}

export type MaskSource =
  | { kind: "pdfPage"; version: 1; sourceId: string; page: number }
  | { kind: "unsupported"; declaredKind: string; reason: string; original: unknown };

/** How a rendered mask page becomes coverage (§7.4). */
export interface MaskInterpretation {
  /** Luminance reads a painted mask; alpha reads a transparent one. */
  mode: "luminance" | "alpha";
  /** Luminance mode: which ink means "finish here". */
  polarity: "dark" | "light";
  invert: boolean;
  /** 0–1: values at or above it are covered. */
  threshold: number;
  /** Edge softening radius in mm. */
  featherMm: number;
  /** Registration shift in mm: +X right, +Y up, as in PDF user space. */
  offsetMm: [number, number];
}

export const DEFAULT_INTERPRETATION: MaskInterpretation = {
  mode: "luminance",
  polarity: "dark",
  invert: false,
  threshold: 0.5,
  featherMm: 0,
  offsetMm: [0, 0],
};

export interface FinishLayer {
  id: string;
  type: FinishType;
  mask: MaskSource;
  target: string | null;
  enabled: boolean;
  interpretation: MaskInterpretation;
}

export interface ProjectModel {
  roles: Record<string, PageRole>;
  surfaces: PrintSurface[];
  /** In composition order. */
  layers: FinishLayer[];
}

export const EMPTY_MODEL: ProjectModel = { roles: {}, surfaces: [], layers: [] };

export type Refusal = { ok: false; code: string; message: string };
export type Outcome = { ok: true; model: ProjectModel } | Refusal;

const refuse = (code: string, message: string): Refusal => ({ ok: false, code, message });

export const roleOf = (model: ProjectModel, ref: PageRef): PageRole =>
  model.roles[pageKey(ref)] ?? "unassigned";

export const surfaceFor = (model: ProjectModel, ref: PageRef) =>
  model.surfaces.find((s) => s.artwork.sourceId === ref.sourceId && s.artwork.page === ref.page);

const sameRef = (mask: MaskSource, ref: PageRef) =>
  mask.kind === "pdfPage" && mask.sourceId === ref.sourceId && mask.page === ref.page;

/**
 * Give a page a role. Print creates its surface; Mask creates one unassigned
 * ordinary-UV layer if the page has none. Leaving Print removes the surface,
 * and layers that targeted it become unassigned rather than silently retargeted.
 */
export function setRole(
  model: ProjectModel,
  ref: PageRef,
  role: PageRole,
  newId: () => string,
): ProjectModel {
  const roles = { ...model.roles };
  if (role === "unassigned") delete roles[pageKey(ref)];
  else roles[pageKey(ref)] = role;
  let surfaces = model.surfaces;
  let layers = model.layers;
  const surface = surfaceFor(model, ref);
  if (role === "print" && !surface)
    surfaces = [...surfaces, { id: newId(), artwork: { ...ref }, box: "TrimBox" }];
  if (role !== "print" && surface) {
    surfaces = surfaces.filter((s) => s.id !== surface.id);
    layers = layers.map((l) => (l.target === surface.id ? { ...l, target: null } : l));
  }
  if (role === "mask" && !layers.some((l) => sameRef(l.mask, ref)))
    layers = [
      ...layers,
      {
        id: newId(),
        type: "uv",
        mask: { kind: "pdfPage", version: 1, sourceId: ref.sourceId, page: ref.page },
        target: null,
        enabled: true,
        interpretation: DEFAULT_INTERPRETATION,
      },
    ];
  return { roles, surfaces, layers };
}

export function addLayer(model: ProjectModel, ref: PageRef, type: FinishType, newId: () => string): Outcome {
  if (roleOf(model, ref) !== "mask")
    return refuse("notAMaskPage", "Only a page marked Mask can supply a finish.");
  if (!FINISH_TYPES.includes(type))
    return refuse("unsupportedFinish", `${type} is not available in this version.`);
  const layer: FinishLayer = {
    id: newId(),
    type,
    mask: { kind: "pdfPage", version: 1, sourceId: ref.sourceId, page: ref.page },
    target: null,
    enabled: true,
    interpretation: DEFAULT_INTERPRETATION,
  };
  return { ok: true, model: { ...model, layers: [...model.layers, layer] } };
}

const updateLayer = (
  model: ProjectModel,
  id: string,
  change: (l: FinishLayer) => FinishLayer | Refusal,
): Outcome => {
  const layer = model.layers.find((l) => l.id === id);
  if (!layer) return refuse("unknownLayer", "That finish layer does not exist.");
  const next = change(layer);
  if ("ok" in next) return next;
  return { ok: true, model: { ...model, layers: model.layers.map((l) => (l.id === id ? next : l)) } };
};

/** Point a layer at a surface, or with null leave it unassigned. Any other target is refused. */
export function assignTarget(model: ProjectModel, layerId: string, surfaceId: string | null): Outcome {
  if (surfaceId !== null && !model.surfaces.some((s) => s.id === surfaceId))
    return refuse("unknownSurface", "A finish can only target a page marked Print.");
  return updateLayer(model, layerId, (l) => ({ ...l, target: surfaceId }));
}

export function setLayerType(model: ProjectModel, layerId: string, type: FinishType): Outcome {
  if (!FINISH_TYPES.includes(type))
    return refuse("unsupportedFinish", `${type} is not available in this version.`);
  return updateLayer(model, layerId, (l) => ({ ...l, type }));
}

export function setInterpretation(
  model: ProjectModel,
  layerId: string,
  patch: Partial<MaskInterpretation>,
): Outcome {
  const bad = validateInterpretation({ ...DEFAULT_INTERPRETATION, ...patch });
  if (bad) return bad;
  return updateLayer(model, layerId, (l) => ({ ...l, interpretation: { ...l.interpretation, ...patch } }));
}

export function validateInterpretation(i: MaskInterpretation): Refusal | null {
  if (!(i.threshold >= 0 && i.threshold <= 1))
    return refuse("invalidThreshold", "Threshold must be between 0 and 1.");
  if (!(i.featherMm >= 0 && i.featherMm <= 20))
    return refuse("invalidFeather", "Feather must be between 0 and 20 mm.");
  if (!i.offsetMm.every((v) => Number.isFinite(v) && Math.abs(v) <= 50))
    return refuse("invalidOffset", "Offsets must be within ±50 mm.");
  return null;
}

export function removeLayer(model: ProjectModel, layerId: string): ProjectModel {
  return { ...model, layers: model.layers.filter((l) => l.id !== layerId) };
}

/** Move a layer one place earlier (-1) or later (+1) in composition order. */
export function moveLayer(model: ProjectModel, layerId: string, step: -1 | 1): ProjectModel {
  const i = model.layers.findIndex((l) => l.id === layerId);
  const j = i + step;
  if (i < 0 || j < 0 || j >= model.layers.length) return model;
  const layers = [...model.layers];
  [layers[i], layers[j]] = [layers[j], layers[i]];
  return { ...model, layers };
}

export function setSurfaceBox(model: ProjectModel, surfaceId: string, box: SurfaceBox): ProjectModel {
  return { ...model, surfaces: model.surfaces.map((s) => (s.id === surfaceId ? { ...s, box } : s)) };
}

/**
 * Forget a source: its roles and surfaces go; layers whose mask was on it stay,
 * visibly missing, so the user decides what to do with their settings.
 */
export function removeSource(model: ProjectModel, sourceId: string): ProjectModel {
  const roles = Object.fromEntries(
    Object.entries(model.roles).filter(([k]) => !k.startsWith(`${sourceId}:`)),
  );
  const gone = new Set(model.surfaces.filter((s) => s.artwork.sourceId === sourceId).map((s) => s.id));
  return {
    roles,
    surfaces: model.surfaces.filter((s) => !gone.has(s.id)),
    layers: model.layers.map((l) => (l.target && gone.has(l.target) ? { ...l, target: null } : l)),
  };
}

/** Why a layer cannot render, or null when it can. */
export function layerProblem(
  model: ProjectModel,
  layer: FinishLayer,
  sources: { id: string; pageCount: number }[],
): { code: string; message: string } | null {
  if (layer.mask.kind === "unsupported")
    return {
      code: "unsupportedMaskSource",
      message: `Mask source "${layer.mask.declaredKind}": ${layer.mask.reason}`,
    };
  const { sourceId, page } = layer.mask;
  const source = sources.find((s) => s.id === sourceId);
  if (!source || page >= source.pageCount)
    return { code: "missingMask", message: "The mask page is no longer in the project." };
  if (roleOf(model, layer.mask) !== "mask")
    return { code: "maskRoleChanged", message: "The mask page is no longer marked Mask." };
  if (!layer.target)
    return { code: "missingTarget", message: "Choose the printed page this finish belongs to." };
  if (!model.surfaces.some((s) => s.id === layer.target))
    return { code: "missingTarget", message: "The target page is no longer marked Print." };
  return null;
}

// ---------------------------------------------------------------------------
// Mask-source serialization (versioned union)
// ---------------------------------------------------------------------------

const FUTURE_KINDS: Record<string, string> = {
  pdfLayer: "PDF layers as masks arrive in a later version",
  pdfSeparation: "spot-colour separations as masks arrive in a later version",
  vectorPath: "vector masks arrive in a later version",
  image: "image masks arrive in a later version",
};

export type ParseResult<T> = { ok: true; value: T } | Refusal;

/** Read a stored mask source. Future and unknown kinds are kept as unsupported, never dropped. */
export function parseMaskSource(json: unknown): ParseResult<MaskSource> {
  if (typeof json !== "object" || json === null || typeof (json as { kind?: unknown }).kind !== "string")
    return refuse("invalidMaskSource", "A mask source must be an object with a kind.");
  const raw = json as Record<string, unknown>;
  const kind = raw.kind as string;
  if (kind === "pdfPage") {
    if (raw.version !== 1)
      return {
        ok: true,
        value: {
          kind: "unsupported",
          declaredKind: kind,
          reason: `version ${String(raw.version)} is newer than this app`,
          original: json,
        },
      };
    if (typeof raw.sourceId !== "string" || !Number.isInteger(raw.page) || (raw.page as number) < 0)
      return refuse("invalidMaskSource", "A PDF page mask needs a source and a page index.");
    return {
      ok: true,
      value: { kind: "pdfPage", version: 1, sourceId: raw.sourceId, page: raw.page as number },
    };
  }
  if (kind === "unsupported") return refuse("invalidMaskSource", '"unsupported" is not a stored kind.');
  return {
    ok: true,
    value: {
      kind: "unsupported",
      declaredKind: kind,
      reason: FUTURE_KINDS[kind] ?? "unknown mask source kind",
      original: json,
    },
  };
}

/** Write a mask source; an unsupported one is written back exactly as it was read. */
export function serializeMaskSource(source: MaskSource): unknown {
  return source.kind === "unsupported" ? source.original : { ...source };
}
