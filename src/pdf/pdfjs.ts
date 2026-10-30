/**
 * Loading PDF.js from the app's own origin (architecture §7.2, §11.1).
 *
 * The worker and its data files (CMaps, standard fonts, wasm decoders, ICC
 * profiles) are copied into `public/pdfjs/` at build time and never fetched
 * from a CDN. PDF.js 6 contains no `eval` or `new Function` (checked against
 * the shipped builds), so the strict content security policy holds; XFA and
 * document scripts are never run. Client-only: PDF.js needs a window and
 * a worker, so it is imported lazily, never during the static export.
 */
import type { DocumentInitParameters, PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";

const BASE = "/pdfjs/";

let loaded: Promise<typeof import("pdfjs-dist")> | null = null;

export function loadPdfjs(): Promise<typeof import("pdfjs-dist")> {
  loaded ??= import("pdfjs-dist").then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = `${BASE}pdf.worker.min.mjs`;
    return pdfjs;
  });
  return loaded;
}

/** Parameters every document is opened with: local resources only, no scripting. */
export function localDocumentParams(data: Uint8Array, password?: string): DocumentInitParameters {
  return {
    data,
    password,
    cMapUrl: `${BASE}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${BASE}standard_fonts/`,
    wasmUrl: `${BASE}wasm/`,
    iccUrl: `${BASE}iccs/`,
    enableXfa: false,
    verbosity: 0,
  };
}

export interface OpenedDocument {
  document: PDFDocumentProxy;
  /** Tear down the document and its worker transport. */
  close: () => Promise<void>;
}

export async function openDocument(data: Uint8Array, password?: string): Promise<OpenedDocument> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument(localDocumentParams(data, password));
  const document = await task.promise;
  return { document, close: () => task.destroy() };
}
