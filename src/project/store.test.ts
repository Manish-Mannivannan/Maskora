import { describe, expect, it, vi } from "vitest";
import type { PdfSession } from "@/pdf/adapter";
import type { GeometryReport, SourceInfo } from "@/native/sources";
import { ProjectStore, type ProjectDeps } from "./store";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const info = (name: string): SourceInfo => ({ handle: `h-${name}`, name, size: 100 });

function session(pages: number): PdfSession & { close: ReturnType<typeof vi.fn> } {
  return {
    engine: "PDF.js test",
    pageCount: pages,
    pages: async () =>
      Array.from({ length: pages }, (_, index) => ({
        index,
        view: [0, 0, 100, 100],
        rotate: 0,
        userUnit: 1,
      })),
    labels: async () => null,
    metadata: async () => ({
      fields: [],
      pdfVersion: "1.7",
      encryption: null,
      linearized: false,
      xmp: "absent",
      permissions: null,
    }),
    optionalContent: async () => ({ groups: 0, printDiffers: [] }),
    render: async () => {
      throw new Error("not used");
    },
    close: vi.fn(async () => undefined),
  };
}

const report = (pages: number, engine = "native"): GeometryReport => ({
  engine,
  sha256: "digest",
  pages: Array.from({ length: pages }, (_, index) => ({
    index,
    rotate: { raw: null, effective: 0, origin: "default" },
    userUnit: 1,
    boxes: [["MediaBox", { raw: [0, 0, 100, 100], effective: [0, 0, 100, 100], origin: "explicit" }]],
  })),
});

/** Deps whose every call is answered by the test, call by call. */
function scriptedDeps() {
  const selections: SourceInfo[] = [];
  const geometry: ReturnType<typeof deferred<GeometryReport>>[] = [];
  const pdf: ReturnType<typeof deferred<PdfSession>>[] = [];
  const passwords: (string | undefined)[] = [];
  let ids = 0;
  const deps: ProjectDeps = {
    selectSource: async () => selections.shift() ?? null,
    readSource: async (handle) => new TextEncoder().encode(handle),
    digest: async () => "digest",
    inspectGeometry: (_handle, password) => {
      passwords.push(password);
      const d = deferred<GeometryReport>();
      geometry.push(d);
      return d.promise;
    },
    openPdf: () => {
      const d = deferred<PdfSession>();
      pdf.push(d);
      return d.promise;
    },
    newId: () => `id${(ids += 1)}`,
  };
  return { deps, selections, geometry, pdf, passwords };
}

/** Add one source whose PDF.js open succeeds with `pages` pages. */
async function add(store: ProjectStore, s: ReturnType<typeof scriptedDeps>, name: string, pages = 1) {
  s.selections.push(info(name));
  const adding = store.addSource();
  await flush();
  s.pdf.at(-1)!.resolve(session(pages));
  await adding;
  await flush();
  return store.getState().sources.at(-1)!;
}

describe("project store", () => {
  it("adds sources and fills their facts as each reader finishes", async () => {
    const s = scriptedDeps();
    const store = new ProjectStore(s.deps, "p1");
    const a = await add(store, s, "art.pdf", 2);
    expect(store.getState().load).toEqual({ kind: "added", name: "art.pdf" });
    expect(a).toMatchObject({
      name: "art.pdf",
      pageCount: 2,
      labels: { status: "absent" },
      metadata: { status: "notRequested" },
    });
    expect(a.geometry.status).toBe("running");
    s.geometry[0].resolve(report(2));
    await flush();
    expect(store.source(a.id)!.geometry).toMatchObject({
      status: "available",
      provenance: { engine: "native", sourceRevision: a.revision },
    });
    const b = await add(store, s, "masks.pdf", 4);
    expect(store.getState().sources.map((x) => x.name)).toEqual(["art.pdf", "masks.pdf"]);
    expect(store.getState().selected).toEqual({ sourceId: b.id, page: 0 });
  });

  it("drops a late native result for a removed source, even when the same file is added again (delayed-job switch)", async () => {
    const s = scriptedDeps();
    const store = new ProjectStore(s.deps, "p1");
    const first = await add(store, s, "a.pdf");
    store.removeSource(first.id);
    const again = await add(store, s, "a.pdf");
    s.geometry[0].resolve(report(1, "late, for the removed copy"));
    await flush();
    expect(store.getState().sources).toHaveLength(1);
    expect(store.source(again.id)!.geometry.status).toBe("running");
    s.geometry[1].resolve(report(1, "current"));
    await flush();
    expect(store.source(again.id)!.geometry).toMatchObject({
      status: "available",
      value: { engine: "current" },
    });
    expect(again.revision).not.toBe(first.revision);
  });

  it("a second choice supersedes a file still loading; the first is closed, never added", async () => {
    const s = scriptedDeps();
    const store = new ProjectStore(s.deps, "p1");
    s.selections.push(info("a.pdf"), info("b.pdf"));
    const a = store.addSource();
    await flush();
    const b = store.addSource();
    await flush();
    s.pdf[1].resolve(session(2));
    await b;
    const lateA = session(9);
    s.pdf[0].resolve(lateA);
    await a;
    expect(lateA.close).toHaveBeenCalled();
    expect(store.getState().sources.map((x) => x.name)).toEqual(["b.pdf"]);
  });

  it("a cancelled load shows as cancelled and its late result is discarded", async () => {
    const s = scriptedDeps();
    const store = new ProjectStore(s.deps, "p1");
    s.selections.push(info("a.pdf"));
    const a = store.addSource();
    await flush();
    store.cancelLoad();
    expect(store.getState().load).toEqual({ kind: "cancelled" });
    const late = session(1);
    s.pdf[0].resolve(late);
    await a;
    expect(late.close).toHaveBeenCalled();
    expect(store.getState().sources).toEqual([]);
  });

  it("removing a source closes its PDF.js document and ignores its late facts", async () => {
    const s = scriptedDeps();
    const store = new ProjectStore(s.deps, "p1");
    s.selections.push(info("a.pdf"));
    const adding = store.addSource();
    await flush();
    const opened = session(1);
    s.pdf[0].resolve(opened);
    await adding;
    const a = store.getState().sources[0];
    store.removeSource(a.id);
    expect(opened.close).toHaveBeenCalled();
    expect(store.session(a.id, a.revision)).toBeNull();
    s.geometry[0].resolve(report(1));
    await flush();
    expect(store.getState().sources).toEqual([]);
  });

  it("keeps two project instances independent", async () => {
    const s1 = scriptedDeps();
    const s2 = scriptedDeps();
    const one = new ProjectStore(s1.deps, "p1");
    const two = new ProjectStore(s2.deps, "p2");
    const a = await add(one, s1, "a.pdf", 1);
    const b = await add(two, s2, "b.pdf", 2);
    two.selectPage({ sourceId: b.id, page: 1 });
    expect([one.getState().sources[0].name, two.getState().sources[0].name]).toEqual(["a.pdf", "b.pdf"]);
    expect(one.getState().selected).toEqual({ sourceId: a.id, page: 0 });
    expect(two.getState().selected).toEqual({ sourceId: b.id, page: 1 });
    expect(one.id).not.toBe(two.id);
  });

  it("asks for a password, tells needed from wrong, and keeps it out of the state", async () => {
    const s = scriptedDeps();
    const store = new ProjectStore(s.deps, "p1");
    s.selections.push(info("e.pdf"));
    const open = store.addSource();
    await flush();
    s.pdf[0].reject({ code: "passwordNeeded", message: "This document needs a password to open." });
    await open;
    expect(store.getState().load).toMatchObject({ kind: "password", attempt: "needed" });

    const wrong = store.submitPassword("wrong-secret");
    await flush();
    s.pdf[1].reject({ code: "passwordWrong", message: "The password is not correct." });
    await wrong;
    expect(store.getState().load).toMatchObject({ kind: "password", attempt: "wrong" });

    const right = store.submitPassword("right-secret");
    await flush();
    s.pdf[2].resolve(session(1));
    await right;
    expect(store.getState().load.kind).toBe("added");
    expect(s.passwords).toEqual([undefined, "wrong-secret", "right-secret"]);
    expect(JSON.stringify(store.getState())).not.toMatch(/secret/);
  });

  it("a cancelled dialog keeps the project; a read failure is named", async () => {
    const s = scriptedDeps();
    const store = new ProjectStore(s.deps, "p1");
    await add(store, s, "a.pdf");
    await store.addSource(); // no selection queued: cancelled
    expect(store.getState().load).toEqual({ kind: "cancelled" });
    expect(store.getState().sources.map((x) => x.name)).toEqual(["a.pdf"]);

    const failing = new ProjectStore(
      {
        ...s.deps,
        selectSource: async () => info("x.pdf"),
        readSource: () => Promise.reject({ code: "sourceMissing", message: "gone" }),
      },
      "p2",
    );
    await failing.addSource();
    expect(failing.getState().load).toMatchObject({ kind: "failed", code: "sourceMissing" });
  });

  it("reads document information only when asked", async () => {
    const s = scriptedDeps();
    const store = new ProjectStore(s.deps, "p1");
    const a = await add(store, s, "a.pdf");
    expect(store.source(a.id)!.metadata.status).toBe("notRequested");
    store.requestMetadata(a.id);
    expect(store.source(a.id)!.metadata.status).toBe("running");
    await flush();
    expect(store.source(a.id)!.metadata.status).toBe("available");
  });

  it("maps pages across two files, refuses an invalid target, and forgets a removed source's intent", async () => {
    const s = scriptedDeps();
    const store = new ProjectStore(s.deps, "p1");
    const art = await add(store, s, "art.pdf", 1);
    const masks = await add(store, s, "masks.pdf", 2);
    store.setRole({ sourceId: art.id, page: 0 }, "print");
    store.setRole({ sourceId: masks.id, page: 1 }, "mask");
    const { surfaces, layers } = store.getState().model;
    expect(store.assignTarget(layers[0].id, "not-a-surface")).toBe(false);
    expect(store.getState().lastRefusal?.code).toBe("unknownSurface");
    expect(store.assignTarget(layers[0].id, surfaces[0].id)).toBe(true);
    expect(store.getState().lastRefusal).toBeNull();
    expect(store.getState().model.layers[0]).toMatchObject({
      mask: { kind: "pdfPage", sourceId: masks.id, page: 1 },
      target: surfaces[0].id,
    });
    store.setOverride([{ sourceId: art.id, page: 0 }], { trim: { rect: [1, 1, 9, 9], derivation: "test" } });
    store.removeSource(art.id);
    const after = store.getState();
    expect(after.model.surfaces).toEqual([]);
    expect(after.model.layers[0].target).toBeNull();
    expect(after.overrides).toEqual({});
  });
});
