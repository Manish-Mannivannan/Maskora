import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain JavaScript module without type declarations
import { buildAll } from "./fixtures/generate.mjs";

const dir = join(__dirname, "fixtures", "pdf");

describe("synthetic PDF fixtures", () => {
  const built = buildAll() as Record<string, { pdf: Buffer; expectedJson: string }>;

  it("covers at least the baseline geometry fixtures", () => {
    expect(Object.keys(built)).toEqual(expect.arrayContaining(["G1", "G2"]));
  });

  for (const [id, { pdf, expectedJson }] of Object.entries(built)) {
    it(`${id} is committed byte-identical to a fresh build`, () => {
      expect(readFileSync(join(dir, `${id}.pdf`)).equals(pdf)).toBe(true);
      expect(readFileSync(join(dir, `${id}.expected.json`), "utf8")).toBe(expectedJson);
    });

    it(`${id} is a structurally complete PDF`, () => {
      const text = pdf.toString("latin1");
      expect(text.startsWith("%PDF-")).toBe(true);
      expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
      const startxref = Number(/startxref\n(\d+)/.exec(text)?.[1]);
      expect(text.slice(startxref, startxref + 4)).toBe("xref");
    });
  }
});
