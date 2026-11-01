/**
 * Native smoke, step 2.2: resource budgets and failure handling, driven in the
 * built app. Called from smoke.mjs with its helpers.
 *
 * Proves:
 *   - a finish result evicted from the shared cache is rebuilt identically;
 *   - repeatedly closing and reopening a project leaves no textures or geometry behind;
 *   - a lost graphics context is stated, blocks export, and the view rebuilds when it returns;
 *   - the normal-map fallback builds off the main thread: frames keep coming while R4's builds;
 *   - a stopped export reads as stopped and leaves no offscreen canvas;
 *   - the diagnostics log ties an export to its finish jobs and source revisions, and holds
 *     no file name, path or password.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { readPng } from "./png.mjs";

export async function resourceChecks(c) {
  const { app, q, ok, expect, sleep, dialog, waitUntil, choose, settled3d, faces3d, FIXTURES, ROOT } = c;
  const click = async (testid) => app.click(await app.find(`[data-testid="${testid}"]`));
  const newProject = async () => {
    await click("project-new");
    await sleep(150);
    if (await q(`return !!document.querySelector('[data-testid="project-confirm"]');`))
      await click("project-new");
    await waitUntil(
      "empty project",
      `return document.querySelectorAll('[data-testid="source"]').length === 0;`,
    );
  };
  const addFixture = async (id) => {
    await click("open-pdf");
    await dialog(["-Path", join(FIXTURES, `${id}.pdf`)]);
    await waitUntil(
      `${id} read`,
      `const g = [...document.querySelectorAll('[data-testid="geometry-status"]')]; return g.length && g.every(e => e.dataset.status === "available");`,
      30000,
    );
  };
  const selectPage = async (i, source) => {
    await click(`thumb"][data-source="${source}"][data-index="${i}`);
    await settled3d();
  };
  const front = async () => (await faces3d()).find((f) => f.name === "front");
  const memory = () => q("return window.__maskora.scene.memory();");
  const log = () => q("return window.__maskora.diagnostics();");
  /** Frame intervals for `ms` while `during` runs. */
  const framesDuring = async (during, ms = 3000) => {
    await q(`window.__frames = []; let last = performance.now(); const end = last + ${ms};
      const tick = (now) => { window.__frames.push(now - last); last = now; if (now < end) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);`);
    await during();
    await sleep(ms + 200);
    const t = await q("return window.__frames.slice().sort((a, b) => a - b);");
    return {
      frames: t.length,
      median: t[t.length >> 1],
      p95: t[Math.floor(t.length * 0.95)],
      worst: t.at(-1),
    };
  };

  await newProject();
  await click("view-3d");

  // Cache eviction: five pages of D1 each need a finish job; the cache keeps three, so page 1's is gone and rebuilt.
  const mark = (await log()).length;
  await addFixture("D1");
  await selectPage(0, "D1.pdf");
  const first = await front();
  const job = (await log()).slice(mark).find((e) => e.kind === "finish" && e.outcome === "ready")?.job;
  for (const i of [1, 2, 3, 4]) await selectPage(i, "D1.pdf");
  const back = (await log()).length;
  await selectPage(0, "D1.pdf");
  const again = await front();
  const runs = (await log()).filter((e) => e.kind === "finish" && e.job === job && e.outcome === "ready");
  const rerun = (await log())
    .slice(back)
    .filter((e) => e.kind === "finish" && e.job === job && e.outcome === "ready");
  expect(!!job && again.digest === first.digest, `rebuilt ${again.digest} != ${first.digest} (job ${job})`);
  // Evicted, so coming back runs the job again; what it rebuilds is identical.
  expect(
    rerun.length === 1 && rerun[0].digest === first.digest,
    `job ${job} after the round trip: ${JSON.stringify(rerun)}`,
  );
  ok(
    "a finish result evicted from the shared cache is rebuilt by its job, identically",
    `${job}: ${first.digest}, built ${runs.length}×`,
  );

  // Repeated closing and reopening: nothing accumulates in GPU memory.
  await newProject();
  await addFixture("K1");
  await settled3d();
  const base = await memory();
  for (let i = 0; i < 5; i += 1) {
    await newProject();
    await addFixture("K1");
    await settled3d();
  }
  const after = await memory();
  expect(
    after.textures === base.textures && after.geometries === base.geometries,
    `${JSON.stringify(base)} → ${JSON.stringify(after)}`,
  );
  ok(
    "five New-and-reopen cycles leave textures and geometries as they were",
    `${JSON.stringify(base)} → ${JSON.stringify(after)}`,
  );

  // Graphics context lost and restored.
  const lum = () =>
    q(`const p = window.__maskora.scene.project("front", [50, 75]);
      const gl = document.querySelector('[data-testid="viewport"] canvas');
      const k = gl.width / gl.clientWidth;
      const c = document.createElement('canvas'); c.width = gl.width; c.height = gl.height;
      const ctx = c.getContext('2d'); ctx.drawImage(gl, 0, 0);
      const d = ctx.getImageData(Math.floor(p[0] * k), Math.floor(p[1] * k), 1, 1).data;
      return 0.2126 * d[0] + 0.7152 * d[1] + 0.0722 * d[2];`);
  const beforeLoss = { digest: (await front()).digest, lum: await lum() };
  await q(`window.__lose = document.querySelector('[data-testid="viewport"] canvas').getContext('webgl2').getExtension('WEBGL_lose_context');
    window.__lose.loseContext();`);
  await waitUntil(
    "context lost",
    `return document.querySelector('[data-testid="viewport"]').dataset.gl === "lost";`,
  );
  const note = await q(`return document.querySelector('[data-code="graphicsLost"]')?.textContent ?? "";`);
  await click("export-png");
  await sleep(300);
  const blocked = await q(
    `const e = document.querySelector('[data-testid="export-status"]'); return { kind: e.dataset.kind, text: e.textContent };`,
  );
  expect(/device reset/.test(note), `no note: ${note}`);
  expect(blocked.kind === "failed" && /graphicsLost/.test(blocked.text), JSON.stringify(blocked));
  ok("screenshot", await app.screenshot("40-graphics-lost"));
  await q("window.__lose.restoreContext();");
  await waitUntil(
    "context restored",
    `const v = document.querySelector('[data-testid="viewport"]'); return v.dataset.gl === "ok" && v.dataset.glGeneration === "1";`,
  );
  await settled3d();
  await sleep(1000);
  const afterLoss = { digest: (await front()).digest, lum: await lum() };
  expect(afterLoss.digest === beforeLoss.digest, `coverage ${afterLoss.digest} != ${beforeLoss.digest}`);
  expect(Math.abs(afterLoss.lum - beforeLoss.lum) < 6, `page centre ${beforeLoss.lum} → ${afterLoss.lum}`);
  ok(
    "a lost graphics context is stated and blocks export; on restore the view rebuilds with the same coverage and look",
    `${note.trim()} · export: ${blocked.kind} · centre luminance ${beforeLoss.lum.toFixed(0)} → ${afterLoss.lum.toFixed(0)}`,
  );
  ok("screenshot", await app.screenshot("41-graphics-restored"));

  // R4 in normals mode: the normal map builds in the worker, so frames keep coming during the build.
  await newProject();
  await addFixture("R4");
  await click(`thumb"][data-source="R4.pdf"][data-index="1`);
  await click("role-mask");
  await click(`thumb"][data-source="R4.pdf"][data-index="0`);
  await click("role-print");
  await click(`layer"][data-mask="R4.pdf p. 2`);
  await choose("layer-type", "Raised UV");
  await choose("layer-target", "R4.pdf p. 1");
  await click(`thumb"][data-source="R4.pdf"][data-index="0`);
  await app.click(await app.find('[data-testid="finish-look"] summary'));
  await choose("raised-mode", "Surface normals (lighter, no shadows)");
  await app.click(await app.find('[data-testid="finish-look"] summary'));
  await settled3d();
  await waitUntil(
    "R4 normals",
    `const s = window.__maskora.scene.faces()[0]?.stats; return !!s && s.mode === "normals";`,
    30000,
  );
  const height = await app.find('[data-testid="recipe-raisedUv-heightUm"]');
  const frames = await framesDuring(async () => {
    await app.click(await app.find('[data-testid="finish-look"] summary'));
    await app.type(height, "a150");
    await app.click(await app.find('[data-testid="finish-look"] summary'));
  });
  await waitUntil(
    "R4 normals at 150 µm",
    `const s = window.__maskora.scene.faces()[0]?.stats; return !!s && s.mode === "normals" && s.profile.heightUm === 150;`,
    30000,
  );
  const stats = (await faces3d())[0].stats;
  expect(frames.p95 < 50, `p95 frame ${frames.p95} ms while the normal map built`);
  ok(
    "R4's normal map rebuilds in the worker: the window keeps drawing",
    `build ${stats.ms.toFixed(0)} ms off-thread; frames during it median ${frames.median.toFixed(1)} ms, p95 ${frames.p95.toFixed(1)} ms, worst ${frames.worst.toFixed(1)} ms (${frames.frames} frames)`,
  );

  // A large still is rendered in tiles: shrunk by half it matches the same view rendered in one piece.
  const exportAt = async (side, path) => {
    const size = await app.find('[data-testid="export-size"]');
    await app.type(size, `a${side}`);
    await click("export-png");
    await waitUntil(
      "export rendered",
      `return ["writing", "failed"].includes(document.querySelector('[data-testid="export-status"]')?.dataset.kind);`,
      120000,
    );
    await dialog(["-Title", "Export PNG", "-Path", path]);
    await waitUntil(
      "export saved",
      `return ["saved", "failed"].includes(document.querySelector('[data-testid="export-status"]')?.dataset.kind);`,
      60000,
    );
    return q(`return document.querySelector('[data-testid="export-status"]').textContent;`);
  };
  await click("export-framing-fit");
  const tilesDir = join(ROOT, "probe-out", "smoke", `tiles-${Date.now()}`);
  mkdirSync(tilesDir, { recursive: true });
  const oneStatus = await exportAt(3000, join(tilesDir, "one.png"));
  const tiledStatus = await exportAt(6000, join(tilesDir, "tiled.png"));
  const one = readPng(join(tilesDir, "one.png"));
  const tiled = readPng(join(tilesDir, "tiled.png"));
  let diff = 0;
  let worstRow = 0;
  const rows = new Float64Array(one.height);
  const cols = new Float64Array(one.width);
  for (let y = 0; y < one.height; y += 1)
    for (let x = 0; x < one.width; x += 1) {
      const o = (y * one.width + x) * 4;
      let d = 0;
      for (let c = 0; c < 3; c += 1) {
        let sum = 0;
        for (const [dx, dy] of [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ])
          sum += tiled.pixels[((2 * y + dy) * tiled.width + 2 * x + dx) * 4 + c];
        d += Math.abs(sum / 4 - one.pixels[o + c]);
      }
      rows[y] += d / 3 / one.width;
      cols[x] += d / 3 / one.height;
      diff += d / 3;
    }
  for (let y = 0; y < one.height; y += 1) if (rows[y] > rows[worstRow]) worstRow = y;
  const mean = diff / (one.width * one.height);
  expect(
    /^Saved/.test(oneStatus) && /^Saved/.test(tiledStatus) && tiled.width === one.width * 2,
    `${oneStatus} / ${tiledStatus}`,
  );
  // Tiles meet at 4,096 px in the large still (row or column 2,048 of the small one): no seam may stand out.
  const seams = [one.height > 2048 ? rows[2048] : 0, one.width > 2048 ? cols[2048] : 0];
  const seam = Math.max(...seams);
  expect(mean < 3 && seam < 4 * Math.max(mean, 0.5), `mean ${mean}, seams ${seams}`);
  ok(
    `a 6,000 px still rendered in ${Math.ceil(tiled.width / 4096) * Math.ceil(tiled.height / 4096)} tiles matches the one-piece 3,000 px still when shrunk by half`,
    `${tiled.width} × ${tiled.height}; mean difference ${mean.toFixed(2)}/255, at the tile seams ${seams.map((v) => v.toFixed(2)).join("/")}, worst row ${worstRow} ${rows[worstRow].toFixed(2)}`,
  );

  // A stopped export: stopped, and its offscreen canvas is gone.
  await click("export-png");
  await sleep(50);
  const stop = await q(`return !!document.querySelector('[data-testid="export-cancel"]');`);
  if (stop) await click("export-cancel");
  await sleep(500);
  const stopped = await q(
    `return { kind: document.querySelector('[data-testid="export-status"]').dataset.kind, stage: document.querySelectorAll('[data-testid="export-stage"]').length };`,
  );
  expect(stop && stopped.kind === "cancelled" && stopped.stage === 0, JSON.stringify({ stop, ...stopped }));
  ok("a stopped export reads as stopped and leaves no offscreen canvas behind");

  // Diagnostics: the exports are traceable, and nothing private is in the log. One export is saved here first.
  const out = join(ROOT, "probe-out", "smoke", `diagnostics-${Date.now()}.png`);
  await click("export-png");
  await waitUntil(
    "export rendered",
    `return document.querySelector('[data-testid="export-status"]')?.dataset.kind === "writing";`,
    60000,
  );
  await dialog(["-Title", "Export PNG", "-Path", out]);
  await waitUntil(
    "export saved",
    `return document.querySelector('[data-testid="export-status"]')?.dataset.kind === "saved";`,
    30000,
  );
  const events = await log();
  const exports = events.filter((e) => e.kind === "export");
  const saved = events.filter((e) => e.kind === "export" && e.outcome === "saved");
  const finishDigests = new Set(
    events.filter((e) => e.kind === "finish" && e.outcome === "ready").map((e) => e.digest),
  );
  const traced = saved.filter((e) => e.digests.length && e.digests.every((d) => finishDigests.has(d)));
  const text = JSON.stringify(events);
  expect(
    saved.length > 0 && traced.length === saved.length,
    `untraced exports: ${JSON.stringify(saved.slice(-2))}`,
  );
  expect(
    !/\.pdf|\\\\|Users|smoke-wrong-pass|maskora\.json/i.test(text),
    "the log holds a name, path or password",
  );
  ok(
    "diagnostics: every saved export traces to the finish jobs that built its coverage; no file name, path or password is logged",
    `${events.length} events, ${exports.length} exports (${saved.length} saved), kinds ${[...new Set(events.map((e) => e.kind))].join("/")}`,
  );
  await newProject();
}
