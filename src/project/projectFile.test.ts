import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseProjectFile, toJson } from "./projectFile";

const fixture = () =>
  JSON.parse(readFileSync(join(__dirname, "../../tests/fixtures/model/project-v1.json"), "utf8")) as Record<
    string,
    unknown
  >;

/** A copy of the fixture with one value replaced at a dotted path. */
function withValue(path: string, value: unknown) {
  const root = fixture();
  const keys = path.split(".");
  let node = root as Record<string, unknown>;
  for (const k of keys.slice(0, -1)) node = node[k] as Record<string, unknown>;
  if (value === undefined) delete node[keys.at(-1)!];
  else node[keys.at(-1)!] = value;
  return root;
}

const refusal = (input: unknown) => {
  const r = parseProjectFile(input);
  if (r.ok) throw new Error("expected a refusal");
  return r;
};

describe("project file, schema 1", () => {
  it("reads every saved setting and writes it back unchanged, including a future mask source verbatim", () => {
    const parsed = parseProjectFile(fixture());
    if (!parsed.ok) throw new Error(parsed.message);
    const p = parsed.project;
    expect(p.model.recipes.raisedUv).toEqual({
      gloss: 0.95,
      strength: 1,
      heightUm: 120,
      bevelMm: 0.4,
      crownUm: 15,
    });
    expect(p.model.scene).toEqual({ front: "s-front", back: "s-back", left: "s-front", right: "s-back" });
    expect(p.view.raisedMode).toBe("normals");
    expect(p.model.layers[1].interpretation).toMatchObject({ mode: "alpha", invert: true, threshold: 0.3 });
    expect(p.model.layers[0].interpretation.offsetMm).toEqual([0.5, -0.25]);
    expect(p.model.layers[2].mask).toMatchObject({ kind: "unsupported", declaredKind: "vectorPath" });
    expect(p.overrides["art:1"].trim?.derivation).toBe("MediaBox inset 3 mm");
    expect(p.lighting).toEqual({ azimuth: 278, elevation: 10, intensity: 3.2, environmentDeg: 45 });
    expect(p.camera).toEqual({ position: [0.01, -0.2, 0.35], target: [0, 0, 0] });
    // Round trip: the serialized project equals the file it was read from.
    expect(JSON.parse(JSON.stringify(toJson(p)))).toEqual(fixture());
  });

  it("refuses a newer schema with its own code, without reading further", () => {
    const r = refusal(withValue("schemaVersion", 2));
    expect(r.code).toBe("futureSchema");
    expect(r.message).toMatch(/newer.*not changed/);
  });

  it.each([
    ["format", "something-else", /format/],
    ["sources.0.sha256", "not-a-digest", /sources\[0\]\.sha256/],
    ["model.surfaces.0.artwork", { sourceId: "nope", page: 0 }, /names no source/],
    ["model.surfaces.0.artwork", { sourceId: "art", page: 5 }, /page: must be a number from 0 to 1/],
    ["model.layers.0.target", "s-gone", /names no printed page/],
    ["model.layers.0.interpretation.threshold", 2, /interpretation/],
    ["model.layers.0.interpretation.featherMm", Number.NaN, /featherMm/],
    ["model.recipes.raisedUv.heightUm", 5000, /heightUm/],
    ["model.stock.thicknessMm", -1, /thicknessMm/],
    ["model.scene.back", "s-gone", /scene\.back/],
    ["view.raisedMode", "voxels", /raisedMode/],
    ["view.hiddenLayers", ["l-gone"], /names no finish layer/],
    ["lighting.elevation", 120, /elevation/],
    ["camera.position", [0, 0], /three numbers/],
    ["overrides", { "art:1": { trim: { rect: [10, 10, 5, 5], derivation: "x" } } }, /no area/],
    ["selected", { sourceId: "art", page: 9 }, /selected\.page/],
  ])("refuses %s = %j, naming where", (path, value, message) => {
    const r = refusal(withValue(path, value));
    expect(r.code).toBe("invalidProject");
    expect(r.message).toMatch(message);
  });

  it("keeps a layer whose mask file left the project, as the model does", () => {
    const root = fixture();
    const layers = (root.model as { layers: { mask: { sourceId?: string } }[] }).layers;
    layers[0].mask.sourceId = "removed";
    const r = parseProjectFile(root);
    expect(r.ok).toBe(true);
  });

  it("refuses duplicate ids", () => {
    const root = fixture();
    const sources = root.sources as { id: string }[];
    sources[1].id = "art";
    expect(refusal(root).message).toMatch(/unique/);
  });
});
