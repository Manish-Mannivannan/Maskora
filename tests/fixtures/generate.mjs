#!/usr/bin/env node
/**
 * Generate the synthetic PDF fixtures and their expected values.
 *
 *   node tests/fixtures/generate.mjs          write tests/fixtures/pdf/*.pdf and *.expected.json
 *   node tests/fixtures/generate.mjs --check  exit 1 if any committed fixture differs from a fresh build
 *
 * Every fixture is synthetic: no customer artwork, no third-party files. The
 * expected values are written here, by hand, per fixture — they are what the
 * PDF specification says a correct reader must report, not the output of any
 * engine under test. See tests/fixtures/README.md for the convention.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CORPUS } from "./corpus.mjs";
import { PdfBuilder, name, ref, stream } from "./pdf-writer.mjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "pdf");

/** A filled rectangle in a content stream, colour as RGB 0..1. */
export const rect = ([x, y, w, h], [r, g, b] = [0, 0, 0]) => `${r} ${g} ${b} rg ${x} ${y} ${w} ${h} re f\n`;

/**
 * One-page document. `page` holds raw page-dictionary entries (MediaBox,
 * CropBox, …) written exactly as given; `content` is the page's content stream.
 */
export function singlePage({ page, content = "", version }) {
  const pdf = new PdfBuilder({ version });
  const catalog = pdf.reserve();
  const pages = pdf.reserve();
  const contents = pdf.add(stream({}, content));
  const pageId = pdf.add({ Type: name("Page"), Parent: ref(pages), ...page, Contents: ref(contents) });
  pdf.set(pages, { Type: name("Pages"), Kids: [ref(pageId)], Count: 1 });
  pdf.set(catalog, { Type: name("Catalog"), Pages: ref(pages) });
  return pdf.build({ root: catalog });
}

/** Expected facts for a box: the raw array as written (or null), the effective rectangle, and its origin. */
const box = (rawValue, effective, origin) => ({ raw: rawValue, effective, origin });

export const FIXTURES = {
  // G1 — all five boxes explicit, with a different inset on every edge, so a
  // swapped or mirrored edge is detectable.
  G1: () => {
    const b = {
      MediaBox: [0, 0, 600, 800],
      CropBox: [4, 6, 592, 797],
      BleedBox: [10, 12, 585, 790],
      TrimBox: [19, 21, 576, 781],
      ArtBox: [40, 50, 550, 740],
    };
    return {
      pdf: singlePage({ page: b, content: rect([19, 21, 557, 760], [0.9, 0.9, 0.9]) }),
      expected: {
        description: "All five boxes explicit with asymmetric insets",
        pages: [
          {
            index: 0,
            rotate: { raw: null, effective: 0, origin: "default" },
            userUnit: 1,
            boxes: Object.fromEntries(Object.entries(b).map(([k, v]) => [k, box(v, v, "explicit")])),
          },
        ],
      },
    };
  },

  // G2 — MediaBox only. CropBox defaults to MediaBox; Bleed/Trim/ArtBox default
  // to CropBox. A defaulted TrimBox is a format fallback, never printer intent.
  G2: () => {
    const media = [0, 0, 420, 595];
    return {
      pdf: singlePage({ page: { MediaBox: media } }),
      expected: {
        description: "MediaBox only; every other box is a format default",
        pages: [
          {
            index: 0,
            rotate: { raw: null, effective: 0, origin: "default" },
            userUnit: 1,
            boxes: {
              MediaBox: box(media, media, "explicit"),
              CropBox: box(null, media, "default"),
              BleedBox: box(null, media, "default"),
              TrimBox: box(null, media, "default"),
              ArtBox: box(null, media, "default"),
            },
          },
        ],
      },
    };
  },
};

/** Build every fixture in memory: { id: { pdf: Buffer, expectedJson: string } }. */
export function buildAll() {
  const out = {};
  for (const [id, make] of Object.entries({ ...FIXTURES, ...CORPUS })) {
    const { pdf, expected } = make();
    out[id] = { pdf, expectedJson: `${JSON.stringify({ fixture: id, ...expected }, null, 2)}\n` };
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const check = process.argv.includes("--check");
  const built = buildAll();
  const stale = [];
  mkdirSync(OUT, { recursive: true });
  for (const [id, { pdf, expectedJson }] of Object.entries(built)) {
    const pdfPath = join(OUT, `${id}.pdf`);
    const jsonPath = join(OUT, `${id}.expected.json`);
    if (check) {
      const same =
        existsSync(pdfPath) &&
        existsSync(jsonPath) &&
        readFileSync(pdfPath).equals(pdf) &&
        readFileSync(jsonPath, "utf8") === expectedJson;
      if (!same) stale.push(id);
    } else {
      writeFileSync(pdfPath, pdf);
      writeFileSync(jsonPath, expectedJson);
    }
  }
  if (check && stale.length > 0) {
    console.error(`fixtures out of date: ${stale.join(", ")} — run node tests/fixtures/generate.mjs`);
    process.exit(1);
  }
  console.log(`${check ? "checked" : "wrote"} ${Object.keys(built).length} fixtures in ${OUT}`);
}
