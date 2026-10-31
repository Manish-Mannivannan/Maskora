import { describe, expect, it, vi } from "vitest";
import type { Located, Opened, SaveRequest, Saved, SourceOnOpen } from "@/native/project";
import type { GeometryReport, SourceInfo } from "@/native/sources";
import type { PdfSession } from "@/pdf/adapter";
import { parseProjectFile } from "./projectFile";
import { ProjectStore, blockedSources, contentKey, type ProjectDeps } from "./store";

const flush = async (n = 6) => {
  for (let i = 0; i < n; i += 1) await new Promise((r) => setTimeout(r, 0));
};
const sha = (c: string) => c.repeat(64);

/** A file on "disk": what selecting or locating it hands back, its pages and digest. */
interface Disk {
  handle: string;
  name: string;
  pages: number;
  sha256: string;
}

function session(pages: number): PdfSession {
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

const report = (pages: number): GeometryReport => ({
  engine: "native",
  sha256: "x",
  pages: Array.from({ length: pages }, (_, index) => ({
    index,
    rotate: { raw: null, effective: 0, origin: "default" },
    userUnit: 1,
    boxes: [["MediaBox", { raw: [0, 0, 100, 100], effective: [0, 0, 100, 100], origin: "explicit" }]],
  })),
});

/** Deps whose files open at once; native file commands are scripted per test. */
function deps(disk: Disk[]) {
  const byHandle = new Map(disk.map((d) => [d.handle, d]));
  const info = (d: Disk): SourceInfo => ({ handle: d.handle, name: d.name, size: 100 });
  const selections: Disk[] = [];
  const saves: SaveRequest[] = [];
  const read: string[] = [];
  let ids = 0;
  const files = {
    save: vi.fn(async (request: SaveRequest): Promise<Saved | null> => {
      saves.push(request);
      return { token: "prj-1", name: "job.maskora.json", overwritten: saves.length > 1 };
    }),
    open: vi.fn(async (): Promise<Opened | null> => null),
    locate: vi.fn(async (): Promise<Located | null> => null),
  };
  const d: ProjectDeps = {
    selectSource: async () => {
      const next = selections.shift();
      return next ? info(next) : null;
    },
    readSource: async (handle) => {
      read.push(handle);
      return new TextEncoder().encode(handle);
    },
    digest: async (bytes) => byHandle.get(new TextDecoder().decode(bytes))!.sha256,
    inspectGeometry: async (handle) => report(byHandle.get(handle)!.pages),
    openPdf: async (bytes) => session(byHandle.get(new TextDecoder().decode(bytes))!.pages),
    newId: () => `id${(ids += 1)}`,
    files,
    appVersion: "test",
    now: () => new Date("2026-10-31T10:00:00Z"),
  };
  return { deps: d, files, selections, saves, read, info };
}

const ART: Disk = { handle: "h-art", name: "K2.pdf", pages: 2, sha256: sha("a") };
const MASKS: Disk = { handle: "h-masks", name: "masks.pdf", pages: 2, sha256: sha("b") };

/** A project with two files, a printed page with ordinary and raised UV, and non-default settings throughout. */
async function buildProject() {
  const env = deps([ART, MASKS]);
  const store = new ProjectStore(env.deps, "p1");
  env.selections.push(ART, MASKS);
  await store.addSource();
  await store.addSource();
  await flush();
  const [art, masks] = store.getState().sources;
  store.setRole({ sourceId: art.id, page: 0 }, "print");
  store.setRole({ sourceId: art.id, page: 1 }, "print");
  store.setRole({ sourceId: masks.id, page: 0 }, "mask");
  store.setRole({ sourceId: masks.id, page: 1 }, "mask");
  const { surfaces, layers } = store.getState().model;
  store.assignTarget(layers[0].id, surfaces[0].id);
  store.assignTarget(layers[1].id, surfaces[0].id);
  store.setLayerType(layers[1].id, "raisedUv");
  store.setInterpretation(layers[0].id, { offsetMm: [0.5, -0.25], featherMm: 0.2, threshold: 0.4 });
  store.setInterpretation(layers[1].id, { mode: "alpha", invert: true });
  store.setRecipe("raisedUv", { heightUm: 120, bevelMm: 0.4, crownUm: 15 });
  store.setRecipe("uv", { gloss: 0.7 });
  store.setStock({ preset: "silk" });
  store.setSceneSlot("front", surfaces[0].id);
  store.setSceneSlot("back", surfaces[1].id);
  store.setSceneSlot("left", surfaces[0].id);
  store.setSceneSlot("right", surfaces[1].id);
  store.setSurfaceBox(surfaces[1].id, "BleedBox");
  store.setOverride([{ sourceId: art.id, page: 1 }], {
    trim: { rect: [9, 9, 91, 91], derivation: "MediaBox inset 3 mm" },
  });
  store.setView({
    layout: "spread",
    raisedMode: "normals",
    show: { uv: true, raisedUv: false },
    hiddenLayers: [layers[1].id],
  });
  store.setLighting({ azimuth: 278, elevation: 10, intensity: 3.2, environmentDeg: 45 });
  store.setCamera({ position: [0.0123456789, -0.2, 0.35], target: [0, 0, 0] });
  store.selectPage({ sourceId: art.id, page: 1 });
  return { env, store, art, masks };
}

/** Open `json` in a fresh store, with native statuses for each saved source. */
async function reopen(
  json: string,
  statuses: (Omit<SourceOnOpen, "source"> & { disk?: Disk })[],
  disk = [ART, MASKS],
) {
  const env = deps(disk);
  const store = new ProjectStore(env.deps, "p2");
  env.files.open.mockResolvedValueOnce({
    token: "prj-9",
    name: "job.maskora.json",
    json,
    sources: statuses.map(({ disk: d, ...s }) => ({ ...s, source: d ? env.info(d) : null })),
  });
  await store.openProject();
  await flush();
  return { env, store };
}

describe("saving and reopening a project", () => {
  it("saves every setting, and a trusted reopen restores all of it with nothing left unsaved", async () => {
    const { env, store, art, masks } = await buildProject();
    expect(store.isDirty()).toBe(true);
    await store.save();
    expect(store.getState().file).toMatchObject({
      token: "prj-1",
      name: "job.maskora.json",
      last: { kind: "saved", overwritten: false },
    });
    expect(store.isDirty()).toBe(false);
    const request = env.saves[0];
    // Native code gets handles to write references from; the JSON carries no path.
    expect(request.sources).toEqual([
      { id: art.id, handle: "h-art" },
      { id: masks.id, handle: "h-masks" },
    ]);
    expect(request.json).not.toMatch(/h-art|relativePath/);
    const saved = parseProjectFile(JSON.parse(request.json));
    if (!saved.ok) throw new Error(saved.message);
    expect(saved.project.sources.map((s) => s.sha256)).toEqual([ART.sha256, MASKS.sha256]);
    expect(saved.project.camera?.position[0]).toBe(0.01235);

    const { store: back } = await reopen(request.json, [
      { id: art.id, fileName: "K2.pdf", status: "authorized", reason: null, disk: ART },
      { id: masks.id, fileName: "masks.pdf", status: "authorized", reason: null, disk: MASKS },
    ]);
    const a = store.getState();
    const b = back.getState();
    expect(b.relink).toEqual({});
    expect(b.sources.map((s) => [s.id, s.name, s.pageCount])).toEqual(
      a.sources.map((s) => [s.id, s.name, s.pageCount]),
    );
    expect(b.model).toEqual(a.model);
    expect(b.overrides).toEqual(a.overrides);
    expect(b.view).toEqual(a.view);
    expect(b.lighting).toEqual(a.lighting);
    expect(b.camera).toEqual(a.camera);
    expect(b.selected).toEqual(a.selected);
    expect(b.cameraRestore).toBe(1);
    expect(contentKey(back.toProjectFile())).toBe(contentKey(store.toProjectFile()));
    expect(back.isDirty()).toBe(false);
    back.setRecipe("raisedUv", { crownUm: 20 });
    expect(back.isDirty()).toBe(true);
  });

  it("a second save goes to the same file; a failed save keeps the project unsaved", async () => {
    const { env, store } = await buildProject();
    await store.save();
    store.setRecipe("uv", { gloss: 0.5 });
    await store.save();
    expect(env.saves[1].token).toBe("prj-1");
    expect(store.getState().file.last).toMatchObject({ kind: "saved", overwritten: true });

    store.setRecipe("uv", { gloss: 0.4 });
    env.files.save.mockRejectedValueOnce({ code: "permissionDenied", message: "read-only" });
    await store.save();
    expect(store.getState().file.last).toMatchObject({
      kind: "failed",
      what: "save",
      code: "permissionDenied",
    });
    expect(store.isDirty()).toBe(true);

    env.files.save.mockResolvedValueOnce(null);
    await store.save(true);
    expect(store.getState().file.last).toEqual({ kind: "cancelled", what: "save" });
    expect(store.isDirty()).toBe(true);
  });

  it("a project from a newer version is refused and the open project stays as it was", async () => {
    const { env, store } = await buildProject();
    const before = store.getState();
    const json = JSON.stringify({ ...JSON.parse((await store.save(), env.saves[0].json)), schemaVersion: 7 });
    env.files.open.mockResolvedValueOnce({ token: "t", name: "new.maskora.json", json, sources: [] });
    await store.openProject();
    expect(store.getState().file.last).toMatchObject({ kind: "failed", what: "open", code: "futureSchema" });
    expect(store.getState().model).toBe(before.model);
    expect(store.getState().sources).toBe(before.sources);
  });

  it("an unfamiliar or missing source is not read until the user locates it; the same content comes back as moved", async () => {
    const { env: first, store, art, masks } = await buildProject();
    await store.save();
    const moved: Disk = { ...MASKS, handle: "h-moved", name: "masks.pdf" };
    const { env, store: back } = await reopen(
      first.saves[0].json,
      [
        { id: art.id, fileName: "K2.pdf", status: "needsApproval", reason: "unfamiliar" },
        { id: masks.id, fileName: "masks.pdf", status: "missing", reason: null },
      ],
      [ART, MASKS, moved],
    );
    expect(env.read).toEqual([]);
    expect(back.getState().relink[art.id]).toMatchObject({ status: "needsApproval", reason: "unfamiliar" });
    expect(back.getState().relink[masks.id].status).toBe("missing");
    expect([...blockedSources(back.getState()).keys()]).toEqual([art.id, masks.id]);
    expect(back.saveProblem()).toBeNull();
    expect(back.isDirty()).toBe(false);

    env.files.locate.mockResolvedValueOnce({ source: env.info(moved), sha256: MASKS.sha256 });
    await back.locateSource(masks.id);
    await flush();
    expect(env.files.locate).toHaveBeenLastCalledWith("masks.pdf", "prj-9");
    expect(back.getState().relink[masks.id]).toMatchObject({ status: "ok", note: "moved" });
    expect(back.source(masks.id)?.pageCount).toBe(2);

    env.files.locate.mockResolvedValueOnce({ source: env.info(ART), sha256: ART.sha256 });
    await back.locateSource(art.id);
    await flush();
    expect(back.getState().relink[art.id]).toMatchObject({ status: "ok", note: "approved" });
    expect(blockedSources(back.getState()).size).toBe(0);
    expect(back.getState().model).toEqual(store.getState().model);
  });

  it("changed content is held: nothing it is assigned to renders until kept, and keeping refuses missing pages", async () => {
    const { env: first, store, art, masks } = await buildProject();
    await store.save();
    const shorter: Disk = { ...MASKS, pages: 1, sha256: sha("c") };
    const { env, store: back } = await reopen(
      first.saves[0].json,
      [
        { id: art.id, fileName: "K2.pdf", status: "authorized", reason: null, disk: ART },
        { id: masks.id, fileName: "masks.pdf", status: "changed", reason: null, disk: shorter },
      ],
      [ART, shorter],
    );
    expect(back.getState().relink[masks.id].status).toBe("changed");
    expect(blockedSources(back.getState()).get(masks.id)).toMatch(/changed since the project was saved/);
    // Saved again while held, the project keeps the identity it had, so the change is still noticed.
    expect(back.toProjectFile().sources.find((s) => s.id === masks.id)?.sha256).toBe(MASKS.sha256);
    expect(back.isDirty()).toBe(false);

    expect(back.keepChanged(masks.id)).toBe(false);
    expect(back.getState().lastRefusal).toMatchObject({ code: "pagesMissing" });
    expect(back.getState().lastRefusal?.message).toMatch(/now has 1 page, but the project assigns page 2/);

    const longer: Disk = { ...MASKS, handle: "h-longer", sha256: sha("d"), pages: 3 };
    env.files.locate.mockResolvedValueOnce({ source: env.info(longer), sha256: longer.sha256 });
    // A located file is read through the deps by its handle.
    (env.deps as { digest: ProjectDeps["digest"] }).digest = async () => longer.sha256;
    env.deps.openPdf = async () => session(3);
    await back.locateSource(masks.id);
    await flush();
    expect(back.getState().relink[masks.id].status).toBe("changed");
    expect(back.keepChanged(masks.id)).toBe(true);
    expect(back.getState().relink[masks.id]).toMatchObject({ status: "ok", note: "kept" });
    expect(blockedSources(back.getState()).size).toBe(0);
    expect(back.toProjectFile().sources.find((s) => s.id === masks.id)?.sha256).toBe(longer.sha256);
    expect(back.isDirty()).toBe(true);
  });

  it("no source can be added while a project's sources are loading, and New clears everything", async () => {
    const { env: first, store, art, masks } = await buildProject();
    await store.save();
    const { env, store: back } = await reopen(first.saves[0].json, [
      { id: art.id, fileName: "K2.pdf", status: "authorized", reason: null, disk: ART },
      { id: masks.id, fileName: "masks.pdf", status: "authorized", reason: null, disk: MASKS },
    ]);
    back.newProject();
    expect(back.getState().sources).toEqual([]);
    expect(back.getState().model.layers).toEqual([]);
    expect(back.getState().file.token).toBeNull();
    expect(back.isDirty()).toBe(false);
    env.selections.push(ART);
    await back.addSource();
    expect(back.getState().sources).toHaveLength(1);
  });
});
