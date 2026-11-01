#!/usr/bin/env node
/**
 * Look at a real production PDF in the built app (plan 2.5): every page drawn
 * at its trim size, with its facts and timings, as screenshots to read.
 *
 *   node scripts/probe-production.mjs "<path to a local PDF>" [--map "5:raisedUv:1,6:uv:1"]
 *
 * With --map (mask page:finish:target page, 1-based), it also maps the finishes
 * and measures them: registration warnings per printed page, the raised-UV
 * coating against its budget, frame times with the coating and during a
 * normal-map build, and still exports at 3,840 and 8,192 px.
 *
 * The file is only read; its digest is checked before and after. The app's
 * own data files are set aside and restored, as in the smoke. Output:
 * probe-out/production/<time>/ (report.json and screenshots).
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { asideAppData } from "./smoke-project.mjs";
import { ROOT, openApp } from "./webdriver.mjs";

const file = process.argv[2];
const mapArg = process.argv.indexOf("--map");
const map =
  mapArg > 0
    ? process.argv[mapArg + 1].split(",").map((m) => {
        const [mask, finish, target] = m.split(":");
        return { mask: Number(mask), finish, target: Number(target) };
      })
    : [];
if (!file) throw new Error("usage: node scripts/probe-production.mjs <pdf>");
const run = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = () => createHash("sha256").update(readFileSync(file)).digest("hex");
const out = join(ROOT, "probe-out", "production", new Date().toISOString().replace(/[:.]/g, "-"));
mkdirSync(out, { recursive: true });
const before = sha();
const recovery = asideAppData("recovery.json");
const approvals = asideAppData("authorized-sources.json");
const name = basename(file);
const report = { file: name, sha256: before, pages: [] };
let app;
try {
  app = await openApp();
} catch (error) {
  // A launch that fails must still put the set-aside files back.
  recovery.restore();
  approvals.restore();
  throw error;
}
try {
  const q = (script, ...args) => app.exec(script, ...args);
  const until = async (what, script, ms = 120000) => {
    const end = Date.now() + ms;
    for (;;) {
      if (await q(script)) return;
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
      await sleep(250);
    }
  };
  await app.waitFor('[data-testid="viewport"] canvas');
  const t0 = Date.now();
  await app.click(await app.find('[data-testid="open-pdf"]'));
  await run("powershell", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    join(ROOT, "scripts", "dialog.ps1"),
    "-Path",
    file,
  ]);
  await until(
    "read",
    `return document.querySelector('[data-testid="geometry-status"]')?.dataset.status === "available";`,
  );
  report.openMs = Date.now() - t0;
  const pages = await q(`return document.querySelectorAll('[data-testid="thumb"]').length;`);
  await until(
    "thumbnails",
    `return document.querySelectorAll('[data-testid="thumb"][data-state="rendered"]').length === ${pages};`,
  );
  report.thumbnailsMs = Date.now() - t0;
  await app.screenshot("production-pages");
  await app.click(await app.find('[data-testid="view-3d"]'));
  for (let i = 0; i < pages; i += 1) {
    const s = Date.now();
    await app.click(await app.find(`[data-testid="thumb"][data-index="${i}"]`));
    await sleep(300);
    await until(
      `page ${i + 1}`,
      `const v = document.querySelector('[data-testid="viewport"]'); return v.dataset.busy === "false" && v.dataset.faces !== "";`,
    );
    await sleep(500);
    const face = (await q("return window.__maskora.scene.faces();")).find((f) => f.name === "front");
    report.pages.push({ page: i + 1, ms: Date.now() - s, sizeMm: face?.sizeMm, digest: face?.digest });
    await app.screenshot(`production-page-${i + 1}`);
  }
  if (map.length) await measureFinishes();
  report.memory = await q("return window.__maskora.scene.memory();");

  async function measureFinishes() {
    const click = async (testid) => app.click(await app.find(`[data-testid="${testid}"]`));
    const choose = async (testid, text) => {
      const i = await q(
        `return [...document.querySelector('[data-testid="${testid}"]').options].findIndex(o => o.textContent.trim() === arguments[0]);`,
        text,
      );
      if (i < 0) throw new Error(`${testid} has no option ${text}`);
      await app.click(await app.find(`[data-testid="${testid}"] option:nth-child(${i + 1})`));
      await sleep(150);
    };
    const thumb = (n) => app.find(`[data-testid="thumb"][data-index="${n - 1}"]`);
    const frames = (ms = 3000) =>
      app.execAsync(`const done = arguments[arguments.length - 1];
        const t = []; let last = performance.now(); const end = last + ${ms};
        const tick = (now) => { t.push(now - last); last = now; if (now < end) requestAnimationFrame(tick); else { t.sort((a, b) => a - b); done({ frames: t.length, median: t[t.length >> 1], p95: t[Math.floor(t.length * 0.95)], worst: t.at(-1) }); } };
        requestAnimationFrame(tick);`);
    const targets = [...new Set(map.map((m) => m.target))];
    for (const t of targets) {
      await app.click(await thumb(t));
      await click("role-print");
    }
    for (const m of map) {
      await app.click(await thumb(m.mask));
      await click("role-mask");
    }
    for (const m of map) {
      await app.click(await app.find(`[data-testid="layer"][data-mask="${name} p. ${m.mask}"]`));
      await choose("layer-type", m.finish === "raisedUv" ? "Raised UV" : "Ordinary UV");
      await choose("layer-target", `${name} p. ${m.target}`);
    }
    // Registration of each printed page.
    await click("view-registration");
    report.registration = [];
    for (const t of targets) {
      const s = Date.now();
      await choose("registration-surface", `${name} p. ${t}`);
      await sleep(500);
      await until(
        "registered",
        `return document.querySelector('[data-testid="registration"]')?.dataset.state === "ready";`,
      );
      const warnings = await q(
        `return [...document.querySelectorAll('[data-testid="registration-warnings"] li')].map(li => li.dataset.code + ": " + li.textContent.trim());`,
      );
      const digest = await q(
        `return document.querySelector('[data-testid="registration-page"]')?.dataset.digest;`,
      );
      report.registration.push({ page: t, ms: Date.now() - s, digest, warnings });
      await app.screenshot(`production-registration-p${t}`);
    }
    // The raised-UV page in 3D: coating geometry against its budget.
    const raised = map.find((m) => m.finish === "raisedUv");
    if (!raised) return;
    await click("view-3d");
    await choose("slot-front", `${name} p. ${raised.target}`);
    const started = Date.now();
    await until(
      "coating",
      `const v = document.querySelector('[data-testid="viewport"]'); const st = window.__maskora.scene.faces().find(f => f.name === "front")?.stats; return v.dataset.busy === "false" && !!st && st.mode === "mesh";`,
      180000,
    );
    const face = (await q("return window.__maskora.scene.faces();")).find((f) => f.name === "front");
    report.coating = {
      waitMs: Date.now() - started,
      buildMs: face.stats.ms,
      triangles: face.stats.triangles,
      estimated: face.stats.estimated,
      step: face.stats.step,
      shapes: face.stats.shapes.length,
      fallback: face.stats.fallback ?? null,
      mib: face.stats.bytes / 1048576,
      digest: face.digest,
    };
    await click("light-grazing");
    await click("camera-front");
    await sleep(1000);
    report.framesWithCoating = await frames();
    await app.screenshot("production-p1-grazing");
    await click("camera-low");
    await sleep(800);
    await app.screenshot("production-p1-low");
    await click("camera-front");
    // Normals: frames while the worker builds the map.
    await app.click(await app.find('[data-testid="finish-look"] summary'));
    const framesDuring = frames(3500);
    await choose("raised-mode", "Surface normals (lighter, no shadows)");
    report.framesDuringNormalsBuild = await framesDuring;
    await until(
      "normals",
      `const st = window.__maskora.scene.faces().find(f => f.name === "front")?.stats; return !!st && st.mode === "normals";`,
      60000,
    );
    report.normals = {
      buildMs: (await q("return window.__maskora.scene.faces();")).find((f) => f.name === "front").stats.ms,
    };
    await choose("raised-mode", "Coating geometry");
    await app.click(await app.find('[data-testid="finish-look"] summary'));
    await until(
      "coating again",
      `const st = window.__maskora.scene.faces().find(f => f.name === "front")?.stats; return !!st && st.mode === "mesh";`,
      180000,
    );
    // Still exports: the wait for geometry is part of the time.
    report.exports = [];
    await click("export-framing-fit");
    for (const side of [3840, 8192]) {
      const size = await app.find('[data-testid="export-size"]');
      await app.type(size, `\uE009a\uE000${side}`);
      const target = join(out, `export-${side}.png`);
      const t0 = Date.now();
      await click("export-png");
      await until(
        "rendered",
        `return ["writing", "failed"].includes(document.querySelector('[data-testid="export-status"]')?.dataset.kind);`,
        300000,
      );
      const renderMs = Date.now() - t0;
      const status = await q(`return document.querySelector('[data-testid="export-status"]').textContent;`);
      if (/failed/i.test(status)) {
        report.exports.push({ side, renderMs, status });
        continue;
      }
      await run("powershell", [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        join(ROOT, "scripts", "dialog.ps1"),
        "-Title",
        "Export PNG",
        "-Path",
        target,
      ]);
      await until(
        "saved",
        `return ["saved", "failed"].includes(document.querySelector('[data-testid="export-status"]')?.dataset.kind);`,
        120000,
      );
      report.exports.push({
        side,
        renderMs,
        status: await q(`return document.querySelector('[data-testid="export-status"]').textContent;`),
        relief: (await q("return window.__maskora.lastExport?.faces ?? [];")).map((f) => f.stats?.mode),
      });
    }
    report.maxRenderbuffer = await q(
      `const gl = document.querySelector('[data-testid="viewport"] canvas').getContext('webgl2'); return [gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), ...gl.getParameter(gl.MAX_VIEWPORT_DIMS)];`,
    );
  }
  report.heapMb = await q("return performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null;");
} finally {
  await app.close();
  recovery.restore();
  approvals.restore();
}
report.sha256After = sha();
report.unchanged = report.sha256After === before;
writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
