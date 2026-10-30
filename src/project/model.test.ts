import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EMPTY_MODEL,
  addLayer,
  assignTarget,
  layerProblem,
  moveLayer,
  parseMaskSource,
  removeSource,
  serializeMaskSource,
  setInterpretation,
  setLayerType,
  setRole,
  surfaceFor,
  type FinishType,
  type PageRole,
  type ProjectModel,
} from "./model";

const FIXTURES = join(__dirname, "../../tests/fixtures");
const k1 = JSON.parse(readFileSync(join(FIXTURES, "pdf", "K1.expected.json"), "utf8"));

let n = 0;
const newId = () => `id${(n += 1)}`;
const src = (page: number) => ({ sourceId: "k1", page });
const ok = <T extends { ok: boolean }>(r: T) => {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return (r as unknown as { model: ProjectModel }).model;
};

/** Map K1 as its expectations state, classifying pages in a deliberately scrambled order. */
function mapK1(): ProjectModel {
  let model = EMPTY_MODEL;
  const mapping = k1.mapping as { page: number; role: PageRole; finish?: FinishType; target?: number }[];
  for (const i of [3, 1, 4, 0, 2]) {
    const m = mapping.find((x) => x.page === i)!;
    model = setRole(model, src(i), m.role, newId);
  }
  for (const m of mapping.filter((x) => x.role === "mask")) {
    const layer = model.layers.find((l) => l.mask.kind === "pdfPage" && l.mask.page === m.page)!;
    model = ok(setLayerType(model, layer.id, m.finish!));
    model = ok(assignTarget(model, layer.id, surfaceFor(model, src(m.target!))!.id));
  }
  return model;
}

describe("page roles and finish layers", () => {
  it("K1: out-of-order pages map to two surfaces and three layers on artwork A", () => {
    const model = mapK1();
    expect(model.surfaces.map((s) => s.artwork.page).sort()).toEqual([1, 2]);
    expect(model.surfaces.every((s) => s.box === "TrimBox")).toBe(true);
    const a = surfaceFor(model, src(1))!.id;
    const layers = model.layers.map((l) => [l.mask.kind === "pdfPage" && l.mask.page, l.type, l.target]);
    expect(layers.sort()).toEqual([
      [0, "raisedUv", a],
      [3, "uv", a],
      [4, "uv", a],
    ]);
    const sources = [{ id: "k1", pageCount: 5 }];
    expect(model.layers.map((l) => layerProblem(model, l, sources))).toEqual([null, null, null]);
  });

  it("refuses invalid targets and finishes", () => {
    const model = mapK1();
    const layer = model.layers[0];
    expect(assignTarget(model, layer.id, "no-such-surface")).toMatchObject({
      ok: false,
      code: "unknownSurface",
    });
    // A mask page is never a surface, so it cannot be a target either.
    expect(assignTarget(model, layer.id, layer.id)).toMatchObject({ ok: false, code: "unknownSurface" });
    expect(addLayer(model, src(1), "uv", newId)).toMatchObject({ ok: false, code: "notAMaskPage" });
    expect(setLayerType(model, layer.id, "foil" as FinishType)).toMatchObject({
      ok: false,
      code: "unsupportedFinish",
    });
    expect(assignTarget(model, "no-such-layer", null)).toMatchObject({ ok: false, code: "unknownLayer" });
  });

  it("allows several masks of one finish on one target", () => {
    const model = mapK1();
    const more = ok(addLayer(model, src(0), "uv", newId));
    expect(more.layers.filter((l) => l.mask.kind === "pdfPage" && l.mask.page === 0)).toHaveLength(2);
  });

  it("un-marking a printed page leaves its layers visibly unassigned, never retargeted", () => {
    const model = setRole(mapK1(), src(1), "ignore", newId);
    expect(model.surfaces.map((s) => s.artwork.page)).toEqual([2]);
    const sources = [{ id: "k1", pageCount: 5 }];
    expect(model.layers.map((l) => layerProblem(model, l, sources)?.code)).toEqual([
      "missingTarget",
      "missingTarget",
      "missingTarget",
    ]);
  });

  it("un-marking a mask page or removing its source makes the layer's problem explicit", () => {
    let model = setRole(mapK1(), src(3), "ignore", newId);
    const layer3 = model.layers.find((l) => l.mask.kind === "pdfPage" && l.mask.page === 3)!;
    expect(layerProblem(model, layer3, [{ id: "k1", pageCount: 5 }])?.code).toBe("maskRoleChanged");
    model = removeSource(mapK1(), "k1");
    expect(model.surfaces).toEqual([]);
    expect(model.layers.map((l) => layerProblem(model, l, [])?.code)).toEqual([
      "missingMask",
      "missingMask",
      "missingMask",
    ]);
  });

  it("validates interpretation and reorders layers", () => {
    const model = mapK1();
    const id = model.layers[0].id;
    expect(setInterpretation(model, id, { threshold: 1.5 })).toMatchObject({
      ok: false,
      code: "invalidThreshold",
    });
    expect(setInterpretation(model, id, { featherMm: -1 })).toMatchObject({
      ok: false,
      code: "invalidFeather",
    });
    expect(setInterpretation(model, id, { offsetMm: [0, Number.NaN] })).toMatchObject({
      ok: false,
      code: "invalidOffset",
    });
    const shifted = ok(setInterpretation(model, id, { offsetMm: [-1.5, 1] }));
    expect(shifted.layers[0].interpretation.offsetMm).toEqual([-1.5, 1]);
    expect(moveLayer(model, id, 1).layers[1].id).toBe(id);
    expect(moveLayer(model, id, -1)).toBe(model);
  });
});

describe("mask-source union", () => {
  const { cases } = JSON.parse(readFileSync(join(FIXTURES, "model", "mask-sources.json"), "utf8"));
  for (const c of cases as { name: string; input: unknown; expect: Record<string, unknown> }[]) {
    it(c.name, () => {
      const parsed = parseMaskSource(c.input);
      if (c.expect.ok) {
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(parsed.value.kind).toBe(c.expect.kind);
        if (c.expect.declaredKind && parsed.value.kind === "unsupported")
          expect(parsed.value.declaredKind).toBe(c.expect.declaredKind);
        // Round trip: what was read is written back unchanged, supported or not.
        expect(serializeMaskSource(parsed.value)).toEqual(c.input);
      } else {
        expect(parsed).toMatchObject({ ok: false, code: c.expect.code });
      }
    });
  }

  it("an unsupported layer never renders as if supported", () => {
    const parsed = parseMaskSource({ kind: "pdfLayer", version: 1, sourceId: "k1", layer: "UV" });
    if (!parsed.ok) throw new Error();
    const model = mapK1();
    const layer = { ...model.layers[0], mask: parsed.value };
    expect(layerProblem(model, layer, [{ id: "k1", pageCount: 5 }])?.code).toBe("unsupportedMaskSource");
  });
});
