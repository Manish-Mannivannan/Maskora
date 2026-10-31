/**
 * The `.maskora.json` project file, schema 2 (architecture §9, §10.1, §10.2,
 * §14.3).
 *
 * A project file records intent, never content: sources by identity
 * (SHA-256, size, page count, and since schema 2 each page's native geometry
 * when saved, so a changed file can be compared page by page) and reference,
 * page roles, box overrides,
 * surfaces, finish layers with their interpretation and order, recipes,
 * stock, the leaf and spread assignments, lighting, camera and view state.
 * Native code adds each source's reference (a path relative to the project
 * file and the file name) when it writes the file; the frontend never holds
 * a path.
 *
 * Reading validates every value and reference and names the first problem
 * found. A newer schema is refused without touching the file. An older one
 * is migrated in memory, step by step, and reported, so the caller can keep
 * the original before writing over it. Mask sources
 * of unsupported kinds are kept verbatim, so a project from a newer version
 * round-trips through this one unchanged.
 */
import type { Rect } from "@/pdf/transform";
import {
  FINISH_TYPES,
  RECIPE_LIMITS,
  STOCK_LIMITS,
  STOCK_PRESETS,
  pageKey,
  parseMaskSource,
  serializeMaskSource,
  validateInterpretation,
  type FinishLayer,
  type FinishRecipe,
  type FinishType,
  type MaskInterpretation,
  type PageRef,
  type PageRole,
  type ProjectModel,
  type SceneAssignment,
  type Stock,
  type SurfaceBox,
} from "./model";
import type { PageOverride } from "./facts";
import type { ViewState } from "./store";

export const PROJECT_FORMAT = "maskora-project";
export const SCHEMA_VERSION = 2;

export interface ProjectSource {
  id: string;
  name: string;
  size: number;
  sha256: string;
  pageCount: number;
  /** Written by native code: where to look for the file, relative to the project file. */
  ref?: { relativePath: string | null; fileName: string };
  /** Each page's native geometry when saved; null when it was not known (or the file came from schema 1). */
  pages: SavedPage[] | null;
}

/** A page's geometry as the native reader stated it, in PDF user space. */
export interface SavedPage {
  mediaBox: Rect;
  trimBox: Rect;
  /** Effective /Rotate, or null when invalid. */
  rotation: number | null;
  userUnit: number;
}

export interface Lighting {
  azimuth: number;
  elevation: number;
  intensity: number;
  environmentDeg: number;
}

export interface CameraPose {
  position: [number, number, number];
  target: [number, number, number];
}

/** View settings worth keeping with the project (not selection-transient UI). */
export type SavedView = Pick<
  ViewState,
  "mode" | "layout" | "printOnly" | "show" | "raisedMode" | "hiddenLayers" | "surfaceId" | "selectedLayer"
>;

export interface ProjectFile {
  format: typeof PROJECT_FORMAT;
  schemaVersion: typeof SCHEMA_VERSION;
  app: { name: "Maskora"; version: string };
  /** UTC, ISO 8601. */
  savedAt: string;
  sources: ProjectSource[];
  model: ProjectModel;
  overrides: Record<string, PageOverride>;
  view: SavedView;
  lighting: Lighting;
  camera: CameraPose | null;
  selected: PageRef | null;
}

export const DEFAULT_LIGHTING: Lighting = { azimuth: 35, elevation: 40, intensity: 2.5, environmentDeg: 0 };

export type ProjectParse =
  | {
      ok: true;
      project: ProjectFile;
      /** The schema the file was written in, when older than this one: it was migrated in memory. */
      migratedFrom: number | null;
    }
  | { ok: false; code: string; message: string };

/**
 * Migrations, oldest first: `MIGRATIONS[n]` turns a schema-n object into a
 * schema-(n+1) one. Each is additive and pure; the input is not changed.
 */
const MIGRATIONS: Record<number, (root: Record<string, unknown>) => Record<string, unknown>> = {
  // Schema 2 records page geometry; a schema-1 project never knew it.
  1: (root) => ({
    ...root,
    schemaVersion: 2,
    sources: Array.isArray(root.sources)
      ? root.sources.map((s) => (isObj(s) ? { ...s, pages: null } : s))
      : root.sources,
  }),
};

/** A project-file object with mask sources serialized (unsupported ones verbatim). */
export function toJson(project: ProjectFile): unknown {
  return {
    ...project,
    model: {
      ...project.model,
      layers: project.model.layers.map((l) => ({ ...l, mask: serializeMaskSource(l.mask) })),
    },
  };
}

class Invalid extends Error {
  constructor(
    readonly at: string,
    detail: string,
  ) {
    super(`${at}: ${detail}`);
  }
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const obj = (v: unknown, at: string) => {
  if (!isObj(v)) throw new Invalid(at, "must be an object");
  return v;
};
const arr = (v: unknown, at: string) => {
  if (!Array.isArray(v)) throw new Invalid(at, "must be a list");
  return v;
};
const str = (v: unknown, at: string, max = 500) => {
  if (typeof v !== "string" || v.length > max) throw new Invalid(at, "must be text");
  return v;
};
const bool = (v: unknown, at: string) => {
  if (typeof v !== "boolean") throw new Invalid(at, "must be true or false");
  return v;
};
const num = (v: unknown, at: string, lo = -Infinity, hi = Infinity) => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < lo || v > hi)
    throw new Invalid(
      at,
      `must be a number${Number.isFinite(lo) ? ` from ${lo}` : ""}${Number.isFinite(hi) ? ` to ${hi}` : ""}`,
    );
  return v;
};
const int = (v: unknown, at: string, lo: number, hi = Number.MAX_SAFE_INTEGER) => {
  const n = num(v, at, lo, hi);
  if (!Number.isInteger(n)) throw new Invalid(at, "must be a whole number");
  return n;
};
const oneOf = <T extends string>(v: unknown, at: string, values: readonly T[]): T => {
  if (!values.includes(v as T)) throw new Invalid(at, `must be one of ${values.join(", ")}`);
  return v as T;
};
const rect = (v: unknown, at: string): Rect => {
  const a = arr(v, at);
  if (a.length !== 4) throw new Invalid(at, "must have four numbers");
  const r = a.map((x, k) => num(x, `${at}[${k}]`)) as Rect;
  if (!(r[2] > r[0] && r[3] > r[1])) throw new Invalid(at, "has no area");
  return r;
};
const rotation = (v: unknown, at: string) => {
  const r = num(v, at);
  if (![0, 90, 180, 270].includes(r)) throw new Invalid(at, "must be 0, 90, 180 or 270");
  return r;
};
const vec3 = (v: unknown, at: string): [number, number, number] => {
  const a = arr(v, at);
  if (a.length !== 3) throw new Invalid(at, "must have three numbers");
  return [num(a[0], `${at}[0]`), num(a[1], `${at}[1]`), num(a[2], `${at}[2]`)];
};

const ROLES: readonly PageRole[] = ["unassigned", "print", "mask", "ignore"];
const BOXES: readonly SurfaceBox[] = ["TrimBox", "BleedBox", "CropBox", "MediaBox"];

/** Read and validate a project file. */
export function parseProjectFile(input: unknown): ProjectParse {
  try {
    let root = input;
    let migratedFrom: number | null = null;
    if (isObj(root) && root.format === PROJECT_FORMAT) {
      const version = root.schemaVersion;
      if (
        typeof version === "number" &&
        Number.isInteger(version) &&
        version >= 1 &&
        version < SCHEMA_VERSION
      ) {
        migratedFrom = version;
        for (let v = version; v < SCHEMA_VERSION; v += 1)
          root = MIGRATIONS[v](root as Record<string, unknown>);
      }
    }
    return { ok: true, project: read(root), migratedFrom };
  } catch (error) {
    if (error instanceof Invalid) {
      if (error.at === "schemaVersion" && error.message.includes("newer"))
        return { ok: false, code: "futureSchema", message: error.message };
      return { ok: false, code: "invalidProject", message: error.message };
    }
    throw error;
  }
}

function read(input: unknown): ProjectFile {
  const root = obj(input, "project");
  if (root.format !== PROJECT_FORMAT) throw new Invalid("format", "is not a Maskora project");
  const version = int(root.schemaVersion, "schemaVersion", 1);
  if (version > SCHEMA_VERSION)
    throw new Invalid(
      "schemaVersion",
      `${version} is newer than this version reads (${SCHEMA_VERSION}); the file was not changed`,
    );
  const app = obj(root.app, "app");

  const sources = arr(root.sources, "sources").map((v, i): ProjectSource => {
    const at = `sources[${i}]`;
    const s = obj(v, at);
    const sha256 = str(s.sha256, `${at}.sha256`, 64);
    if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Invalid(`${at}.sha256`, "must be a SHA-256 in hexadecimal");
    const source: ProjectSource = {
      id: str(s.id, `${at}.id`, 100),
      name: str(s.name, `${at}.name`, 300),
      size: int(s.size, `${at}.size`, 0),
      sha256,
      pageCount: int(s.pageCount, `${at}.pageCount`, 1, 100_000),
      pages: null,
    };
    if (s.pages !== null) {
      const pages = arr(s.pages, `${at}.pages`);
      if (pages.length !== source.pageCount) throw new Invalid(`${at}.pages`, "must list every page");
      source.pages = pages.map((p, k): SavedPage => {
        const pa = `${at}.pages[${k}]`;
        const o = obj(p, pa);
        return {
          mediaBox: rect(o.mediaBox, `${pa}.mediaBox`),
          trimBox: rect(o.trimBox, `${pa}.trimBox`),
          rotation: o.rotation === null ? null : rotation(o.rotation, `${pa}.rotation`),
          userUnit: num(o.userUnit, `${pa}.userUnit`, 0.0001, 75000),
        };
      });
    }
    if (s.ref !== undefined) {
      const ref = obj(s.ref, `${at}.ref`);
      source.ref = {
        relativePath:
          ref.relativePath === null ? null : str(ref.relativePath, `${at}.ref.relativePath`, 2000),
        fileName: str(ref.fileName, `${at}.ref.fileName`, 300),
      };
    }
    return source;
  });
  const sourceIds = new Set(sources.map((s) => s.id));
  if (sourceIds.size !== sources.length) throw new Invalid("sources", "ids must be unique");
  const pageRef = (v: unknown, at: string): PageRef => {
    const r = obj(v, at);
    const sourceId = str(r.sourceId, `${at}.sourceId`, 100);
    const source = sources.find((s) => s.id === sourceId);
    if (!source) throw new Invalid(`${at}.sourceId`, "names no source in the project");
    return { sourceId, page: int(r.page, `${at}.page`, 0, source.pageCount - 1) };
  };
  const keyRef = (key: string, at: string): PageRef => {
    const m = /^(.+):(\d+)$/.exec(key);
    if (!m) throw new Invalid(at, "is not a page key");
    return pageRef({ sourceId: m[1], page: Number(m[2]) }, at);
  };

  const m = obj(root.model, "model");
  const roles: Record<string, PageRole> = {};
  for (const [key, role] of Object.entries(obj(m.roles, "model.roles"))) {
    keyRef(key, `model.roles["${key}"]`);
    roles[key] = oneOf(role, `model.roles["${key}"]`, ROLES);
  }
  const surfaces = arr(m.surfaces, "model.surfaces").map((v, i) => {
    const at = `model.surfaces[${i}]`;
    const s = obj(v, at);
    const artwork = pageRef(s.artwork, `${at}.artwork`);
    if (roles[pageKey(artwork)] !== "print") throw new Invalid(`${at}.artwork`, "is not a page marked Print");
    return { id: str(s.id, `${at}.id`, 100), artwork, box: oneOf(s.box, `${at}.box`, BOXES) };
  });
  const surfaceIds = new Set(surfaces.map((s) => s.id));
  if (surfaceIds.size !== surfaces.length) throw new Invalid("model.surfaces", "ids must be unique");
  const surfaceOrNull = (v: unknown, at: string) => {
    if (v === null) return null;
    const id = str(v, at, 100);
    if (!surfaceIds.has(id)) throw new Invalid(at, "names no printed page in the project");
    return id;
  };

  const layers = arr(m.layers, "model.layers").map((v, i): FinishLayer => {
    const at = `model.layers[${i}]`;
    const l = obj(v, at);
    const mask = parseMaskSource(l.mask);
    if (!mask.ok) throw new Invalid(`${at}.mask`, mask.message);
    // A mask whose source was removed is kept: the layer shows as missing its mask, as it did when saved.
    const maskRef = mask.value.kind === "pdfPage" ? mask.value : null;
    if (maskRef && sourceIds.has(maskRef.sourceId)) pageRef(maskRef, `${at}.mask`);
    const ii = obj(l.interpretation, `${at}.interpretation`);
    const offset = arr(ii.offsetMm, `${at}.interpretation.offsetMm`);
    if (offset.length !== 2) throw new Invalid(`${at}.interpretation.offsetMm`, "must have two numbers");
    const interpretation: MaskInterpretation = {
      mode: oneOf(ii.mode, `${at}.interpretation.mode`, ["luminance", "alpha"] as const),
      polarity: oneOf(ii.polarity, `${at}.interpretation.polarity`, ["dark", "light"] as const),
      invert: bool(ii.invert, `${at}.interpretation.invert`),
      threshold: num(ii.threshold, `${at}.interpretation.threshold`),
      featherMm: num(ii.featherMm, `${at}.interpretation.featherMm`),
      offsetMm: [
        num(offset[0], `${at}.interpretation.offsetMm[0]`),
        num(offset[1], `${at}.interpretation.offsetMm[1]`),
      ],
    };
    const bad = validateInterpretation(interpretation);
    if (bad) throw new Invalid(`${at}.interpretation`, bad.message);
    return {
      id: str(l.id, `${at}.id`, 100),
      type: oneOf(l.type, `${at}.type`, FINISH_TYPES),
      mask: mask.value,
      target: surfaceOrNull(l.target, `${at}.target`),
      enabled: bool(l.enabled, `${at}.enabled`),
      interpretation,
    };
  });
  const layerIds = new Set(layers.map((l) => l.id));
  if (layerIds.size !== layers.length) throw new Invalid("model.layers", "ids must be unique");

  const recipesIn = obj(m.recipes, "model.recipes");
  const recipes = Object.fromEntries(
    FINISH_TYPES.map((type) => {
      const at = `model.recipes.${type}`;
      const r = obj(recipesIn[type], at);
      const lim = (key: keyof typeof RECIPE_LIMITS) =>
        type === "uv" && key !== "gloss" && key !== "strength"
          ? num(r[key], `${at}.${key}`, 0, RECIPE_LIMITS[key][1])
          : num(r[key], `${at}.${key}`, RECIPE_LIMITS[key][0], RECIPE_LIMITS[key][1]);
      const recipe: FinishRecipe = {
        gloss: lim("gloss"),
        strength: lim("strength"),
        heightUm: lim("heightUm"),
        bevelMm: lim("bevelMm"),
        crownUm: lim("crownUm"),
      };
      return [type, recipe];
    }),
  ) as Record<FinishType, FinishRecipe>;

  const sc = obj(m.scene, "model.scene");
  const scene: SceneAssignment = {
    front: surfaceOrNull(sc.front, "model.scene.front"),
    back: surfaceOrNull(sc.back, "model.scene.back"),
    left: surfaceOrNull(sc.left, "model.scene.left"),
    right: surfaceOrNull(sc.right, "model.scene.right"),
  };
  const st = obj(m.stock, "model.stock");
  const stock: Stock = {
    preset: oneOf(st.preset, "model.stock.preset", [
      ...(Object.keys(STOCK_PRESETS) as Stock["preset"][]),
      "custom",
    ]),
    roughness: num(st.roughness, "model.stock.roughness", ...STOCK_LIMITS.roughness),
    thicknessMm: num(st.thicknessMm, "model.stock.thicknessMm", ...STOCK_LIMITS.thicknessMm),
  };

  const overrides: Record<string, PageOverride> = {};
  for (const [key, v] of Object.entries(obj(root.overrides, "overrides"))) {
    const at = `overrides["${key}"]`;
    keyRef(key, at);
    const o = obj(v, at);
    const box = (name: "trim" | "bleed") => {
      if (o[name] === undefined) return undefined;
      const b = obj(o[name], `${at}.${name}`);
      const r = arr(b.rect, `${at}.${name}.rect`);
      if (r.length !== 4) throw new Invalid(`${at}.${name}.rect`, "must have four numbers");
      const rect = r.map((x, k) => num(x, `${at}.${name}.rect[${k}]`)) as Rect;
      if (!(rect[2] > rect[0] && rect[3] > rect[1])) throw new Invalid(`${at}.${name}.rect`, "has no area");
      return { rect, derivation: str(b.derivation, `${at}.${name}.derivation`) };
    };
    const trim = box("trim");
    const bleed = box("bleed");
    overrides[key] = { ...(trim ? { trim } : {}), ...(bleed ? { bleed } : {}) };
  }

  const vw = obj(root.view, "view");
  const show = obj(vw.show, "view.show");
  const view: SavedView = {
    mode: oneOf(vw.mode, "view.mode", ["3d", "registration"] as const),
    layout: oneOf(vw.layout, "view.layout", ["page", "spread"] as const),
    printOnly: bool(vw.printOnly, "view.printOnly"),
    show: { uv: bool(show.uv, "view.show.uv"), raisedUv: bool(show.raisedUv, "view.show.raisedUv") },
    raisedMode: oneOf(vw.raisedMode, "view.raisedMode", ["mesh", "normals"] as const),
    hiddenLayers: arr(vw.hiddenLayers, "view.hiddenLayers").map((id, i) => {
      const s = str(id, `view.hiddenLayers[${i}]`, 100);
      if (!layerIds.has(s)) throw new Invalid(`view.hiddenLayers[${i}]`, "names no finish layer");
      return s;
    }),
    surfaceId: surfaceOrNull(vw.surfaceId, "view.surfaceId"),
    selectedLayer:
      vw.selectedLayer === null
        ? null
        : (() => {
            const s = str(vw.selectedLayer, "view.selectedLayer", 100);
            if (!layerIds.has(s)) throw new Invalid("view.selectedLayer", "names no finish layer");
            return s;
          })(),
  };

  const li = obj(root.lighting, "lighting");
  const lighting: Lighting = {
    azimuth: num(li.azimuth, "lighting.azimuth", 0, 360),
    elevation: num(li.elevation, "lighting.elevation", -10, 89),
    intensity: num(li.intensity, "lighting.intensity", 0, 6),
    environmentDeg: num(li.environmentDeg, "lighting.environmentDeg", 0, 360),
  };
  const camera =
    root.camera === null
      ? null
      : (() => {
          const c = obj(root.camera, "camera");
          return { position: vec3(c.position, "camera.position"), target: vec3(c.target, "camera.target") };
        })();
  const selected = root.selected === null ? null : pageRef(root.selected, "selected");

  return {
    format: PROJECT_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    app: { name: "Maskora", version: str(app.version, "app.version", 50) },
    savedAt: str(root.savedAt, "savedAt", 40),
    sources,
    model: { roles, surfaces, layers, recipes, scene, stock },
    overrides,
    view,
    lighting,
    camera,
    selected,
  };
}
