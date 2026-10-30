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

/** Deps whose every call is answered by the test, in order. */
function scriptedDeps() {
  const selections: SourceInfo[] = [];
  const geometry = new Map<string, ReturnType<typeof deferred<GeometryReport>>>();
  const pdf = new Map<string, ReturnType<typeof deferred<PdfSession>>>();
  const passwords: (string | undefined)[] = [];
  const deps: ProjectDeps = {
    selectSource: async () => selections.shift() ?? null,
    readSource: async (handle) => new TextEncoder().encode(handle),
    digest: async () => "digest",
    inspectGeometry: (handle, password) => {
      passwords.push(password);
      const d = deferred<GeometryReport>();
      geometry.set(handle, d);
      return d.promise;
    },
    openPdf: (bytes) => {
      const d = deferred<PdfSession>();
      pdf.set(new TextDecoder().decode(bytes), d);
      return d.promise;
    },
  };
  return { deps, selections, geometry, pdf, passwords };
}

describe("project store", () => {
  it("opens a source and fills its facts as each reader finishes", async () => {
    const s = scriptedDeps();
    const store = new ProjectStore(s.deps, "p1");
    s.selections.push(info("a.pdf"));
    const opening = store.open();
    await flush();
    expect(store.getState().load).toMatchObject({ kind: "loading", name: "a.pdf", step: "parsing" });
    s.pdf.get("h-a.pdf")!.resolve(session(2));
    await opening;
    await flush();
    const source = store.getState().source!;
    expect(store.getState().load.kind).toBe("ready");
    expect(source.pageCount).toBe(2);
    expect(source.geometry.status).toBe("running");
    expect(source.labels.status).toBe("absent");
    expect(source.metadata.status).toBe("notRequested");
    s.geometry.get("h-a.pdf")!.resolve(report(2));
    await flush();
    expect(store.getState().source!.geometry).toMatchObject({
      status: "available",
      provenance: { engine: "native", sourceRevision: source.revision },
    });
    expect(store.getState().source!.diagnostics).toEqual([]);
  });

  it("drops a late native result for a replaced source (delayed-job source switch)", async () => {
    const s = scriptedDeps();
    const store = new ProjectStore(s.deps, "p1");
    s.selections.push(info("a.pdf"), info("b.pdf"));
    const a = store.open();
    await flush();
    s.pdf.get("h-a.pdf")!.resolve(session(1));
    await a;
    const b = store.open();
    await flush();
    s.pdf.get("h-b.pdf")!.resolve(session(3));
    await b;
    s.geometry.get("h-a.pdf")!.resolve(report(1, "late A"));
    await flush();
    const source = store.getState().source!;
    expect(source.name).toBe("b.pdf");
    expect(source.geometry.status).toBe("running");
    s.geometry.get("h-b.pdf")!.resolve(report(3, "B"));
    await flush();
    expect(store.getState().source!.geometry).toMatchObject({ status: "available", value: { engine: "B" } });
  });

  it("closes, and never shows, a PDF.js document that finishes after its source was replaced", async () => {
    const s = scriptedDeps();
    const store = new ProjectStore(s.deps, "p1");
    s.selections.push(info("a.pdf"), info("b.pdf"));
    const a = store.open();
    await flush();
    expect(store.getState().load).toMatchObject({ kind: "loading", name: "a.pdf" });
    const b = store.open(); // replaces a.pdf while it is still loading
    await flush();
    s.pdf.get("h-b.pdf")!.resolve(session(2));
    await b;
    const lateA = session(9);
    s.pdf.get("h-a.pdf")!.resolve(lateA);
    await a;
    expect(lateA.close).toHaveBeenCalled();
    expect(store.getState().source).toMatchObject({ name: "b.pdf", pageCount: 2 });
  });

  it("a cancelled load shows as cancelled and its late result is discarded", async () => {
    const s = scriptedDeps();
    const store = new ProjectStore(s.deps, "p1");
    s.selections.push(info("a.pdf"));
    const a = store.open();
    await flush();
    store.cancelLoad();
    expect(store.getState().load).toEqual({ kind: "cancelled", kept: false });
    const late = session(1);
    s.pdf.get("h-a.pdf")!.resolve(late);
    await a;
    expect(late.close).toHaveBeenCalled();
    expect(store.getState().source).toBeNull();
  });

  it("keeps two project instances independent", async () => {
    const s1 = scriptedDeps();
    const s2 = scriptedDeps();
    const one = new ProjectStore(s1.deps, "p1");
    const two = new ProjectStore(s2.deps, "p2");
    s1.selections.push(info("a.pdf"));
    s2.selections.push(info("b.pdf"));
    const o1 = one.open();
    const o2 = two.open();
    await flush();
    s1.pdf.get("h-a.pdf")!.resolve(session(1));
    s2.pdf.get("h-b.pdf")!.resolve(session(2));
    await Promise.all([o1, o2]);
    one.selectPage(0);
    two.selectPage(1);
    expect([one.getState().source!.name, two.getState().source!.name]).toEqual(["a.pdf", "b.pdf"]);
    expect([one.getState().selectedPage, two.getState().selectedPage]).toEqual([0, 1]);
    expect(one.id).not.toBe(two.id);
  });

  it("asks for a password, tells needed from wrong, and keeps it out of the state", async () => {
    const s = scriptedDeps();
    const store = new ProjectStore(s.deps, "p1");
    s.selections.push(info("e.pdf"));
    const open = store.open();
    await flush();
    s.pdf
      .get("h-e.pdf")!
      .reject({ code: "passwordNeeded", message: "This document needs a password to open." });
    await open;
    expect(store.getState().load).toMatchObject({ kind: "password", attempt: "needed" });

    const wrong = store.submitPassword("wrong-secret");
    await flush();
    s.pdf.get("h-e.pdf")!.reject({ code: "passwordWrong", message: "The password is not correct." });
    await wrong;
    expect(store.getState().load).toMatchObject({ kind: "password", attempt: "wrong" });

    const right = store.submitPassword("right-secret");
    await flush();
    s.pdf.get("h-e.pdf")!.resolve(session(1));
    await right;
    expect(store.getState().load.kind).toBe("ready");
    expect(s.passwords).toEqual([undefined, "wrong-secret", "right-secret"]);
    expect(JSON.stringify(store.getState())).not.toMatch(/secret/);
  });

  it("a cancelled dialog keeps the open document; a read failure is named", async () => {
    const s = scriptedDeps();
    const store = new ProjectStore(s.deps, "p1");
    s.selections.push(info("a.pdf"));
    const a = store.open();
    await flush();
    s.pdf.get("h-a.pdf")!.resolve(session(1));
    await a;
    await store.open(); // no selection queued: cancelled
    expect(store.getState().load).toEqual({ kind: "cancelled", kept: true });
    expect(store.getState().source?.name).toBe("a.pdf");

    const failing = new ProjectStore(
      {
        ...s.deps,
        selectSource: async () => info("x.pdf"),
        readSource: () => Promise.reject({ code: "sourceMissing", message: "gone" }),
      },
      "p2",
    );
    await failing.open();
    expect(failing.getState().load).toMatchObject({ kind: "failed", code: "sourceMissing" });
  });

  it("reads document information only when asked", async () => {
    const s = scriptedDeps();
    const store = new ProjectStore(s.deps, "p1");
    s.selections.push(info("a.pdf"));
    const a = store.open();
    await flush();
    s.pdf.get("h-a.pdf")!.resolve(session(1));
    await a;
    expect(store.getState().source!.metadata.status).toBe("notRequested");
    store.requestMetadata();
    expect(store.getState().source!.metadata.status).toBe("running");
    await flush();
    expect(store.getState().source!.metadata.status).toBe("available");
  });

  it("sets and clears overrides per page", () => {
    const store = new ProjectStore(scriptedDeps().deps, "p1");
    store.setOverride([0, 1], { trim: { rect: [1, 1, 9, 9], derivation: "test" } });
    store.setOverride([1], { trim: undefined });
    expect(Object.keys(store.getState().overrides)).toEqual(["0"]);
  });
});
