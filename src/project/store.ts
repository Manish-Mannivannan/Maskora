/**
 * One open project (architecture §4.5, §7.1, §8.1).
 *
 * A store is a project instance, never a global: everything it holds and
 * every job it starts belongs to it, so a later tabbed workspace can hold
 * several without a rewrite. A project has any number of source PDFs: artwork
 * and masks may share one file or come from separate ones.
 *
 * Each source gets a revision when it is added, and every asynchronous result
 * is applied only while that source and revision are still in the project; a
 * late result for a removed source is dropped, and a late PDF.js document
 * closed unseen. One file is added at a time; choosing another while one is
 * still loading supersedes it. A password is passed to both readers for one
 * attempt and kept nowhere: not in the state snapshot, a log or an error.
 *
 * Project intent (roles, surfaces, finish layers) changes only through the
 * pure operations in `model.ts`; a refused operation is kept as
 * `lastRefusal` for the panel to show.
 */
import type { DocMetadata, OptionalContentSummary, PdfPageFacts, PdfSession } from "@/pdf/adapter";
import type { GeometryReport, SourceInfo } from "@/native/sources";
import {
  available,
  failed,
  notRequested,
  running,
  valueOf,
  type Capability,
  type Provenance,
} from "./capability";
import { diagnose, type Diagnostic, type PageOverride } from "./facts";
import * as M from "./model";

export interface ProjectDeps {
  selectSource(): Promise<SourceInfo | null>;
  readSource(handle: string): Promise<Uint8Array>;
  inspectGeometry(handle: string, password?: string): Promise<GeometryReport>;
  /** SHA-256 hex of the bytes PDF.js will parse. */
  digest(bytes: Uint8Array): Promise<string>;
  /** Rejects with a PdfOpenError. */
  openPdf(bytes: Uint8Array, password?: string): Promise<PdfSession>;
  newId?(): string;
}

export type LoadState =
  | { kind: "idle" }
  | { kind: "selecting" }
  | { kind: "cancelled" }
  | { kind: "loading"; name: string; step: "reading" | "parsing" }
  | { kind: "password"; name: string; attempt: "needed" | "wrong" }
  | { kind: "failed"; name?: string; code: string; message: string }
  | { kind: "added"; name: string };

export interface SourceView {
  id: string;
  revision: number;
  name: string;
  size: number;
  engine: string;
  pageCount: number;
  digest: Capability<string>;
  pages: Capability<PdfPageFacts[]>;
  labels: Capability<string[]>;
  geometry: Capability<GeometryReport>;
  metadata: Capability<DocMetadata>;
  optionalContent: Capability<OptionalContentSummary>;
  diagnostics: Diagnostic[];
}

export interface ProjectState {
  /** The file being added, or how the last attempt ended. */
  load: LoadState;
  sources: SourceView[];
  selected: M.PageRef | null;
  /** Manual trim/bleed per page, keyed by `pageKey`. */
  overrides: Record<string, PageOverride>;
  model: M.ProjectModel;
  lastRefusal: { code: string; message: string } | null;
  view: ViewState;
}

/** How the project is being looked at; not project intent. */
export interface ViewState {
  mode: "3d" | "registration";
  /** The surface the registration view shows; null follows the selected layer's target. */
  surfaceId: string | null;
  selectedLayer: string | null;
  /** Layers left out of the registration overlay (they still count for the finish). */
  hiddenLayers: string[];
  /** 3D view: one leaf (front and back) or a two-page spread. */
  layout: "page" | "spread";
  /** 3D view: compare against the print alone. */
  printOnly: boolean;
  /** 3D view: which finish types are drawn. */
  show: Record<M.FinishType, boolean>;
  /** 3D view: raised UV as coating geometry (the default), or as a normal map (the lighter fallback). */
  raisedMode: "normals" | "mesh";
}

const INITIAL: ProjectState = {
  load: { kind: "idle" },
  sources: [],
  selected: null,
  overrides: {},
  model: M.EMPTY_MODEL,
  lastRefusal: null,
  view: {
    mode: "3d",
    surfaceId: null,
    selectedLayer: null,
    hiddenLayers: [],
    layout: "page",
    printOnly: false,
    show: { uv: true, raisedUv: true },
    raisedMode: "mesh",
  },
};

export class ProjectStore {
  readonly id: string;
  #state: ProjectState = INITIAL;
  #listeners = new Set<() => void>();
  /** Revisions are unique across the project's lifetime. */
  #revisions = 0;
  /** The add operation that may still apply its result. */
  #loading = 0;
  #sessions = new Map<string, { revision: number; session: PdfSession }>();
  /** Kept only while a password is being asked for. */
  #pending: { info: SourceInfo; bytes: Uint8Array } | null = null;
  readonly #newId: () => string;

  constructor(
    private readonly deps: ProjectDeps,
    id: string = globalThis.crypto.randomUUID(),
  ) {
    this.id = id;
    this.#newId = deps.newId ?? (() => globalThis.crypto.randomUUID());
  }

  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getState = () => this.#state;

  #set(patch: Partial<ProjectState>) {
    this.#state = { ...this.#state, ...patch };
    for (const listener of this.#listeners) listener();
  }

  source(id: string) {
    return this.#state.sources.find((s) => s.id === id);
  }

  /** Apply `patch` to source `id` only if it is still revision `rev`. */
  #patchSource(id: string, rev: number, patch: Partial<SourceView>) {
    const source = this.source(id);
    if (!source || source.revision !== rev) return;
    const next = { ...source, ...patch };
    next.diagnostics = diagnose({
      pdfPages: valueOf(next.pages),
      pageCount: next.pageCount,
      native: valueOf(next.geometry),
      digest: valueOf(next.digest),
      optionalContent: valueOf(next.optionalContent),
    });
    this.#set({ sources: this.#state.sources.map((s) => (s.id === id ? next : s)) });
  }

  /** The PDF.js session of a source at revision `rev`, or null once it is gone. */
  session(sourceId: string, rev: number): PdfSession | null {
    const entry = this.#sessions.get(sourceId);
    return entry && entry.revision === rev ? entry.session : null;
  }

  /** Choose a PDF and add it to the project. */
  async addSource() {
    // A new selection may supersede a file that is still loading.
    if (this.#state.load.kind === "selecting") return;
    this.#set({ load: { kind: "selecting" } });
    let info: SourceInfo | null;
    try {
      info = await this.deps.selectSource();
    } catch (error) {
      this.#set({ load: { kind: "failed", ...codeOf(error, "selectionFailed") } });
      return;
    }
    if (!info) {
      this.#set({ load: { kind: "cancelled" } });
      return;
    }
    this.#pending = null;
    await this.#begin(info);
  }

  async submitPassword(password: string) {
    const pending = this.#pending;
    if (!pending || this.#state.load.kind !== "password") return;
    await this.#begin(pending.info, password, pending.bytes);
  }

  /** Stop adding the current file; anything it still produces is discarded. */
  cancelLoad() {
    if (this.#state.load.kind !== "loading") return;
    this.#loading += 1;
    this.#set({ load: { kind: "cancelled" } });
  }

  cancelPassword() {
    if (this.#state.load.kind !== "password") return;
    this.#pending = null;
    this.#loading += 1;
    this.#set({ load: { kind: "cancelled" } });
  }

  async #begin(info: SourceInfo, password?: string, knownBytes?: Uint8Array) {
    const op = ++this.#loading;
    const current = () => op === this.#loading;
    this.#set({ load: { kind: "loading", name: info.name, step: "reading" } });

    let bytes: Uint8Array;
    try {
      bytes = knownBytes ?? (await this.deps.readSource(info.handle));
    } catch (error) {
      if (current())
        this.#set({ load: { kind: "failed", name: info.name, ...codeOf(error, "sourceUnreadable") } });
      return;
    }
    if (!current()) return;
    this.#set({ load: { kind: "loading", name: info.name, step: "parsing" } });

    // Both readers start now; PDF.js gets its own copy because it transfers the buffer to its worker.
    const digest = this.deps.digest(bytes);
    const geometry = this.deps.inspectGeometry(info.handle, password);
    geometry.catch(() => undefined);
    digest.catch(() => undefined);

    let session: PdfSession;
    try {
      session = await this.deps.openPdf(bytes.slice(), password);
    } catch (error) {
      if (!current()) return;
      const { code, message } = codeOf(error, "pdfReadFailed");
      if (code === "passwordNeeded" || code === "passwordWrong") {
        this.#pending = { info, bytes };
        this.#set({
          load: { kind: "password", name: info.name, attempt: code === "passwordWrong" ? "wrong" : "needed" },
        });
      } else {
        this.#set({ load: { kind: "failed", name: info.name, code, message } });
      }
      return;
    }
    if (!current()) {
      void session.close();
      return;
    }
    this.#pending = null;

    const id = this.#newId();
    const rev = ++this.#revisions;
    this.#sessions.set(id, { revision: rev, session });
    const pdfjs: Provenance = { engine: session.engine, sourceRevision: rev };
    this.#set({
      load: { kind: "added", name: info.name },
      sources: [
        ...this.#state.sources,
        {
          id,
          revision: rev,
          name: info.name,
          size: info.size,
          engine: session.engine,
          pageCount: session.pageCount,
          digest: running,
          pages: running,
          labels: running,
          geometry: running,
          metadata: notRequested,
          optionalContent: running,
          diagnostics: [],
        },
      ],
      selected: { sourceId: id, page: 0 },
    });

    const track = <T>(key: keyof SourceView, job: Promise<Capability<T>>) =>
      job.then(
        (cap) => this.#patchSource(id, rev, { [key]: cap }),
        (error) => this.#patchSource(id, rev, { [key]: failed(error) }),
      );
    void track(
      "digest",
      digest.then((d) => available(d, { engine: "Web Crypto SHA-256", sourceRevision: rev })),
    );
    void track(
      "geometry",
      geometry.then((r) => available(r, { engine: r.engine, sourceRevision: rev })),
    );
    void track(
      "pages",
      session.pages().then((p) => available(p, pdfjs)),
    );
    void track(
      "labels",
      session
        .labels()
        .then((l): Capability<string[]> =>
          l ? available(l, pdfjs) : { status: "absent", provenance: pdfjs },
        ),
    );
    void track(
      "optionalContent",
      session
        .optionalContent()
        .then((oc): Capability<OptionalContentSummary> =>
          oc.groups ? available(oc, pdfjs) : { status: "absent", provenance: pdfjs },
        ),
    );
  }

  /** Take a source out of the project: its pages' roles and surfaces go, layers using it show as missing. */
  removeSource(id: string) {
    const entry = this.#sessions.get(id);
    this.#sessions.delete(id);
    void entry?.session.close();
    const prefix = `${id}:`;
    this.#set({
      sources: this.#state.sources.filter((s) => s.id !== id),
      model: M.removeSource(this.#state.model, id),
      overrides: Object.fromEntries(
        Object.entries(this.#state.overrides).filter(([k]) => !k.startsWith(prefix)),
      ),
      selected: this.#state.selected?.sourceId === id ? null : this.#state.selected,
    });
  }

  /** Document information is read only when someone asks for it. */
  requestMetadata(sourceId: string) {
    const source = this.source(sourceId);
    const session = source && this.session(sourceId, source.revision);
    if (!source || !session || source.metadata.status !== "notRequested") return;
    const rev = source.revision;
    this.#patchSource(sourceId, rev, { metadata: running });
    session.metadata().then(
      (m) =>
        this.#patchSource(sourceId, rev, {
          metadata: available(m, { engine: session.engine, sourceRevision: rev }),
        }),
      (error) => this.#patchSource(sourceId, rev, { metadata: failed(error) }),
    );
  }

  selectPage(ref: M.PageRef) {
    const source = this.source(ref.sourceId);
    if (source && ref.page >= 0 && ref.page < source.pageCount) this.#set({ selected: { ...ref } });
  }

  /** Set (or with `undefined`, clear) a manual trim/bleed for the given pages. */
  setOverride(pages: M.PageRef[], patch: Partial<PageOverride>) {
    const overrides = { ...this.#state.overrides };
    for (const ref of pages) {
      const key = M.pageKey(ref);
      const next: PageOverride = { ...overrides[key], ...patch };
      for (const k of Object.keys(next) as (keyof PageOverride)[]) if (!next[k]) delete next[k];
      if (Object.keys(next).length) overrides[key] = next;
      else delete overrides[key];
    }
    this.#set({ overrides });
  }

  // Project intent ----------------------------------------------------------

  #apply(outcome: M.Outcome) {
    if (outcome.ok) this.#set({ model: outcome.model, lastRefusal: null });
    else this.#set({ lastRefusal: { code: outcome.code, message: outcome.message } });
    return outcome.ok;
  }

  setRole(ref: M.PageRef, role: M.PageRole) {
    const model = M.setRole(this.#state.model, ref, role, this.#newId);
    const added = model.layers.find((l) => !this.#state.model.layers.some((o) => o.id === l.id));
    this.#set({
      model,
      lastRefusal: null,
      ...(added ? { view: { ...this.#state.view, selectedLayer: added.id } } : {}),
    });
  }
  addLayer(ref: M.PageRef, type: M.FinishType) {
    return this.#apply(M.addLayer(this.#state.model, ref, type, this.#newId));
  }
  assignTarget(layerId: string, surfaceId: string | null) {
    return this.#apply(M.assignTarget(this.#state.model, layerId, surfaceId));
  }
  setLayerType(layerId: string, type: M.FinishType) {
    return this.#apply(M.setLayerType(this.#state.model, layerId, type));
  }
  setInterpretation(layerId: string, patch: Partial<M.MaskInterpretation>) {
    return this.#apply(M.setInterpretation(this.#state.model, layerId, patch));
  }
  resetInterpretation(layerId: string) {
    return this.#apply(M.setInterpretation(this.#state.model, layerId, M.DEFAULT_INTERPRETATION));
  }
  setLayerEnabled(layerId: string, enabled: boolean) {
    const model = this.#state.model;
    this.#set({
      model: { ...model, layers: model.layers.map((l) => (l.id === layerId ? { ...l, enabled } : l)) },
    });
  }
  removeLayer(layerId: string) {
    this.#set({ model: M.removeLayer(this.#state.model, layerId) });
  }
  moveLayer(layerId: string, step: -1 | 1) {
    this.#set({ model: M.moveLayer(this.#state.model, layerId, step) });
  }
  setSceneSlot(slot: keyof M.SceneAssignment, surfaceId: string | null) {
    return this.#apply(M.setSceneSlot(this.#state.model, slot, surfaceId));
  }
  setRecipe(type: M.FinishType, patch: Partial<M.FinishRecipe>) {
    return this.#apply(M.setRecipe(this.#state.model, type, patch));
  }
  setStock(patch: Partial<M.Stock>) {
    return this.#apply(M.setStock(this.#state.model, patch));
  }
  setSurfaceBox(surfaceId: string, box: M.SurfaceBox) {
    this.#set({ model: M.setSurfaceBox(this.#state.model, surfaceId, box) });
  }

  setView(patch: Partial<ViewState>) {
    this.#set({ view: { ...this.#state.view, ...patch } });
  }
  toggleLayerShown(layerId: string) {
    const hidden = this.#state.view.hiddenLayers;
    this.setView({
      hiddenLayers: hidden.includes(layerId) ? hidden.filter((h) => h !== layerId) : [...hidden, layerId],
    });
  }

  dispose() {
    this.#loading += 1;
    this.#pending = null;
    for (const { session } of this.#sessions.values()) void session.close();
    this.#sessions.clear();
  }
}

function codeOf(error: unknown, fallback: string): { code: string; message: string } {
  const e = error as { code?: unknown; message?: unknown };
  return {
    code: typeof e?.code === "string" ? e.code : fallback,
    message: typeof e?.message === "string" ? e.message : "The operation did not complete.",
  };
}
