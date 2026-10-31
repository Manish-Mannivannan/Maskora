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

/**
 * How a finish looks, per finish type (architecture §4.4, §7.4). Units are
 * declared: gloss and strength are 0–1, height in micrometres, bevel in mm.
 */
export interface FinishRecipe {
  /** 0 = satin, 1 = mirror-like coating. */
  gloss: number;
  /** Coating opacity of the reflection layer, 0–1. */
  strength: number;
  /** Raised UV only: coating height above the stock. */
  heightUm: number;
  /** Raised UV only: width of the sloped edge. */
  bevelMm: number;
  /** Raised UV only: extra height at the middle of wide tops (0 = flat top). */
  crownUm: number;
}

export const DEFAULT_RECIPES: Record<FinishType, FinishRecipe> = {
  uv: { gloss: 0.9, strength: 1, heightUm: 0, bevelMm: 0, crownUm: 0 },
  raisedUv: { gloss: 0.95, strength: 1, heightUm: 80, bevelMm: 0.3, crownUm: 0 },
};

export const RECIPE_LIMITS = {
  gloss: [0, 1],
  strength: [0, 1],
  heightUm: [10, 300],
  bevelMm: [0.05, 2],
  crownUm: [0, 100],
} as const;

/**
 * Which printed pages the 3D view shows: a leaf's front and back, and a
 * spread's left and right. Chosen explicitly, never inferred from PDF order
 * (§7.5). Null front follows the page selected in the panel.
 */
export interface SceneAssignment {
  front: string | null;
  back: string | null;
  left: string | null;
  right: string | null;
}

/** The paper the pages are printed on: neutral presets, adjustable within limits. */
export interface Stock {
  preset: StockPreset | "custom";
  /** Surface roughness of the uncoated stock, 0–1. */
  roughness: number;
  thicknessMm: number;
}

export type StockPreset = "uncoated" | "matte" | "silk" | "gloss";

export const STOCK_PRESETS: Record<StockPreset, { name: string; roughness: number; thicknessMm: number }> = {
  uncoated: { name: "Uncoated", roughness: 0.9, thicknessMm: 0.35 },
  matte: { name: "Matte coated", roughness: 0.7, thicknessMm: 0.3 },
  silk: { name: "Silk coated", roughness: 0.5, thicknessMm: 0.3 },
  gloss: { name: "Gloss coated", roughness: 0.3, thicknessMm: 0.25 },
};

export const STOCK_LIMITS = { roughness: [0.05, 1], thicknessMm: [0.05, 3] } as const;

export function setStock(model: ProjectModel, patch: Partial<Stock>): Outcome {
  const preset = patch.preset && patch.preset !== "custom" ? STOCK_PRESETS[patch.preset] : null;
  const next: Stock = preset
    ? { preset: patch.preset!, roughness: preset.roughness, thicknessMm: preset.thicknessMm }
    : { ...model.stock, ...patch, preset: patch.preset ?? "custom" };
  for (const [key, [lo, hi]] of Object.entries(STOCK_LIMITS) as [
    keyof typeof STOCK_LIMITS,
    readonly [number, number],
  ][])
    if (!(next[key] >= lo && next[key] <= hi))
      return refuse("invalidStock", `${key} must be between ${lo} and ${hi}.`);
  return { ok: true, model: { ...model, stock: next } };
}

export interface ProjectModel {
  roles: Record<string, PageRole>;
  surfaces: PrintSurface[];
  /** In composition order. */
  layers: FinishLayer[];
  recipes: Record<FinishType, FinishRecipe>;
  scene: SceneAssignment;
  stock: Stock;
}

export const EMPTY_MODEL: ProjectModel = {
  roles: {},
  surfaces: [],
  layers: [],
  recipes: DEFAULT_RECIPES,
  scene: { front: null, back: null, left: null, right: null },
  stock: {
    preset: "matte",
    roughness: STOCK_PRESETS.matte.roughness,
    thicknessMm: STOCK_PRESETS.matte.thicknessMm,
  },
};

/** Scene slots that point at a surface that no longer exists become empty. */
function pruneScene(scene: SceneAssignment, surfaces: PrintSurface[]): SceneAssignment {
  const ok = (id: string | null) => (id && surfaces.some((s) => s.id === id) ? id : null);
  return { front: ok(scene.front), back: ok(scene.back), left: ok(scene.left), right: ok(scene.right) };
}

export function setSceneSlot(
  model: ProjectModel,
  slot: keyof SceneAssignment,
  surfaceId: string | null,
): Outcome {
  if (surfaceId !== null && !model.surfaces.some((s) => s.id === surfaceId))
    return refuse("unknownSurface", "Only a page marked Print can be shown on a leaf or spread.");
  return { ok: true, model: { ...model, scene: { ...model.scene, [slot]: surfaceId } } };
}

export function setRecipe(model: ProjectModel, type: FinishType, patch: Partial<FinishRecipe>): Outcome {
  const next = { ...model.recipes[type], ...patch };
  for (const [key, [lo, hi]] of Object.entries(RECIPE_LIMITS) as [
    keyof FinishRecipe,
    readonly [number, number],
  ][])
    if (
      !(next[key] >= lo && next[key] <= hi) &&
      !(type === "uv" && (key === "heightUm" || key === "bevelMm" || key === "crownUm"))
    )
      return refuse("invalidRecipe", `${key} must be between ${lo} and ${hi}.`);
  return { ok: true, model: { ...model, recipes: { ...model.recipes, [type]: next } } };
}

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
  return { ...model, roles, surfaces, layers, scene: pruneScene(model.scene, surfaces) };
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
  const surfaces = model.surfaces.filter((s) => !gone.has(s.id));
  return {
    ...model,
    roles,
    surfaces,
    layers: model.layers.map((l) => (l.target && gone.has(l.target) ? { ...l, target: null } : l)),
    scene: pruneScene(model.scene, surfaces),
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
