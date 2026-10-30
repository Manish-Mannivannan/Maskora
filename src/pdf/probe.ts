/**
 * The Phase 0.4 compatibility probe, run inside the real WebView2 window.
 *
 * Built only when NEXT_PUBLIC_MASKORA_PROBE=1 at build time (see Workspace);
 * a normal build contains none of this. `scripts/probe-pdf.mjs` drives it over
 * WebDriver, passing fixture bytes in and reading facts and pixel samples
 * out. Expected positions are computed by the runner from the fixture
 * geometry, not from PDF.js, so a wrong engine transform cannot pass itself.
 *
 * Each render is also shown in an overlay so the runner's screenshots show
 * what was sampled.
 */
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist/types/src/display/api";
import { renderPlanned } from "./adapter";
import { loadPdfjs, openDocument } from "./pdfjs";
import { asRotation, planRender } from "./transform";

type Region = [number, number, number, number];

interface RenderOptions {
  intent?: "display" | "print";
  annotationMode?: number;
  background?: string;
  ocIntent?: "display" | "print";
}

const bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
let overlay: HTMLDivElement | null = null;

function show(id: string, canvas: HTMLCanvasElement) {
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.dataset.testid = "probe-overlay";
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      overflow: "auto",
      background: "#5a5f66",
      zIndex: "10",
      display: "flex",
      flexWrap: "wrap",
      gap: "8px",
      padding: "8px",
      alignContent: "flex-start",
    });
    document.body.appendChild(overlay);
  }
  const figure = document.createElement("figure");
  Object.assign(figure.style, { margin: "0", color: "#fff", font: "11px system-ui" });
  const copy = document.createElement("canvas");
  const maxSide = 220;
  const k = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
  copy.width = Math.max(1, Math.round(canvas.width * k));
  copy.height = Math.max(1, Math.round(canvas.height * k));
  copy.style.background = "repeating-conic-gradient(#ccc 0 25%, #fff 0 50%) 0 0 / 12px 12px";
  copy.getContext("2d")?.drawImage(canvas, 0, 0, copy.width, copy.height);
  const caption = document.createElement("figcaption");
  caption.textContent = id;
  figure.append(copy, caption);
  overlay.appendChild(figure);
}

async function withDocument<T>(b64: string, fn: (doc: PDFDocumentProxy) => Promise<T>, password?: string) {
  const opened = await openDocument(bytes(b64), password);
  try {
    return await fn(opened.document);
  } finally {
    await opened.close();
  }
}

/**
 * Render `region` of a page through the app's transform contract (planRender
 * + renderPlanned), so the coverage checks test the code the app uses. The
 * requested scale is in pixels per point; PDF.js-style, UserUnit multiplies it.
 */
async function renderRegion(
  doc: PDFDocumentProxy,
  page: PDFPageProxy,
  region: Region,
  scale: number,
  opts: RenderOptions,
) {
  const rotation = asRotation(page.rotate) ?? 0;
  const [w, h] =
    rotation % 180 === 0
      ? [region[2] - region[0], region[3] - region[1]]
      : [region[3] - region[1], region[2] - region[0]];
  const planned = planRender({
    view: [...page.view] as Region,
    region,
    rotation,
    userUnit: page.userUnit,
    purpose: "export",
    longestSidePx: Math.round(Math.max(w, h) * scale * page.userUnit),
    policy: {
      background: opts.background === "rgba(0,0,0,0)" ? "transparent" : "paper",
      annotations: "none",
    },
  });
  if (!planned.ok) throw new Error(planned.message);
  const canvas = document.createElement("canvas");
  const started = performance.now();
  const raw = opts.intent || opts.annotationMode !== undefined || opts.ocIntent ? opts : undefined;
  await renderPlanned(doc, page, planned.plan, canvas, raw ? { raw } : {});
  return { canvas, ms: performance.now() - started, viewportScale: planned.plan.pxPerUnit };
}

function sample(canvas: HTMLCanvasElement, points: [number, number][]) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  return points.map(([x, y]) => {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) return null;
    return Array.from(ctx.getImageData(px, py, 1, 1).data);
  });
}

const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

export const probe = {
  /** PDF.js's own view of each page: what the public API exposes. */
  async geometry(b64: string) {
    return withDocument(b64, async (doc) => {
      const pages = [];
      for (let i = 1; i <= doc.numPages; i += 1) {
        const page = await doc.getPage(i);
        const v = page.getViewport({ scale: 1 });
        pages.push({
          view: page.view,
          rotate: page.rotate,
          userUnit: page.userUnit,
          viewport1: [v.width, v.height],
        });
      }
      return pages;
    });
  },

  /** Render a region and return the pixels at the requested canvas points. */
  async renderAndSample(
    b64: string,
    pageIndex: number,
    region: Region,
    scale: number,
    points: [number, number][],
    opts: RenderOptions = {},
    label = "",
  ) {
    return withDocument(b64, async (doc) => {
      const page = await doc.getPage(pageIndex + 1);
      const { canvas, ms, viewportScale } = await renderRegion(doc, page, region, scale, opts);
      if (label) show(label, canvas);
      return { size: [canvas.width, canvas.height], viewportScale, ms, pixels: sample(canvas, points) };
    });
  },

  /** Open a document and report how it went: page count, or the error's name and code. */
  async open(b64: string, password?: string) {
    const started = performance.now();
    try {
      return await withDocument(
        b64,
        async (doc) => {
          const permissions = await doc.getPermissions();
          return {
            ok: true,
            pages: doc.numPages,
            permissions: permissions ? [...permissions] : null,
            ms: performance.now() - started,
          };
        },
        password,
      );
    } catch (error) {
      const e = error as { name?: string; code?: number; message?: string };
      return {
        ok: false,
        name: e.name,
        code: e.code ?? null,
        message: e.message,
        ms: performance.now() - started,
      };
    }
  },

  /** Time opening a document and rendering its pages as thumbnails `width` px wide. */
  async thumbnails(b64: string, width: number, limit = Infinity) {
    const t0 = performance.now();
    return withDocument(b64, async (doc) => {
      const opened = performance.now() - t0;
      let first = 0;
      const n = Math.min(doc.numPages, limit);
      for (let i = 1; i <= n; i += 1) {
        const page = await doc.getPage(i);
        const v = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: width / v.width });
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        await page.render({ canvas, viewport }).promise;
        page.cleanup();
        if (i === 1) first = performance.now() - t0;
      }
      return { pages: n, openMs: opened, firstThumbnailMs: first, allMs: performance.now() - t0 };
    });
  },

  /** Render page 1 at `width` px, `runs` times; median and max milliseconds. */
  async renderTimes(b64: string, width: number, runs = 5, label = "") {
    return withDocument(b64, async (doc) => {
      const page = await doc.getPage(1);
      const times = [];
      let last: HTMLCanvasElement | null = null;
      for (let r = 0; r < runs; r += 1) {
        const v = page.getViewport({ scale: 1 });
        const { canvas, ms } = await renderRegion(doc, page, page.view as Region, width / v.width, {});
        times.push(ms);
        last = canvas;
      }
      if (label && last) show(label, last);
      return { width, medianMs: median(times), maxMs: Math.max(...times), runs: times.map(Math.round) };
    });
  },

  /** Frame intervals (requestAnimationFrame) while a large page renders. */
  async framesDuringRender(b64: string, width: number) {
    const intervals: number[] = [];
    let running = true;
    let last = performance.now();
    const tick = (now: number) => {
      intervals.push(now - last);
      last = now;
      if (running) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    const result = await probe.renderTimes(b64, width, 1);
    running = false;
    const sorted = [...intervals].sort((a, b) => a - b);
    return {
      renderMs: result.medianMs,
      frames: intervals.length,
      medianFrameMs: median(intervals),
      p95FrameMs: sorted[Math.floor(sorted.length * 0.95)] ?? null,
      maxFrameMs: Math.max(...intervals),
    };
  },

  /** Render 50 pages in turn at `width` px, releasing each; JS heap before and after. */
  async pageSwitches(b64: string, width: number, count = 50) {
    const heap = () =>
      (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null;
    const before = heap();
    const result = await withDocument(b64, async (doc) => {
      for (let i = 0; i < count; i += 1) {
        const page = await doc.getPage((i % doc.numPages) + 1);
        const v = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: width / v.width });
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        await page.render({ canvas, viewport }).promise;
        canvas.width = 0;
        canvas.height = 0;
        page.cleanup();
      }
      return count;
    });
    await new Promise((r) => setTimeout(r, 500));
    return { switches: result, heapBefore: before, heapAfter: heap() };
  },

  /** WebGL limits: the reported maximum and the largest texture actually allocated and written. */
  async textures() {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2");
    if (!gl) return { webgl2: false };
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const max = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    const results: { size: number; ok: boolean; note?: string }[] = [];
    const tile = new Uint8Array(256 * 256 * 4).fill(200);
    for (const size of [4096, 8192, 12288, 16384].filter((s) => s <= max)) {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, size, size);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, size - 256, size - 256, 256, 256, gl.RGBA, gl.UNSIGNED_BYTE, tile);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      const out = new Uint8Array(4);
      gl.readPixels(size - 1, size - 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
      const err = gl.getError();
      const lost = gl.isContextLost();
      results.push({
        size,
        ok: err === gl.NO_ERROR && !lost && out[0] === 200,
        note: lost ? "context lost" : err ? `GL error ${err}` : undefined,
      });
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(fb);
      gl.deleteTexture(tex);
      if (lost) break;
    }
    return { webgl2: true, renderer, maxTextureSize: max, results };
  },

  /** Cancel a large render after `afterMs`, and destroy a document while it loads; how each ends. */
  async cancellation(renderB64: string, loadB64: string, afterMs = 20) {
    const outcome = async (p: Promise<unknown>) =>
      p.then(
        () => "completed",
        (e: { name?: string }) => e?.name ?? "error",
      );
    const render = await withDocument(renderB64, async (doc) => {
      const page = await doc.getPage(1);
      const v = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: 8000 / v.width });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const task = page.render({ canvas, viewport });
      const started = performance.now();
      setTimeout(() => task.cancel(), afterMs);
      const ended = await outcome(task.promise);
      return { ended, ms: performance.now() - started };
    });
    const pdfjs = await loadPdfjs();
    const { localDocumentParams } = await import("./pdfjs");
    const loading = pdfjs.getDocument(localDocumentParams(bytes(loadB64)));
    const started = performance.now();
    const settled = outcome(loading.promise);
    await loading.destroy();
    const load = { ended: await settled, ms: performance.now() - started };
    return { render, load };
  },

  async pdfjsVersion() {
    return (await loadPdfjs()).version;
  },
};

export function install() {
  (window as unknown as { __maskoraProbe: typeof probe }).__maskoraProbe = probe;
}
