/**
 * The adapter contract against the real fixtures: PDF.js (its Node build) reads
 * the bytes, the native side is represented by each fixture's hand-written
 * expectations (the Rust tests check the native reader against the same files).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";
import { describe, expect, it } from "vitest";
import {
  classifyOpenError,
  parsePdfDate,
  readMetadata,
  readOptionalContent,
  readPageFacts,
  readPageLabels,
} from "@/pdf/adapter";
import type { GeometryReport } from "@/native/sources";
import { BOX_NAMES, diagnose, insetBy, outsetBy, summarizePage } from "./facts";

const DIR = join(__dirname, "../../tests/fixtures/pdf");
const expected = (id: string) => JSON.parse(readFileSync(join(DIR, `${id}.expected.json`), "utf8"));

async function open(id: string, password?: string): Promise<PDFDocumentProxy> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(readFileSync(join(DIR, `${id}.pdf`)));
  return pdfjs.getDocument({ data, password, verbosity: 0 }).promise as unknown as Promise<PDFDocumentProxy>;
}

/** The native report a correct reader returns for a G fixture: its expectations. */
function nativeFor(id: string): GeometryReport {
  return {
    engine: "expected",
    sha256: "same",
    pages: expected(id).pages.map(
      (p: {
        index: number;
        rotate: GeometryReport["pages"][0]["rotate"];
        userUnit: number;
        boxes: Record<string, unknown>;
      }) => ({
        index: p.index,
        rotate: p.rotate,
        userUnit: p.userUnit,
        boxes: BOX_NAMES.map((name) => [name, p.boxes[name]]),
      }),
    ),
  };
}

describe("PDF.js facts", () => {
  it("D1: mixed labels, document information and XMP presence", async () => {
    const doc = await open("D1");
    const want = expected("D1");
    expect(await readPageLabels(doc)).toEqual(want.labels);
    const meta = await readMetadata(doc);
    expect(Object.fromEntries(meta.fields.map((f) => [f.key, f.value]))).toEqual(want.info);
    expect(meta.pdfVersion).toBe(want.pdfVersion);
    expect(meta.xmp).toBe("present");
    expect(meta.permissions).toBeNull();
    const pages = await readPageFacts(doc);
    expect(pages.map((p) => p.rotate)).toEqual(want.pages.map((p: { rotate: number }) => p.rotate));
  });

  it("absent facts stay absent: G1 has no labels, no title and no layers", async () => {
    const doc = await open("G1");
    expect(await readPageLabels(doc)).toBeNull();
    const meta = await readMetadata(doc);
    expect(meta.fields.find((f) => f.key === "Title")?.value).toBeNull();
    expect(meta.xmp).toBe("absent");
    expect((await readOptionalContent(doc)).groups).toBe(0);
  });

  it("O1: both layers change for printing", async () => {
    expect(await readOptionalContent(await open("O1"))).toEqual({
      groups: 2,
      printDiffers: ["ViewOnly", "PrintOnly"],
    });
  });

  it("open failures map to stable codes and never carry the password", async () => {
    const codeOf = async (id: string, password?: string) => {
      try {
        await open(id, password);
        return "opened";
      } catch (error) {
        const e = classifyOpenError(error);
        expect(e.message).not.toContain("wrong-secret");
        return e.code;
      }
    };
    expect(await codeOf("E1b")).toBe("passwordNeeded");
    expect(await codeOf("E1b", "wrong-secret")).toBe("passwordWrong");
    expect(await codeOf("E1b", "maskora")).toBe("opened");
    expect(await codeOf("X1c")).toBe("invalidPdf");
  });

  it("parses PDF dates with offsets", () => {
    expect(parsePdfDate("D:20261030120000+02'00'")).toBe("2026-10-30T10:00:00.000Z");
    expect(parsePdfDate("D:2026")).toBe("2026-01-01T00:00:00.000Z");
    expect(parsePdfDate("yesterday")).toBe("yesterday");
  });
});

describe("combining the engines", () => {
  it("G3: native inheritance wins over PDF.js, and the readers agree", async () => {
    const pdf = await readPageFacts(await open("G3"));
    const native = nativeFor("G3");
    const page = summarizePage(1, pdf[1], native.pages[1], null, undefined);
    expect(page.boxes.map((b) => b.origin)).toEqual([
      "inherited",
      "explicit",
      "default",
      "explicit",
      "default",
    ]);
    expect(page.rotation).toMatchObject({ displayed: 90, from: "native", origin: "inherited" });
    expect(diagnose({ pdfPages: pdf, pageCount: 2, native, digest: "same" })).toEqual([]);
  });

  it("G5: an invalid rotation is shown as invalid, rendered unrotated, and diagnosed", async () => {
    const pdf = await readPageFacts(await open("G5"));
    const native = nativeFor("G5");
    const page = summarizePage(3, pdf[3], native.pages[3], null, undefined);
    expect(page.rotation).toMatchObject({ displayed: 0, invalid: true, raw: 45, origin: "invalid" });
    const codes = diagnose({ pdfPages: pdf, pageCount: 6, native }).map((d) => [d.code, d.page]);
    expect(codes).toEqual([["invalidRotation", 3]]);
  });

  it("before native geometry arrives, boxes are unknown rather than defaulted", async () => {
    const pdf = await readPageFacts(await open("G2"));
    const page = summarizePage(0, pdf[0], undefined, null, undefined);
    expect(page.boxes.every((b) => b.origin === "unknown" && b.effective === null)).toBe(true);
    expect(page.rotation.from).toBe("pdfjs");
    expect(page.trimMm).toBeNull();
  });

  it("disagreements are diagnosed: changed bytes, page count, CropBox", async () => {
    const pdf = await readPageFacts(await open("G1"));
    const native = nativeFor("G1");
    const codes = (n: GeometryReport, digest = "same") =>
      diagnose({ pdfPages: pdf, pageCount: 1, native: n, digest }).map((d) => d.code);
    expect(codes(native, "different")).toEqual(["sourceChangedWhileOpening"]);
    expect(codes({ ...native, pages: [] })).toEqual(["pageCountDisagrees"]);
    const shifted = structuredClone(native);
    (shifted.pages[0].boxes[1][1].effective as number[])[0] += 1;
    expect(codes(shifted)).toEqual(["cropBoxDisagrees"]);
  });

  it("print-only layers produce a visible limitation; documents without them do not", async () => {
    const oc = await readOptionalContent(await open("O1"));
    expect(diagnose({ pageCount: 1, optionalContent: oc })).toMatchObject([
      { level: "limitation", code: "printLayersDiffer" },
    ]);
    expect(diagnose({ pageCount: 1, optionalContent: await readOptionalContent(await open("G1")) })).toEqual(
      [],
    );
  });
});

describe("manual trim and bleed", () => {
  it("an override replaces the effective TrimBox and keeps the source fact", async () => {
    const native = nativeFor("G2");
    const media = native.pages[0].boxes[0][1].effective;
    const trim = insetBy(media, 3, 1);
    expect(trim.ok).toBe(true);
    if (!trim.ok) return;
    const page = summarizePage(0, undefined, native.pages[0], null, {
      trim: { rect: trim.rect, derivation: "MediaBox inset 3 mm" },
    });
    const row = page.boxes.find((b) => b.name === "TrimBox")!;
    expect(row.origin).toBe("override");
    expect(row.source?.origin).toBe("default");
    expect(row.source?.effective).toEqual(media);
    // Trim = MediaBox less 3 mm on each side.
    expect(page.trimMm![0]).toBeCloseTo(((media[2] - media[0]) * 25.4) / 72 - 6, 6);
    expect(page.trimMm![1]).toBeCloseTo(((media[3] - media[1]) * 25.4) / 72 - 6, 6);
  });

  it("refuses an inset that leaves no page; clips a bleed beyond the MediaBox and says so", () => {
    expect(insetBy([0, 0, 100, 100], 18, 1)).toMatchObject({ ok: false });
    expect(insetBy([0, 0, 100, 100], -1, 1)).toMatchObject({ ok: false });
    const bleed = outsetBy([10, 10, 90, 90], 5, 1, [0, 0, 100, 100]);
    expect(bleed).toMatchObject({ ok: true, rect: [0, 0, 100, 100] });
    expect(bleed.ok && bleed.note).toContain("clipped");
  });
});
