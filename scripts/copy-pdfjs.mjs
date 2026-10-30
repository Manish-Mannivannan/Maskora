#!/usr/bin/env node
/**
 * Copy PDF.js's worker and its data files into public/pdfjs/ so the app loads
 * them from its own origin. The app never fetches them from a CDN (§3.3,
 * §11.1); this runs before every `next dev` and `next build`, so the copy
 * always matches the installed pdfjs-dist version. public/pdfjs/ is ignored by
 * git: it is generated from node_modules, never edited.
 */
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, "node_modules", "pdfjs-dist");
const dest = join(root, "public", "pdfjs");
const { version } = JSON.parse(readFileSync(join(src, "package.json"), "utf8"));

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(join(src, "build", "pdf.worker.min.mjs"), join(dest, "pdf.worker.min.mjs"));
for (const dir of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  cpSync(join(src, dir), join(dest, dir), { recursive: true });
}
writeFileSync(join(dest, "VERSION"), `${version}\n`);
console.log(`copy-pdfjs: pdfjs-dist ${version} worker and data copied to public/pdfjs/`);
