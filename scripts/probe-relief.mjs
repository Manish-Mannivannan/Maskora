#!/usr/bin/env node
/**
 * Raised UV as surface normals versus as a coating mesh (architecture §17.2),
 * measured in the real window on fixture R3.
 *
 *   npx tauri build --debug --no-bundle
 *   node scripts/probe-relief.mjs
 *
 * For each mode it records build time and memory, triangles, frame times, the
 * mesh's topology report per shape, and screen luminance under grazing light
 * at the rectangle's lit edge, its far edge, and the paper just past the far
 * edge (where only a real cast shadow can darken anything), each against the
 * print alone. Screenshots from the front and from a low angle go to
 * probe-out/relief/. Writes probe-out/relief-1.3.json. Measurements are
 * reported; the run fails only if the setup or a topology expectation fails.
 */
import { execFile } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { ROOT, openApp } from "./webdriver.mjs";

const run = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FIXTURES = join(ROOT, "tests", "fixtures", "pdf");
const expected = JSON.parse(readFileSync(join(FIXTURES, "R3.expected.json"), "utf8"));
const app = await openApp({ shotsDir: join(ROOT, "probe-out", "relief") });
const q = (script, ...args) => app.exec(script, ...args);
const click = async (css) => app.click(await app.find(css));
const choose = async (testid, text) => {
  const i = await q(
    `return [...document.querySelector('[data-testid="${testid}"]').options].findIndex(o => o.textContent.trim() === arguments[0]);`,
    text,
  );
  if (i < 0) throw new Error(`${testid} has no option ${text}`);
  await click(`[data-testid="${testid}"] option:nth-child(${i + 1})`);
  await sleep(150);
};
const waitUntil = async (what, script, ms = 30000) => {
  const until = Date.now() + ms;
  for (;;) {
    if (await q(script)) return;
    if (Date.now() > until) throw new Error(`timed out: ${what}`);
    await sleep(200);
  }
};
const settled = async () => {
  await sleep(600);
  await waitUntil(
    "3D settled",
    `const v = document.querySelector('[data-testid="viewport"]'); return v.dataset.busy === "false" && v.dataset.faces !== "";`,
  );
  await sleep(600);
};
const luminance = (pointMm, r = 3) =>
  q(
    `const p = window.__maskora.scene.project('front', arguments[0]);
    const gl = document.querySelector('[data-testid="viewport"] canvas');
    const k = gl.width / gl.clientWidth;
    const c = document.createElement('canvas'); c.width = gl.width; c.height = gl.height;
    const ctx = c.getContext('2d'); ctx.drawImage(gl, 0, 0);
    const r = arguments[1];
    const d = ctx.getImageData(Math.floor(p[0] * k) - r, Math.floor(p[1] * k) - r, 2 * r + 1, 2 * r + 1).data;
    const lum = []; for (let i = 0; i < d.length; i += 4) lum.push(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
    return { max: Math.max(...lum), min: Math.min(...lum), mean: lum.reduce((a, b) => a + b, 0) / lum.length };`,
    pointMm,
    r,
  );
const frames = () =>
  app.execAsync(`const done = arguments[arguments.length - 1];
    const t = []; let last = performance.now(); const end = last + 2000;
    const tick = (now) => { t.push(now - last); last = now; if (now < end) requestAnimationFrame(tick); else { t.sort((a, b) => a - b); done({ frames: t.length, median: t[t.length >> 1], p95: t[Math.floor(t.length * 0.95)] }); } };
    requestAnimationFrame(tick);`);

const report = { machine: process.env.COMPUTERNAME, fixture: "R3", modes: {} };
let failures = 0;
try {
  await app.waitFor('[data-testid="viewport"] canvas');
  await click('[data-testid="open-pdf"]');
  await run("powershell", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    join(ROOT, "scripts", "dialog.ps1"),
    "-Path",
    join(FIXTURES, "R3.pdf"),
  ]);
  await waitUntil(
    "R3 geometry",
    `return document.querySelector('[data-testid="geometry-status"]')?.dataset.status === "available";`,
  );
  await click('[data-testid="thumb"][data-index="1"]');
  await click('[data-testid="role-mask"]');
  await click('[data-testid="thumb"][data-index="0"]');
  await click('[data-testid="role-print"]');
  await click('[data-testid="layer"][data-mask="R3.pdf p. 2"]');
  await choose("layer-type", "Raised UV");
  await choose("layer-target", "R3.pdf p. 1");
  await click('[data-testid="finish-look"] summary');
  await click('[data-testid="view-3d"]');
  await click('[data-testid="light-grazing"]');
  await settled();

  // The right-hand dumbbell disc (centre 48, 70 mm; radius 6 mm) on clean paper, along y = 72 mm, clear of the neck;
  // light comes from the left. An 80 µm coating under 8° light casts a shadow about 0.6 mm long; 300 µm about 2.1 mm.
  const edgeX = Math.sqrt(36 - 4);
  const at = {
    lit: [48 - edgeX, 72],
    far: [48 + edgeX, 72],
    past03: [48 + edgeX + 0.3, 72],
    past10: [48 + edgeX + 1, 72],
    flat: [40, 76],
  };
  const measure = async () =>
    Object.fromEntries(await Promise.all(Object.entries(at).map(async ([k, p]) => [k, await luminance(p)])));

  report.shadowSetup = await q("return window.__maskora.scene.shadows();");
  console.log("shadows:", JSON.stringify(report.shadowSetup));
  await click('[data-testid="print-only"]');
  await click('[data-testid="camera-front"]');
  await sleep(800);
  report.printOnly = await measure();
  await app.screenshot("print-only-front");
  await click('[data-testid="print-only"]');

  const setHeight = async (um) => {
    const el = await app.find('[data-testid="recipe-raisedUv-heightUm"]');
    await app.clear(el);
    await app.type(el, String(um));
  };
  for (const [mode, label, heightUm] of [
    ["normals", "Surface normals (lighter, no shadows)", 80],
    ["mesh", "Coating geometry", 80],
    ["normals-300", "Surface normals (lighter, no shadows)", 300],
    ["mesh-300", "Coating geometry", 300],
  ]) {
    await setHeight(heightUm);
    await choose("raised-mode", label);
    await settled();
    await click('[data-testid="camera-front"]');
    await sleep(800);
    const face = (await q("return window.__maskora.scene.faces();"))[0];
    const lum = await measure();
    await app.screenshot(`${mode}-front-grazing`);
    // Close-up: OrbitControls zooms one fixed step per wheel event, so send many.
    const p = await q("return window.__maskora.scene.project('front', [48, 72]);");
    const r = await app.rect(await app.find('[data-testid="viewport"] canvas'));
    const tick = {
      type: "scroll",
      x: Math.round(r.x + p[0]),
      y: Math.round(r.y + p[1]),
      deltaX: 0,
      deltaY: -100,
      origin: "viewport",
      duration: 0,
    };
    await app.actions([{ type: "wheel", id: "w", actions: Array.from({ length: 35 }, () => tick) }]);
    await sleep(800);
    const close = await measure();
    await app.screenshot(`${mode}-closeup-grazing`);
    const fps = await frames();
    await click('[data-testid="camera-low"]');
    await sleep(800);
    await app.screenshot(`${mode}-low-grazing`);
    const memory = await q("return window.__maskora.scene.memory();");
    report.modes[mode] = { stats: face.stats, luminance: lum, closeup: close, frames: fps, memory };
    console.log(
      `${mode}: build ${face.stats.ms.toFixed(0)} ms, ${(face.stats.bytes / 1048576).toFixed(1)} MiB, ${face.stats.triangles} triangles; ` +
        `lit ${lum.lit.max.toFixed(0)}, far ${lum.far.min.toFixed(0)}, past +0.3 ${lum.past03.min.toFixed(0)}, +1.0 ${lum.past10.min.toFixed(0)} ` +
        `(print only ${report.printOnly.lit.max.toFixed(0)}/${report.printOnly.far.min.toFixed(0)}/${report.printOnly.past03.min.toFixed(0)}/${report.printOnly.past10.min.toFixed(0)}); ` +
        `frames median ${fps.median.toFixed(1)} ms, p95 ${fps.p95.toFixed(1)} ms
` +
        `   close-up: lit ${close.lit.max.toFixed(0)}, far ${close.far.min.toFixed(0)}, past +0.3 ${close.past03.min.toFixed(0)}, +1.0 ${close.past10.min.toFixed(0)}, flat ${close.flat.mean.toFixed(0)}`,
    );
  }

  // Topology, largest shape first: rectangle, ring, dumbbell, wide stroke, fine stroke.
  const shapes = [...report.modes.mesh.stats.shapes].sort((a, b) => b.pixels - a.pixels);
  const names = ["rectangle", "ring", "dumbbell", "strokeWide", "strokeFine"];
  report.topology = shapes.map((s, i) => ({
    name: names[i],
    ...s,
    expectedPlateaus: expected.shapes[names[i]]?.plateaus,
  }));
  for (const t of report.topology) {
    const ok = t.plateaus === t.expectedPlateaus && t.reachedUm > 0;
    if (!ok) failures += 1;
    console.log(
      `  ${ok ? "ok  " : "FAIL"} ${t.name}: ${t.plateaus} top(s) (expected ${t.expectedPlateaus}), max inset ${t.maxInsetMm.toFixed(3)} mm, reaches ${t.reachedUm.toFixed(0)} µm`,
    );
  }
  if (shapes.length !== 5) {
    failures += 1;
    console.log(`  FAIL ${shapes.length} shapes, expected 5`);
  }

  // R4: a detailed mask under the triangle budget, repeated edits and page switches (coating geometry, the default).
  const r4 = JSON.parse(readFileSync(join(FIXTURES, "R4.expected.json"), "utf8"));
  await choose("raised-mode", "Coating geometry");
  await click('[data-testid="open-pdf"]');
  await run("powershell", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    join(ROOT, "scripts", "dialog.ps1"),
    "-Path",
    join(FIXTURES, "R4.pdf"),
  ]);
  await waitUntil(
    "R4 added and read",
    `return document.querySelector('[data-testid="source"][data-name="R4.pdf"] [data-testid="geometry-status"]')?.dataset.status === "available";`,
  );
  const thumb = (i) => `[data-testid="thumb"][data-source="R4.pdf"][data-index="${i}"]`;
  await click(thumb(1));
  await click('[data-testid="role-mask"]');
  await click(thumb(0));
  await click('[data-testid="role-print"]');
  await click('[data-testid="layer"][data-mask="R4.pdf p. 2"]');
  await choose("layer-type", "Raised UV");
  await choose("layer-target", "R4.pdf p. 1");
  await click(thumb(0));
  /** Wait until the front face's relief is a built mesh matching `heightUm`. */
  const meshReady = async (heightUm) => {
    await settled();
    const until = Date.now() + 60000;
    for (;;) {
      const s = (await q("return window.__maskora.scene.faces();"))[0]?.stats;
      if (s && s.profile.heightUm === heightUm && (s.mode === "mesh" || s.fallback)) return s;
      if (Date.now() > until) throw new Error(`no mesh for ${heightUm} µm: ${JSON.stringify(s)}`);
      await sleep(200);
    }
  };
  const setHeightNow = async (um) => {
    const el = await app.find('[data-testid="recipe-raisedUv-heightUm"]');
    await app.clear(el);
    await app.type(el, String(um));
  };
  await setHeightNow(80);
  const first = await meshReady(80);
  const detail = {
    estimated: first.estimated,
    step: first.step,
    triangles: first.triangles,
    vertices: first.vertices,
    bytes: first.bytes,
    buildMs: first.ms,
    shapes: first.shapes.length,
    expectedShapes: r4.shapes,
    fallback: first.fallback ?? null,
  };
  const keptAll = detail.shapes === r4.shapes || detail.fallback !== null;
  if (!keptAll) failures += 1;
  console.log(
    `${keptAll ? "  ok  " : "  FAIL"} R4 detailed mask: estimated ${Math.round(detail.estimated).toLocaleString("en")} triangles at full resolution → step ${detail.step}, ` +
      `${detail.triangles.toLocaleString("en")} triangles, ${(detail.bytes / 1048576).toFixed(1)} MiB, built in ${detail.buildMs.toFixed(0)} ms; ` +
      `${detail.shapes} of ${r4.shapes} shapes kept${detail.fallback ? `; fell back: ${detail.fallback}` : ""}`,
  );
  await app.screenshot("r4-detailed");

  // Repeated edits, typed without waiting: only the last height may be built and shown.
  const memEdits = await q("return window.__maskora.scene.memory();");
  for (const um of [60, 90, 120, 150, 180, 100]) await setHeightNow(um);
  const afterEdits = await meshReady(100);
  const memAfterEdits = await q("return window.__maskora.scene.memory();");
  const editsOk =
    afterEdits.profile.heightUm === 100 &&
    memAfterEdits.geometries <= memEdits.geometries &&
    memAfterEdits.textures <= memEdits.textures;
  if (!editsOk) failures += 1;
  console.log(
    `${editsOk ? "  ok  " : "FAIL "} six rapid height edits: final mesh built at ${afterEdits.profile.heightUm} µm; memory ${JSON.stringify(memEdits)} → ${JSON.stringify(memAfterEdits)}`,
  );

  // Page switches: the coated page and a plain one, ten times.
  const memSwitch = await q("return window.__maskora.scene.memory();");
  const t0 = Date.now();
  for (let k = 0; k < 10; k += 1) {
    await click(thumb(k % 2 === 0 ? 2 : 0));
    await settled();
  }
  const back = await meshReady(100);
  const memAfterSwitch = await q("return window.__maskora.scene.memory();");
  const switchOk =
    back.triangles === afterEdits.triangles &&
    memAfterSwitch.geometries <= memSwitch.geometries &&
    memAfterSwitch.textures <= memSwitch.textures;
  if (!switchOk) failures += 1;
  console.log(
    `${switchOk ? "  ok  " : "FAIL "} ten page switches (${((Date.now() - t0) / 10000).toFixed(1)} s each, including waits): same mesh on return (${back.triangles.toLocaleString("en")} triangles); memory ${JSON.stringify(memSwitch)} → ${JSON.stringify(memAfterSwitch)}`,
  );
  report.detailed = {
    ...detail,
    edits: { memEdits, memAfterEdits },
    switches: { memSwitch, memAfterSwitch },
  };
} catch (error) {
  console.error(`  FAIL ${error.stack ?? error}`);
  failures += 1;
} finally {
  await app.close();
  report.failures = failures;
  writeFileSync(join(ROOT, "probe-out", "relief-1.3.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = failures ? 1 : 0;
}
