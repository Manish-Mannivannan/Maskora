/**
 * One open project (architecture §4.5, §7.1, §8.1, §9.4).
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
 *
 * Saving writes the project file through native code, which adds each
 * source's reference. Opening one restores everything it records and then
 * loads its sources one at a time, under their saved ids. A source native
 * code could not authorize (missing, unfamiliar to this installation, or
 * different from what was approved) waits in `relink` for the user to locate
 * or approve it. A source whose content differs from what the project saved
 * is loaded but held: nothing it is assigned to renders or exports until the
 * user keeps it, reconciles it page by page, or chooses another file, so
 * index-based assignments are never silently reused on changed pages.
 *
 * Project intent (model, overrides, lighting) has undo and redo. Rapid edits
 * of the same thing (a dragged slider) are one step. Opening, recovering,
 * starting anew, removing a source and reconciling one are boundaries: the
 * history before them is dropped, because it refers to files that changed.
 *
 * While there are unsaved changes, a recovery snapshot is kept through native
 * code, and a snapshot left by a crash is offered back on the next start.
 */
import type { DocMetadata, OptionalContentSummary, PdfPageFacts, PdfSession } from "@/pdf/adapter";
import type { GeometryReport, SourceInfo } from "@/native/sources";
import type {
  Located,
  Opened,
  RecoveryRequest,
  Recovered,
  SaveRequest,
  Saved,
  SourceOnOpen,
} from "@/native/project";
import {
  available,
  failed,
  notRequested,
  running,
  valueOf,
  type Capability,
  type Provenance,
} from "./capability";
import { mmPerUnit, type Rect } from "@/pdf/transform";
import { record } from "@/diagnostics/log";
import { diagnose, type Diagnostic, type PageOverride } from "./facts";
import * as M from "./model";
import {
  DEFAULT_LIGHTING,
  PROJECT_FORMAT,
  SCHEMA_VERSION,
  parseProjectFile,
  toJson,
  type CameraPose,
  type Lighting,
  type ProjectFile,
  type ProjectSource,
  type SavedPage,
} from "./projectFile";

export interface ProjectDeps {
  selectSource(): Promise<SourceInfo | null>;
  readSource(handle: string): Promise<Uint8Array>;
  inspectGeometry(handle: string, password?: string): Promise<GeometryReport>;
  /** SHA-256 hex of the bytes PDF.js will parse. */
  digest(bytes: Uint8Array): Promise<string>;
  /** Rejects with a PdfOpenError. */
  openPdf(bytes: Uint8Array, password?: string): Promise<PdfSession>;
  newId?(): string;
  /** Project files; without them the store cannot save or open. */
  files?: {
    save(request: SaveRequest): Promise<Saved | null>;
    open(): Promise<Opened | null>;
    locate(fileName: string, token: string | null): Promise<Located | null>;
    /** Recovery snapshots of unsaved work; without them nothing is kept. */
    recovery?: {
      save(request: RecoveryRequest): Promise<void>;
      peek(): Promise<{ savedUnix: number; meta: string } | null>;
      recover(): Promise<Recovered | null>;
      discard(): Promise<void>;
    };
  };
  /** Delay before unsaved work is snapshotted, ms (tests shorten it). */
  recoveryDelayMs?: number;
  appVersion?: string;
  now?(): Date;
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

/**
 * A reopened project's source that is not simply back: still loading, waiting
 * for the user, failed, held because its content changed, or back with a note.
 */
export interface Relink {
  /** The identity and reference the project file recorded. */
  saved: ProjectSource;
  status: "loading" | "missing" | "needsApproval" | "failed" | "changed" | "ok";
  reason?: "unfamiliar" | "contentChanged";
  /** ok: how it came back. */
  note?: "moved" | "approved" | "kept" | "reconciled";
  message?: string;
}

/** The project file this project was opened from or saved to, and how the last file action ended. */
export interface FileState {
  /** Native token for the file; null until first saved or opened. */
  token: string | null;
  name: string | null;
  /** `contentKey` of what was last saved or opened, to tell unsaved changes. */
  savedKey: string | null;
  /** The file is in an older schema; saving upgrades it, keeping the original beside it. */
  migratedFrom: number | null;
  last:
    | { kind: "idle" }
    | { kind: "saving" }
    | { kind: "opening" }
    | { kind: "saved"; name: string; overwritten: boolean; backup: string | null }
    | { kind: "opened"; name: string; migratedFrom: number | null }
    | { kind: "recovered"; name: string | null }
    | { kind: "cancelled"; what: "save" | "open" | "locate" }
    | { kind: "failed"; what: "save" | "open" | "locate"; code: string; message: string };
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
  lighting: Lighting;
  /** The 3D camera as last recorded, rounded so a restored pose compares equal. */
  camera: CameraPose | null;
  /** Bumped when `camera` should be applied to the viewport (a project was opened). */
  cameraRestore: number;
  /** Reopened sources that are not simply back, keyed by source id. */
  relink: Record<string, Relink>;
  file: FileState;
  /** How many steps undo and redo can take. */
  history: { undo: number; redo: number };
  /** Unsaved work left by an earlier session, waiting for the user to recover or discard it. */
  recoveryOffer: { savedUnix: number; name: string | null } | null;
}

/** The project intent undo and redo move between. */
type Intent = Pick<ProjectState, "model" | "overrides" | "lighting">;

/** A page the project assigns something on a changed source, for page-by-page reconciliation. */
export interface ReconcileRow {
  /** Page index in the file the project was saved with. */
  page: number;
  role: M.PageRole;
  surfaceId: string | null;
  layerIds: string[];
  hasOverride: boolean;
  /** Trim size then and now in mm, when known. */
  savedSizeMm: [number, number] | null;
  /** Suggested page in the new file: the same index when it exists. */
  suggested: number | null;
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
  lighting: DEFAULT_LIGHTING,
  camera: null,
  cameraRestore: 0,
  relink: {},
  file: { token: null, name: null, savedKey: null, migratedFrom: null, last: { kind: "idle" } },
  history: { undo: 0, redo: 0 },
  recoveryOffer: null,
};

/** Edits of the same kind closer together than this are one undo step. */
const COALESCE_MS = 800;
const HISTORY_LIMIT = 100;

/**
 * What a project file says, without when or by what it was written, where its
 * sources were, or their page geometry (a fact read from the file, not intent).
 */
export function contentKey(file: ProjectFile): string {
  const sources = file.sources
    .map((s) => ({
      id: s.id,
      name: s.name,
      size: s.size,
      sha256: s.sha256,
      pageCount: s.pageCount,
      pages: null,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return JSON.stringify(toJson({ ...file, savedAt: "", app: { name: "Maskora", version: "" }, sources }));
}

/** Sources that must not feed a render or export yet, with the reason to show. */
export function blockedSources(state: Pick<ProjectState, "relink" | "sources">): Map<string, string> {
  const out = new Map<string, string>();
  for (const [id, r] of Object.entries(state.relink)) {
    const name = r.saved.name;
    if (r.status === "changed")
      out.set(
        id,
        `${name} has changed since the project was saved; keep, reconcile or replace it in Project.`,
      );
    else if (r.status !== "ok")
      out.set(
        id,
        `${name} is not available yet (${r.status === "loading" ? "loading" : "locate it in Project"}).`,
      );
  }
  return out;
}

/** The native geometry of every page, as a project file records it. */
export function savedPages(report: GeometryReport | undefined): SavedPage[] | null {
  if (!report) return null;
  const box = (p: GeometryReport["pages"][number], name: string) =>
    p.boxes.find(([n]) => n === name)?.[1].effective;
  return report.pages.map((p) => ({
    mediaBox: box(p, "MediaBox")!,
    trimBox: box(p, "TrimBox") ?? box(p, "MediaBox")!,
    rotation: p.rotate.effective,
    userUnit: p.userUnit,
  }));
}

const roundPose = (p: CameraPose): CameraPose => {
  const r = (v: number) => Math.round(v * 1e5) / 1e5;
  return {
    position: p.position.map(r) as CameraPose["position"],
    target: p.target.map(r) as CameraPose["target"],
  };
};

interface LoadJob {
  info: SourceInfo;
  /** The saved id the source is restored under. */
  id: string;
  /** Relink outcome once it has loaded. */
  outcome: Pick<Relink, "status" | "note">;
}

export class ProjectStore {
  readonly id: string;
  #state: ProjectState = INITIAL;
  #listeners = new Set<() => void>();
  /** Revisions are unique across the project's lifetime. */
  #revisions = 0;
  /** The add operation that may still apply its result. */
  #loading = 0;
  #sessions = new Map<string, { revision: number; session: PdfSession }>();
  /** Native handles of loaded sources, sent back to native code when saving. */
  #handles = new Map<string, string>();
  /** Kept only while a password is being asked for. */
  #pending: { info: SourceInfo; bytes: Uint8Array; job?: LoadJob } | null = null;
  /** Reopened sources still to load, in the project's order. */
  #queue: LoadJob[] = [];
  #undo: Intent[] = [];
  #redo: Intent[] = [];
  #lastEdit = { at: 0, key: "" };
  #replaying = false;
  #recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  /** Whether this session wrote the snapshot now on disk. */
  #recoveryWritten = false;
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
    const prev = this.#state;
    let next = { ...prev, ...patch };
    const changed = (["model", "overrides", "lighting"] as const).filter(
      (k) => k in patch && patch[k] !== prev[k],
    );
    if (changed.length && !this.#replaying) {
      // One undo step per burst of the same edit: a dragged slider is one change.
      const key = changed
        .map((k) =>
          k === "model"
            ? `model.${(Object.keys(next.model) as (keyof M.ProjectModel)[]).filter((m) => next.model[m] !== prev.model[m]).join("+")}`
            : k,
        )
        .join(",");
      const now = Date.now();
      if (!(key === this.#lastEdit.key && now - this.#lastEdit.at < COALESCE_MS && this.#undo.length)) {
        this.#undo.push({ model: prev.model, overrides: prev.overrides, lighting: prev.lighting });
        if (this.#undo.length > HISTORY_LIMIT) this.#undo.shift();
      }
      this.#lastEdit = { at: now, key };
      this.#redo = [];
      next = { ...next, history: { undo: this.#undo.length, redo: 0 } };
    }
    this.#state = next;
    for (const listener of this.#listeners) listener();
    this.#scheduleRecovery();
  }

  /** Drop undo history: what it refers to no longer holds. */
  #boundary() {
    this.#undo = [];
    this.#redo = [];
    this.#lastEdit = { at: 0, key: "" };
    if (this.#state.history.undo || this.#state.history.redo) this.#set({ history: { undo: 0, redo: 0 } });
  }

  #replay(from: Intent[], to: Intent[]) {
    const step = from.pop();
    if (!step) return false;
    const s = this.#state;
    to.push({ model: s.model, overrides: s.overrides, lighting: s.lighting });
    this.#replaying = true;
    try {
      this.#set({
        ...step,
        lastRefusal: null,
        history: { undo: this.#undo.length, redo: this.#redo.length },
      });
    } finally {
      this.#replaying = false;
    }
    this.#lastEdit = { at: 0, key: "" };
    return true;
  }

  undo() {
    return this.#replay(this.#undo, this.#redo);
  }

  redo() {
    return this.#replay(this.#redo, this.#undo);
  }

  #setFile(patch: Partial<FileState>) {
    const last = patch.last;
    if (last && last.kind !== "saving" && last.kind !== "opening" && last.kind !== "idle")
      record({
        kind: "file",
        action:
          last.kind === "saved"
            ? "save"
            : last.kind === "recovered"
              ? "recover"
              : last.kind === "opened"
                ? "open"
                : last.what,
        outcome: last.kind,
        ...(last.kind === "failed" ? { code: last.code } : {}),
      });
    this.#set({ file: { ...this.#state.file, ...patch } });
  }

  #setRelink(id: string, entry: Relink | null) {
    const relink = { ...this.#state.relink };
    if (entry) relink[id] = entry;
    else delete relink[id];
    this.#set({ relink });
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

  /** Whether reopened sources are still being loaded. */
  get restoring() {
    return this.#queue.length > 0 || Object.values(this.#state.relink).some((r) => r.status === "loading");
  }

  /** Choose a PDF and add it to the project. */
  async addSource() {
    // A new selection may supersede a file that is still loading, but not a project's sources being restored.
    if (this.#state.load.kind === "selecting" || this.restoring) return;
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
    await this.#begin(pending.info, password, pending.bytes, pending.job);
    void this.#next();
  }

  /** Stop adding the current file; anything it still produces is discarded. */
  cancelLoad() {
    if (this.#state.load.kind !== "loading" || this.restoring) return;
    this.#loading += 1;
    this.#set({ load: { kind: "cancelled" } });
  }

  cancelPassword() {
    if (this.#state.load.kind !== "password") return;
    const job = this.#pending?.job;
    this.#pending = null;
    this.#loading += 1;
    this.#set({ load: { kind: "cancelled" } });
    if (job) {
      const r = this.#state.relink[job.id];
      if (r) this.#setRelink(job.id, { saved: r.saved, status: "failed", message: "No password was given." });
      void this.#next();
    }
  }

  /** Load the next reopened source, unless one is loading or waiting for a password. */
  async #next() {
    for (;;) {
      const kind = this.#state.load.kind;
      if (kind === "loading" || kind === "password" || kind === "selecting") return;
      const job = this.#queue.shift();
      if (!job) {
        this.#settleRelinks();
        return;
      }
      await this.#begin(job.info, undefined, undefined, job);
    }
  }

  /** Read and open `info`; with `job`, as a reopened source under its saved id. */
  async #begin(info: SourceInfo, password?: string, knownBytes?: Uint8Array, job?: LoadJob) {
    const op = ++this.#loading;
    const current = () => op === this.#loading;
    const fail = (code: string, message: string) => {
      record({ kind: "source", source: job?.id ?? "new", revision: 0, pages: 0, outcome: "failed", code });
      this.#set({ load: { kind: "failed", name: info.name, code, message } });
      if (job) {
        const r = this.#state.relink[job.id];
        if (r) this.#setRelink(job.id, { saved: r.saved, status: "failed", message });
      }
    };
    this.#set({ load: { kind: "loading", name: info.name, step: "reading" } });

    let bytes: Uint8Array;
    try {
      bytes = knownBytes ?? (await this.deps.readSource(info.handle));
    } catch (error) {
      if (current()) {
        const e = codeOf(error, "sourceUnreadable");
        fail(e.code, e.message);
      }
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
        this.#pending = { info, bytes, job };
        record({
          kind: "source",
          source: job?.id ?? "new",
          revision: 0,
          pages: 0,
          outcome: "password",
          code,
        });
        this.#set({
          load: { kind: "password", name: info.name, attempt: code === "passwordWrong" ? "wrong" : "needed" },
        });
      } else fail(code, message);
      return;
    }
    if (!current()) {
      void session.close();
      return;
    }
    this.#pending = null;

    const id = job?.id ?? this.#newId();
    const rev = ++this.#revisions;
    this.#sessions.set(id, { revision: rev, session });
    record({ kind: "source", source: id, revision: rev, pages: session.pageCount, outcome: "added" });
    this.#handles.set(id, info.handle);
    const pdfjs: Provenance = { engine: session.engine, sourceRevision: rev };
    const view: SourceView = {
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
    };
    this.#set({
      load: { kind: "added", name: info.name },
      sources: [...this.#state.sources.filter((s) => s.id !== id), view],
      ...(job ? {} : { selected: { sourceId: id, page: 0 } }),
    });
    if (job) {
      const r = this.#state.relink[id];
      if (r) this.#setRelink(id, { saved: r.saved, ...job.outcome });
    }

    const track = <T>(key: keyof SourceView, work: Promise<Capability<T>>) =>
      work.then(
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

  /** Close a source's document and forget it, without touching what the project assigns to it. */
  #unload(id: string) {
    const entry = this.#sessions.get(id);
    this.#sessions.delete(id);
    this.#handles.delete(id);
    void entry?.session.close();
    this.#set({ sources: this.#state.sources.filter((s) => s.id !== id) });
  }

  /** Take a source out of the project: its pages' roles and surfaces go, layers using it show as missing. */
  removeSource(id: string) {
    this.#unload(id);
    this.#queue = this.#queue.filter((j) => j.id !== id);
    const prefix = `${id}:`;
    const relink = { ...this.#state.relink };
    delete relink[id];
    this.#set({
      relink,
      model: M.removeSource(this.#state.model, id),
      overrides: Object.fromEntries(
        Object.entries(this.#state.overrides).filter(([k]) => !k.startsWith(prefix)),
      ),
      selected: this.#state.selected?.sourceId === id ? null : this.#state.selected,
    });
    this.#boundary();
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

  /** Lighting values are wrapped or clamped into their ranges by the caller (`normalizeAngles`). */
  setLighting(patch: Partial<Lighting>) {
    this.#set({ lighting: { ...this.#state.lighting, ...patch } });
  }

  /** Record where the 3D camera is, after a move or preset. */
  setCamera(pose: CameraPose) {
    const next = roundPose(pose);
    if (JSON.stringify(next) !== JSON.stringify(this.#state.camera)) this.#set({ camera: next });
  }

  // Project files -----------------------------------------------------------

  /** The project as it would be saved now. Held and unresolved sources keep the identity the project recorded. */
  toProjectFile(): ProjectFile {
    const s = this.#state;
    const loaded = new Set(s.sources.map((x) => x.id));
    const sources: ProjectSource[] = [
      ...s.sources.map((x): ProjectSource => {
        const r = s.relink[x.id];
        if (r?.status === "changed") return r.saved;
        return {
          id: x.id,
          name: x.name,
          size: x.size,
          sha256: valueOf(x.digest) ?? r?.saved.sha256 ?? "",
          pageCount: x.pageCount,
          pages: savedPages(valueOf(x.geometry)) ?? r?.saved.pages ?? null,
        };
      }),
      ...Object.entries(s.relink)
        .filter(([id]) => !loaded.has(id))
        .map(([, r]) => r.saved),
    ];
    const layerIds = new Set(s.model.layers.map((l) => l.id));
    const surfaceIds = new Set(s.model.surfaces.map((x) => x.id));
    const known = new Map(sources.map((x) => [x.id, x.pageCount]));
    const selectedOk = s.selected && (known.get(s.selected.sourceId) ?? 0) > s.selected.page;
    return {
      format: PROJECT_FORMAT,
      schemaVersion: SCHEMA_VERSION,
      app: { name: "Maskora", version: this.deps.appVersion ?? "dev" },
      savedAt: (this.deps.now?.() ?? new Date()).toISOString(),
      sources,
      model: s.model,
      overrides: s.overrides,
      view: {
        mode: s.view.mode,
        layout: s.view.layout,
        printOnly: s.view.printOnly,
        show: { ...s.view.show },
        raisedMode: s.view.raisedMode,
        hiddenLayers: s.view.hiddenLayers.filter((id) => layerIds.has(id)),
        surfaceId: s.view.surfaceId && surfaceIds.has(s.view.surfaceId) ? s.view.surfaceId : null,
        selectedLayer:
          s.view.selectedLayer && layerIds.has(s.view.selectedLayer) ? s.view.selectedLayer : null,
      },
      lighting: { ...s.lighting },
      camera: s.camera,
      selected: selectedOk ? { ...s.selected! } : null,
    };
  }

  /** Whether there is work a save would keep that is not in the project file. */
  isDirty(): boolean {
    const s = this.#state;
    if (s.file.savedKey === null) return s.sources.length > 0 || Object.keys(s.relink).length > 0;
    // A file in an older schema differs from what a save writes, even with no edits.
    if (s.file.migratedFrom !== null) return true;
    return contentKey(this.toProjectFile()) !== s.file.savedKey;
  }

  /** Why the project cannot be saved right now, or null. */
  saveProblem(): string | null {
    const s = this.#state;
    if (!this.deps.files) return "Saving is not available here.";
    if (this.restoring) return "Sources are still loading.";
    if (s.sources.some((x) => x.digest.status === "running" || x.geometry.status === "running"))
      return "Sources are still being read.";
    if (s.sources.some((x) => x.digest.status !== "available" && s.relink[x.id]?.status !== "changed"))
      return "A source's content could not be identified, so it cannot be recorded.";
    if (!s.sources.length && !Object.keys(s.relink).length) return "Add a PDF first.";
    return null;
  }

  /** Save to the project's file, or with `saveAs` (or when there is none yet) wherever the user chooses. */
  async save(saveAs = false) {
    const files = this.deps.files;
    const s = this.#state;
    if (!files || s.file.last.kind === "saving" || s.file.last.kind === "opening") return;
    const problem = this.saveProblem();
    if (problem) {
      this.#setFile({ last: { kind: "failed", what: "save", code: "notReady", message: problem } });
      return;
    }
    const project = this.toProjectFile();
    const suggested =
      s.file.name?.replace(/\.maskora\.json$/i, "").replace(/\.json$/i, "") ??
      s.sources[0]?.name.replace(/\.pdf$/i, "") ??
      "Untitled";
    this.#setFile({ last: { kind: "saving" } });
    let saved: Saved | null;
    try {
      saved = await files.save({
        json: JSON.stringify(toJson(project)),
        sources: s.sources.map((x) => ({ id: x.id, handle: this.#handles.get(x.id)! })),
        token: s.file.token,
        saveAs,
        suggestedName: suggested,
      });
    } catch (error) {
      // The previous file, if any, is untouched and the project stays unsaved.
      this.#setFile({ last: { kind: "failed", what: "save", ...codeOf(error, "writeFailed") } });
      return;
    }
    if (!saved) {
      this.#setFile({ last: { kind: "cancelled", what: "save" } });
      return;
    }
    this.#setFile({
      token: saved.token,
      name: saved.name,
      savedKey: contentKey(project),
      migratedFrom: null,
      last: { kind: "saved", name: saved.name, overwritten: saved.overwritten, backup: saved.backup },
    });
  }

  /** Close everything and start an empty project. */
  newProject() {
    this.#reset();
    this.#set({ ...INITIAL, recoveryOffer: this.#state.recoveryOffer });
  }

  #reset() {
    this.#loading += 1;
    this.#pending = null;
    this.#queue = [];
    for (const { session } of this.#sessions.values()) void session.close();
    this.#sessions.clear();
    this.#handles.clear();
    this.#boundary();
  }

  /** Open a project file chosen in a dialog, replacing this project. Nothing changes unless it is valid. */
  async openProject() {
    const files = this.deps.files;
    const last = this.#state.file.last.kind;
    if (!files || last === "saving" || last === "opening") return;
    this.#setFile({ last: { kind: "opening" } });
    let opened: Opened | null;
    try {
      opened = await files.open();
    } catch (error) {
      this.#setFile({ last: { kind: "failed", what: "open", ...codeOf(error, "projectUnreadable") } });
      return;
    }
    if (!opened) {
      this.#setFile({ last: { kind: "cancelled", what: "open" } });
      return;
    }
    let json: unknown;
    try {
      json = JSON.parse(opened.json);
    } catch {
      this.#setFile({
        last: {
          kind: "failed",
          what: "open",
          code: "invalidProject",
          message: "The project file is not valid JSON.",
        },
      });
      return;
    }
    const parsed = parseProjectFile(json);
    if (!parsed.ok) {
      this.#setFile({ last: { kind: "failed", what: "open", code: parsed.code, message: parsed.message } });
      return;
    }
    this.#restore(parsed.project, opened, {
      savedKey: contentKey(parsed.project),
      migratedFrom: parsed.migratedFrom,
      last: { kind: "opened", name: opened.name, migratedFrom: parsed.migratedFrom },
    });
  }

  #restore(
    project: ProjectFile,
    opened: { token: string | null; name: string | null; sources: SourceOnOpen[] },
    file: Pick<FileState, "savedKey" | "migratedFrom" | "last">,
  ) {
    this.#reset();
    const statuses = new Map<string, SourceOnOpen>(opened.sources.map((x) => [x.id, x]));
    const relink: Record<string, Relink> = {};
    const queue: LoadJob[] = [];
    for (const saved of project.sources) {
      const native = statuses.get(saved.id);
      if (native?.source && (native.status === "authorized" || native.status === "changed")) {
        relink[saved.id] = { saved, status: "loading" };
        queue.push({
          info: native.source,
          id: saved.id,
          outcome: native.status === "changed" ? { status: "changed" } : { status: "ok" },
        });
      } else if (native?.status === "needsApproval")
        relink[saved.id] = { saved, status: "needsApproval", reason: native.reason ?? "unfamiliar" };
      else relink[saved.id] = { saved, status: "missing" };
    }
    this.#set({
      ...INITIAL,
      model: project.model,
      overrides: project.overrides,
      view: { ...INITIAL.view, ...project.view },
      lighting: project.lighting,
      camera: project.camera,
      cameraRestore: this.#state.cameraRestore + 1,
      selected: project.selected,
      relink,
      recoveryOffer: this.#state.recoveryOffer,
      file: { token: opened.token, name: opened.name, ...file },
    });
    // Restoring is not an edit: there is nothing before it to undo.
    this.#boundary();
    this.#queue = queue;
    void this.#next();
  }

  /** Once nothing is loading, sources that simply came back leave no relink entry behind. */
  #settleRelinks() {
    if (this.restoring) return;
    const relink = Object.fromEntries(
      Object.entries(this.#state.relink).filter(([, r]) => !(r.status === "ok" && !r.note)),
    );
    this.#set({ relink });
  }

  /**
   * Ask the user to locate or approve a reopened source (or, for a changed one,
   * choose another file). Content equal to what the project saved comes back
   * normally; different content is held.
   */
  async locateSource(id: string) {
    const files = this.deps.files;
    const r = this.#state.relink[id];
    if (!files || !r || r.status === "loading" || r.status === "ok" || this.restoring) return;
    let located: Located | null;
    try {
      located = await files.locate(r.saved.ref?.fileName ?? r.saved.name, this.#state.file.token);
    } catch (error) {
      this.#setFile({ last: { kind: "failed", what: "locate", ...codeOf(error, "sourceUnreadable") } });
      return;
    }
    if (!located) {
      this.#setFile({ last: { kind: "cancelled", what: "locate" } });
      return;
    }
    const same = located.sha256 === r.saved.sha256;
    if (this.#sessions.has(id)) this.#unload(id);
    this.#setRelink(id, { saved: r.saved, status: "loading" });
    this.#queue.push({
      info: located.source,
      id,
      outcome: same
        ? { status: "ok", note: r.status === "missing" ? "moved" : "approved" }
        : { status: "changed" },
    });
    await this.#next();
  }

  /**
   * Keep a changed source's assignments for its new content. Refused when the
   * new file lacks a page the project assigns.
   */
  keepChanged(id: string) {
    const r = this.#state.relink[id];
    const source = this.source(id);
    if (!r || r.status !== "changed" || !source) return false;
    const s = this.#state;
    const pages = [
      ...Object.keys(s.model.roles),
      ...Object.keys(s.overrides),
      ...s.model.surfaces.map((x) => M.pageKey(x.artwork)),
      ...s.model.layers.flatMap((l) => (l.mask.kind === "pdfPage" ? [M.pageKey(l.mask)] : [])),
    ]
      .filter((k) => k.startsWith(`${id}:`))
      .map((k) => Number(k.slice(id.length + 1)));
    const highest = Math.max(-1, ...pages);
    if (highest >= source.pageCount) {
      this.#set({
        lastRefusal: {
          code: "pagesMissing",
          message: `${source.name} now has ${source.pageCount} page${source.pageCount === 1 ? "" : "s"}, but the project assigns page ${highest + 1}. Choose another file or remove the source.`,
        },
      });
      return false;
    }
    this.#boundary();
    this.#setRelink(id, { saved: r.saved, status: "ok", note: "kept" });
    this.#set({ lastRefusal: null });
    return true;
  }

  /** The pages a held source's assignments use, with what is on each and a suggested new page. */
  reconcilePlan(id: string): ReconcileRow[] | null {
    const r = this.#state.relink[id];
    const source = this.source(id);
    if (!r || r.status !== "changed" || !source) return null;
    const s = this.#state;
    const prefix = `${id}:`;
    const overrideKeys = Object.keys(s.overrides).filter((k) => k.startsWith(prefix));
    return M.usedPages(s.model, id, overrideKeys).map((page) => {
      const saved = r.saved.pages?.[page];
      const k = saved ? mmPerUnit(saved.userUnit) : 0;
      return {
        page,
        role: M.roleOf(s.model, { sourceId: id, page }),
        surfaceId: M.surfaceFor(s.model, { sourceId: id, page })?.id ?? null,
        layerIds: s.model.layers
          .filter((l) => l.mask.kind === "pdfPage" && l.mask.sourceId === id && l.mask.page === page)
          .map((l) => l.id),
        hasOverride: `${prefix}${page}` in s.overrides,
        savedSizeMm: saved
          ? [(saved.trimBox[2] - saved.trimBox[0]) * k, (saved.trimBox[3] - saved.trimBox[1]) * k]
          : null,
        suggested: page < source.pageCount ? page : null,
      };
    });
  }

  /**
   * Move a held source's assignments page by page and release it. `mapping`
   * gives each used page's new page, or null to drop it; box overrides are
   * carried only for the pages in `keepOverrides`, marked as carried over.
   * Returns what was dropped, or false if refused.
   */
  reconcile(id: string, mapping: Record<number, number | null>, keepOverrides: number[] = []) {
    const r = this.#state.relink[id];
    const source = this.source(id);
    if (!r || r.status !== "changed" || !source) return false;
    const s = this.#state;
    const map = (p: number) => mapping[p] ?? null;
    const out = M.remapSource(s.model, id, map, source.pageCount);
    if (!out.ok) {
      this.#set({ lastRefusal: { code: out.code, message: out.message } });
      return false;
    }
    const prefix = `${id}:`;
    const overrides: Record<string, PageOverride> = {};
    for (const [key, o] of Object.entries(s.overrides)) {
      if (!key.startsWith(prefix)) {
        overrides[key] = o;
        continue;
      }
      const page = Number(key.slice(prefix.length));
      const to = map(page);
      if (to === null || !keepOverrides.includes(page)) continue;
      const carry = (b?: { rect: Rect; derivation: string }) =>
        b && {
          rect: b.rect,
          derivation: `${b.derivation} (carried over from the earlier file's page ${page + 1})`,
        };
      overrides[`${prefix}${to}`] = {
        ...(o.trim ? { trim: carry(o.trim) } : {}),
        ...(o.bleed ? { bleed: carry(o.bleed) } : {}),
      };
    }
    const removed = new Set(out.effects.removedLayers);
    const sel = s.selected?.sourceId === id ? map(s.selected.page) : undefined;
    this.#boundary();
    this.#replaying = true;
    try {
      this.#set({
        model: out.model,
        overrides,
        lastRefusal: null,
        selected: sel === undefined ? s.selected : sel === null ? null : { sourceId: id, page: sel },
        view: {
          ...s.view,
          hiddenLayers: s.view.hiddenLayers.filter((l) => !removed.has(l)),
          selectedLayer:
            s.view.selectedLayer && removed.has(s.view.selectedLayer) ? null : s.view.selectedLayer,
        },
      });
    } finally {
      this.#replaying = false;
    }
    this.#setRelink(id, { saved: r.saved, status: "ok", note: "reconciled" });
    return out.effects;
  }

  // Recovery ----------------------------------------------------------------

  /** After every change: keep a snapshot of unsaved work, or forget ours once there is none. */
  #scheduleRecovery() {
    const recovery = this.deps.files?.recovery;
    if (!recovery) return;
    if (this.#recoveryTimer) clearTimeout(this.#recoveryTimer);
    this.#recoveryTimer = setTimeout(() => {
      this.#recoveryTimer = null;
      void this.#snapshot();
    }, this.deps.recoveryDelayMs ?? 2000);
  }

  async #snapshot() {
    const recovery = this.deps.files?.recovery;
    const s = this.#state;
    // An earlier session's work is never overwritten before the user has decided about it.
    if (!recovery || s.recoveryOffer || this.restoring) return;
    if (!this.isDirty()) {
      if (this.#recoveryWritten) {
        this.#recoveryWritten = false;
        await recovery.discard().catch(() => undefined);
      }
      return;
    }
    const loaded = s.sources.filter((x) => x.digest.status === "available" && this.#handles.has(x.id));
    const meta = JSON.stringify({
      name: s.file.name,
      savedKey: s.file.savedKey,
      migratedFrom: s.file.migratedFrom,
    });
    try {
      await recovery.save({
        json: JSON.stringify(toJson(this.toProjectFile())),
        meta,
        sources: loaded.map((x) => ({
          id: x.id,
          handle: this.#handles.get(x.id)!,
          sha256: valueOf(x.digest)!,
        })),
        token: s.file.token,
      });
      this.#recoveryWritten = true;
    } catch {
      // Not kept this time; the next change tries again.
    }
  }

  /** On start: is there unsaved work from an earlier session? */
  async checkRecovery() {
    const recovery = this.deps.files?.recovery;
    if (!recovery) return;
    const pending = await recovery.peek().catch(() => null);
    if (!pending) return;
    let name: string | null = null;
    try {
      name = (JSON.parse(pending.meta) as { name?: string | null }).name ?? null;
    } catch {
      /* an unreadable note still offers the work */
    }
    this.#set({ recoveryOffer: { savedUnix: pending.savedUnix, name } });
  }

  /** Bring back the earlier session's unsaved work; it stays unsaved until saved. */
  async recover() {
    const recovery = this.deps.files?.recovery;
    if (!recovery || !this.#state.recoveryOffer) return false;
    const got = await recovery.recover().catch(() => null);
    const parsed = got ? parseProjectFile(safeJson(got.json)) : null;
    if (!got || !parsed?.ok) {
      this.#set({ recoveryOffer: null });
      this.#setFile({
        last: {
          kind: "failed",
          what: "open",
          code: "recoveryFailed",
          message: "The unsaved work could not be read back.",
        },
      });
      return false;
    }
    let meta: { name?: string | null; savedKey?: string | null; migratedFrom?: number | null } = {};
    try {
      meta = JSON.parse(got.meta);
    } catch {
      /* treated as never saved */
    }
    this.#state = { ...this.#state, recoveryOffer: null };
    this.#restore(
      parsed.project,
      { token: got.token, name: got.token ? (got.name ?? meta.name ?? null) : null, sources: got.sources },
      {
        // Compared with the file it came from, if that still exists: the work is unsaved until saved.
        savedKey: got.token ? (meta.savedKey ?? null) : null,
        migratedFrom: got.token ? (meta.migratedFrom ?? null) : null,
        last: { kind: "recovered", name: meta.name ?? null },
      },
    );
    this.#recoveryWritten = true;
    return true;
  }

  async discardRecovery() {
    const recovery = this.deps.files?.recovery;
    if (!recovery || !this.#state.recoveryOffer) return;
    await recovery.discard().catch(() => undefined);
    this.#set({ recoveryOffer: null });
  }

  dispose() {
    this.#reset();
    if (this.#recoveryTimer) clearTimeout(this.#recoveryTimer);
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function codeOf(error: unknown, fallback: string): { code: string; message: string } {
  const e = error as { code?: unknown; message?: unknown };
  return {
    code: typeof e?.code === "string" ? e.code : fallback,
    message: typeof e?.message === "string" ? e.message : "The operation did not complete.",
  };
}
