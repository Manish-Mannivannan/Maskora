/**
 * The PDF.js half of the PDF adapter (architecture §7.2, §7.3).
 *
 * PDF.js rasterizes pages and reports what its public API knows: the base box
 * (`view`, the effective CropBox), its rotation, UserUnit, page labels,
 * document information and optional content. Page boxes and their provenance
 * come from the native reader instead; `src/project/facts.ts` combines the two
 * and checks that they agree.
 *
 * The fact readers take an open document, so tests can drive them with the
 * Node build of PDF.js; `openSession` is the window-only entry point.
 */
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist/types/src/display/api";
import { loadPdfjs, localDocumentParams } from "./pdfjs";
import { planRender, type Rect, type RenderPlan, type RenderRequest } from "./transform";

export interface PdfPageFacts {
  index: number;
  view: Rect;
  rotate: number;
  userUnit: number;
}

export interface MetadataField {
  key: string;
  label: string;
  /** null when the file does not state the field. */
  value: string | null;
}

export interface DocMetadata {
  fields: MetadataField[];
  pdfVersion: string | null;
  encryption: string | null;
  linearized: boolean;
  /** XMP is detected but not read in this version: it shows as unsupported, not absent. */
  xmp: "present" | "absent";
  /** Operations the file declares as allowed, or null when it declares no restrictions. */
  permissions: string[] | null;
}

export interface OptionalContentSummary {
  groups: number;
  /** Groups whose print state differs from their on-screen state. */
  printDiffers: string[];
}

export type PdfOpenErrorCode = "passwordNeeded" | "passwordWrong" | "invalidPdf" | "pdfReadFailed";

export interface PdfOpenError {
  code: PdfOpenErrorCode;
  message: string;
}

export async function readPageFacts(doc: PDFDocumentProxy): Promise<PdfPageFacts[]> {
  const pages: PdfPageFacts[] = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    pages.push({ index: i - 1, view: [...page.view] as Rect, rotate: page.rotate, userUnit: page.userUnit });
  }
  return pages;
}

/** Page labels, or null when the document defines none. */
export async function readPageLabels(doc: PDFDocumentProxy): Promise<string[] | null> {
  return doc.getPageLabels();
}

/** A PDF date (D:YYYYMMDDHHmmSSOHH'mm') as an ISO string, or the raw text if it does not parse. */
export function parsePdfDate(raw: string): string {
  const m = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+-])?(\d{2})?'?(\d{2})?'?/.exec(
    raw.trim(),
  );
  if (!m) return raw;
  const [, y, mo = "01", d = "01", h = "00", mi = "00", s = "00", tz, th = "00", tm = "00"] = m;
  let ms = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  if (tz === "+" || tz === "-") ms -= (tz === "+" ? 1 : -1) * (+th * 60 + +tm) * 60000;
  return Number.isNaN(ms) ? raw : new Date(ms).toISOString();
}

const INFO_FIELDS: [string, string][] = [
  ["Title", "Title"],
  ["Author", "Author"],
  ["Subject", "Subject"],
  ["Creator", "Created with"],
  ["Producer", "Produced by"],
  ["CreationDate", "Created"],
  ["ModDate", "Modified"],
];

const PERMISSIONS: [number, string][] = [
  [4, "print"],
  [2048, "print high quality"],
  [8, "modify contents"],
  [16, "copy"],
  [32, "annotate"],
  [256, "fill forms"],
  [512, "copy for accessibility"],
  [1024, "assemble"],
];

export async function readMetadata(doc: PDFDocumentProxy): Promise<DocMetadata> {
  const { info, metadata } = (await doc.getMetadata()) as {
    info: Record<string, unknown>;
    metadata: unknown;
  };
  const text = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v : null);
  const fields = INFO_FIELDS.map(([key, label]) => {
    const value = text(info[key]);
    return { key, label, value: value && key.endsWith("Date") ? parsePdfDate(value) : value };
  });
  const flags = await doc.getPermissions();
  return {
    fields,
    pdfVersion: text(info.PDFFormatVersion),
    encryption: text(info.EncryptFilterName),
    linearized: info.IsLinearized === true,
    xmp: metadata ? "present" : "absent",
    permissions: flags ? PERMISSIONS.filter(([flag]) => flags.has(flag)).map(([, name]) => name) : null,
  };
}

export async function readOptionalContent(doc: PDFDocumentProxy): Promise<OptionalContentSummary> {
  const config = await doc.getOptionalContentConfig({ intent: "display" });
  let groups = 0;
  const printDiffers: string[] = [];
  for (const [, group] of config as Iterable<
    [string, { name?: string; visible: boolean; usage?: { print?: { printState?: string } } }]
  >) {
    groups += 1;
    const printState = group.usage?.print?.printState;
    if (printState && (printState === "ON") !== group.visible) printDiffers.push(group.name ?? "(unnamed)");
  }
  return { groups, printDiffers };
}

/** Map a PDF.js open failure to a stable code; the password itself never appears in the message. */
export function classifyOpenError(error: unknown): PdfOpenError {
  const e = error as { name?: string; code?: number; message?: string };
  if (e?.name === "PasswordException")
    return e.code === 2
      ? { code: "passwordWrong", message: "The password is not correct." }
      : { code: "passwordNeeded", message: "This document needs a password to open." };
  if (e?.name === "InvalidPDFException")
    return { code: "invalidPdf", message: "The file is not a readable PDF." };
  return { code: "pdfReadFailed", message: "PDF.js could not read the file." };
}

export function isPdfOpenError(value: unknown): value is PdfOpenError {
  return (
    typeof value === "object" &&
    value !== null &&
    ["passwordNeeded", "passwordWrong", "invalidPdf", "pdfReadFailed"].includes((value as PdfOpenError).code)
  );
}

export interface RenderOptions {
  signal?: AbortSignal;
  /** Probe-only raw engine options; the app always renders through the plan's policy. */
  raw?: { intent?: "display" | "print"; annotationMode?: number; ocIntent?: "display" | "print" };
}

/**
 * Render a planned region into `canvas`. PDF.js multiplies its scale by
 * UserUnit; the factor it applies is measured from a unit viewport rather
 * than assumed, so the plan's pixels-per-unit hold whatever PDF.js does.
 */
export async function renderPlanned(
  doc: PDFDocumentProxy,
  page: PDFPageProxy,
  plan: RenderPlan,
  canvas: HTMLCanvasElement,
  options: RenderOptions = {},
) {
  const unit = page.getViewport({ scale: 1, rotation: plan.rotation });
  const [vx0, vy0, vx1, vy1] = plan.view;
  const applied = unit.width / (plan.rotation % 180 === 0 ? vx1 - vx0 : vy1 - vy0);
  const viewport = page.getViewport({
    scale: plan.pxPerUnit / applied,
    rotation: plan.rotation,
    offsetX: plan.offsetX,
    offsetY: plan.offsetY,
  });
  canvas.width = plan.width;
  canvas.height = plan.height;
  // PDF.js asks for an opaque context when handed a canvas, so a transparent
  // render needs a context created here with an alpha channel.
  const transparent = plan.policy.background === "transparent";
  const raw = options.raw ?? {};
  const task = page.render({
    canvas: transparent ? null : canvas,
    canvasContext: transparent ? (canvas.getContext("2d", { alpha: true }) ?? undefined) : undefined,
    viewport,
    intent: raw.intent ?? (plan.policy.annotations === "print" ? "print" : "display"),
    annotationMode: raw.annotationMode ?? (plan.policy.annotations === "none" ? 0 : 1),
    background: transparent ? "rgba(0,0,0,0)" : "#ffffff",
    optionalContentConfigPromise: raw.ocIntent
      ? doc.getOptionalContentConfig({ intent: raw.ocIntent })
      : undefined,
  });
  const abort = () => task.cancel();
  options.signal?.addEventListener("abort", abort);
  try {
    await task.promise;
  } finally {
    options.signal?.removeEventListener("abort", abort);
  }
}

/** At most `n` tasks at once, in request order; aborted waiters never start. */
export function createLimiter(n: number) {
  let running = 0;
  const queue: (() => void)[] = [];
  const next = () => {
    if (running < n) queue.shift()?.();
  };
  return async <T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
    await new Promise<void>((resolve, reject) => {
      const start = () => {
        if (signal?.aborted) {
          reject(new DOMException("aborted", "AbortError"));
          next();
          return;
        }
        running += 1;
        resolve();
      };
      queue.push(start);
      next();
    });
    try {
      return await task();
    } finally {
      running -= 1;
      next();
    }
  };
}

export interface PdfSession {
  engine: string;
  pageCount: number;
  pages(): Promise<PdfPageFacts[]>;
  labels(): Promise<string[] | null>;
  metadata(): Promise<DocMetadata>;
  optionalContent(): Promise<OptionalContentSummary>;
  /** Plan and render page `index` into `canvas`; the region defaults to the page's base box. */
  render(
    index: number,
    request: Omit<RenderRequest, "view" | "userUnit" | "region"> & { region?: Rect },
    canvas: HTMLCanvasElement,
    options?: RenderOptions,
  ): Promise<RenderPlan>;
  close(): Promise<void>;
}

export class PlanRefused extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PlanRefused";
  }
}

/** Open bytes with local PDF.js. Rejects with a `PdfOpenError`. */
export async function openSession(data: Uint8Array, password?: string): Promise<PdfSession> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument(localDocumentParams(data, password));
  let doc: PDFDocumentProxy;
  try {
    doc = await task.promise;
  } catch (error) {
    await task.destroy();
    throw classifyOpenError(error);
  }
  const limit = createLimiter(3);
  // PDF.js refuses a second render into a canvas whose previous render (even a
  // cancelled one) has not settled, so renders into one canvas run in turn.
  const inflight = new WeakMap<HTMLCanvasElement, Promise<unknown>>();
  return {
    engine: `PDF.js ${pdfjs.version}`,
    pageCount: doc.numPages,
    pages: () => readPageFacts(doc),
    labels: () => readPageLabels(doc),
    metadata: () => readMetadata(doc),
    optionalContent: () => readOptionalContent(doc),
    render: (index, request, canvas, options = {}) => {
      const prior = inflight.get(canvas) ?? Promise.resolve();
      const job = prior.then(() =>
        limit(async () => {
          const page = await doc.getPage(index + 1);
          if (options.signal?.aborted) throw new DOMException("aborted", "AbortError");
          const view = [...page.view] as Rect;
          const planned = planRender({
            ...request,
            region: request.region ?? view,
            view,
            userUnit: page.userUnit,
          });
          if (!planned.ok) throw new PlanRefused(planned.code, planned.message);
          await renderPlanned(doc, page, planned.plan, canvas, options);
          return planned.plan;
        }, options.signal),
      );
      inflight.set(
        canvas,
        job.catch(() => undefined),
      );
      return job;
    },
    close: () => task.destroy(),
  };
}
