/**
 * One open project's document state (architecture §4.5, §7.1).
 *
 * A store is a project instance, never a global: everything it holds and
 * every job it starts belongs to it, so a later tabbed workspace can hold
 * several without a rewrite. Each opened source gets a new revision, and
 * every asynchronous result is checked against the current revision before
 * it is applied; a late result for a replaced source is dropped (and a late
 * PDF.js document closed), never shown. The native geometry reader cannot be
 * interrupted, so its stale results are discarded the same way.
 *
 * A password is passed to both readers for one attempt and not kept: it is
 * never part of the state snapshot, a log or an error.
 */
import type { PdfSession } from "@/pdf/adapter";
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
import type { DocMetadata, OptionalContentSummary, PdfPageFacts } from "@/pdf/adapter";

export interface ProjectDeps {
  selectSource(): Promise<SourceInfo | null>;
  readSource(handle: string): Promise<Uint8Array>;
  inspectGeometry(handle: string, password?: string): Promise<GeometryReport>;
  /** SHA-256 hex of the bytes PDF.js will parse. */
  digest(bytes: Uint8Array): Promise<string>;
  /** Rejects with a PdfOpenError. */
  openPdf(bytes: Uint8Array, password?: string): Promise<PdfSession>;
}

export type LoadState =
  | { kind: "idle" }
  | { kind: "selecting" }
  | { kind: "cancelled"; kept: boolean }
  | { kind: "loading"; name: string; step: "reading" | "parsing" }
  | { kind: "password"; name: string; attempt: "needed" | "wrong" }
  | { kind: "failed"; name?: string; code: string; message: string }
  | { kind: "ready" };

export interface SourceView {
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
  load: LoadState;
  source: SourceView | null;
  selectedPage: number;
  /** Manual trim/bleed per page index of the current source revision. */
  overrides: Record<number, PageOverride>;
}

const INITIAL: ProjectState = { load: { kind: "idle" }, source: null, selectedPage: 0, overrides: {} };

export class ProjectStore {
  readonly id: string;
  #state: ProjectState = INITIAL;
  #listeners = new Set<() => void>();
  #revision = 0;
  #session: PdfSession | null = null;
  /** Kept only while a password is being asked for. */
  #pending: { info: SourceInfo; bytes: Uint8Array } | null = null;

  constructor(
    private readonly deps: ProjectDeps,
    id: string = globalThis.crypto.randomUUID(),
  ) {
    this.id = id;
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

  /** Apply `patch` to the source only if it is still revision `rev`. */
  #patchSource(rev: number, patch: Partial<SourceView>) {
    const source = this.#state.source;
    if (!source || source.revision !== rev) return;
    const next = { ...source, ...patch };
    next.diagnostics = diagnose({
      pdfPages: valueOf(next.pages),
      pageCount: next.pageCount,
      native: valueOf(next.geometry),
      digest: valueOf(next.digest),
      optionalContent: valueOf(next.optionalContent),
    });
    this.#set({ source: next });
  }

  isCurrent = (rev: number) => rev === this.#revision;

  /** The PDF.js session of revision `rev`, or null once that source is replaced. */
  session(rev: number): PdfSession | null {
    return this.isCurrent(rev) && this.#state.source?.revision === rev ? this.#session : null;
  }

  async open() {
    // A new selection may replace a file that is still loading; that load becomes stale.
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
      this.#set({ load: { kind: "cancelled", kept: this.#state.source !== null } });
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

  /** Stop opening the current file; anything it still produces is discarded. */
  cancelLoad() {
    if (this.#state.load.kind !== "loading") return;
    this.#revision += 1;
    this.#set({ load: { kind: "cancelled", kept: false }, source: null });
  }

  cancelPassword() {
    if (this.#state.load.kind !== "password") return;
    this.#pending = null;
    this.#revision += 1;
    this.#set({ load: { kind: "cancelled", kept: false } });
  }

  async #begin(info: SourceInfo, password?: string, knownBytes?: Uint8Array) {
    const rev = ++this.#revision;
    const old = this.#session;
    this.#session = null;
    this.#set({
      load: { kind: "loading", name: info.name, step: "reading" },
      source: null,
      selectedPage: 0,
      overrides: {},
    });
    void old?.close();

    let bytes: Uint8Array;
    try {
      bytes = knownBytes ?? (await this.deps.readSource(info.handle));
    } catch (error) {
      if (this.isCurrent(rev))
        this.#set({ load: { kind: "failed", name: info.name, ...codeOf(error, "sourceUnreadable") } });
      return;
    }
    if (!this.isCurrent(rev)) return;
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
      if (!this.isCurrent(rev)) return;
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
    if (!this.isCurrent(rev)) {
      void session.close();
      return;
    }
    this.#session = session;
    this.#pending = null;

    const pdfjs: Provenance = { engine: session.engine, sourceRevision: rev };
    this.#set({
      load: { kind: "ready" },
      source: {
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
    });

    const track = <T>(key: keyof SourceView, job: Promise<Capability<T>>) =>
      job.then(
        (cap) => this.#patchSource(rev, { [key]: cap }),
        (error) => this.#patchSource(rev, { [key]: failed(error) }),
      );
    void track(
      "digest",
      digest.then((d) => available(d, { engine: "Web Crypto SHA-256", sourceRevision: rev })),
    );
    void track(
      "geometry",
      geometry.then((report) => available(report, { engine: report.engine, sourceRevision: rev })),
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

  /** Document information is read only when someone asks for it. */
  requestMetadata() {
    const source = this.#state.source;
    const session = source && this.session(source.revision);
    if (!source || !session || source.metadata.status !== "notRequested") return;
    const rev = source.revision;
    this.#patchSource(rev, { metadata: running });
    session.metadata().then(
      (m) =>
        this.#patchSource(rev, { metadata: available(m, { engine: session.engine, sourceRevision: rev }) }),
      (error) => this.#patchSource(rev, { metadata: failed(error) }),
    );
  }

  selectPage(index: number) {
    const count = this.#state.source?.pageCount ?? 0;
    if (index >= 0 && index < count) this.#set({ selectedPage: index });
  }

  /** Set (or with `undefined`, clear) a manual trim/bleed for the given pages. */
  setOverride(pages: number[], patch: Partial<PageOverride>) {
    const overrides = { ...this.#state.overrides };
    for (const page of pages) {
      const next: PageOverride = { ...overrides[page], ...patch };
      for (const key of Object.keys(next) as (keyof PageOverride)[]) if (!next[key]) delete next[key];
      if (Object.keys(next).length) overrides[page] = next;
      else delete overrides[page];
    }
    this.#set({ overrides });
  }

  dispose() {
    this.#revision += 1;
    this.#pending = null;
    void this.#session?.close();
    this.#session = null;
  }
}

function codeOf(error: unknown, fallback: string): { code: string; message: string } {
  const e = error as { code?: unknown; message?: unknown };
  return {
    code: typeof e?.code === "string" ? e.code : fallback,
    message: typeof e?.message === "string" ? e.message : "The operation did not complete.",
  };
}
