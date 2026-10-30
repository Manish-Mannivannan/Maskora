#!/usr/bin/env node
/**
 * Native smoke: drive the built Maskora app in its real WebView2 window.
 *
 *   npx tauri build --debug --no-bundle   (embeds out/ and the production CSP)
 *   npm run smoke
 *
 * Proves, with real input events rather than synthetic DOM calls:
 *   - the static export loads and hydrates under the production CSP;
 *   - camera orbit, pan and zoom move the camera and not the light;
 *   - Move Light mode moves the light and not the camera; numeric fields edit it too;
 *   - the control panel resizes;
 *   - the native dialog authorizes a file whose bytes then reach PDF.js, and a
 *     cancelled dialog reads as cancelled;
 *   - with the UI bypassed, an unselected path, the dialog plugin and the old
 *     opener plugin are all refused;
 *   - nothing is requested from outside the app's origin, and an external fetch is blocked.
 *
 * Each check prints one line; screenshots land in probe-out/smoke/ and are
 * meant to be read. Exits 1 on the first failed check.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { ROOT, openApp } from "./webdriver.mjs";

const run = promisify(execFile);
const FIXTURES = join(ROOT, "tests", "fixtures", "pdf");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
function ok(name, detail) {
  passed += 1;
  console.log(`  ok   ${name}${detail ? ` — ${detail}` : ""}`);
}
function expect(condition, message) {
  if (!condition) throw new Error(message);
}

const app = await openApp();

const data = async (name) =>
  JSON.parse(await app.exec(`return document.querySelector('[data-testid="viewport"]').dataset.${name};`));
const canvasCentre = async () => {
  const r = await app.rect(await app.find('[data-testid="viewport"] canvas'));
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
};
const drag = async (from, dx, dy, button = 0) => {
  await app.actions([
    {
      type: "pointer",
      id: "mouse",
      parameters: { pointerType: "mouse" },
      actions: [
        { type: "pointerMove", x: from.x, y: from.y, origin: "viewport", duration: 0 },
        { type: "pointerDown", button },
        { type: "pointerMove", x: from.x + dx / 2, y: from.y + dy / 2, origin: "viewport", duration: 150 },
        { type: "pointerMove", x: from.x + dx, y: from.y + dy, origin: "viewport", duration: 150 },
        { type: "pointerUp", button },
      ],
    },
  ]);
  await app.releaseActions();
  await sleep(150);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const dialog = (args) =>
  run("powershell", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    join(ROOT, "scripts", "dialog.ps1"),
    ...args,
  ]);
const q = (script, ...args) => app.exec(script, ...args);
const status = async () => {
  const el = await app.find('[data-testid="doc-status"]');
  return { state: await app.attr(el, "data-state"), text: await app.text(el) };
};
/** Open a fixture through the real dialog and wait until it settles. */
/** Remove every source, so a scenario starts from an empty project. */
const clearSources = async () => {
  for (let i = 0; i < 20; i += 1) {
    const n = await q(`return document.querySelectorAll('[data-testid="remove-source"]').length;`);
    if (!n) return;
    await app.click(await app.find('[data-testid="remove-source"]'));
    await sleep(150);
  }
  throw new Error("sources could not be removed");
};
/** Add a fixture through the real dialog and wait until it settles; `keep` adds it beside the open ones. */
const pick = async (id, { keep = false } = {}) => {
  if (!keep) await clearSources();
  await app.click(await app.find('[data-testid="open-pdf"]'));
  await dialog(["-Path", join(FIXTURES, `${id}.pdf`)]);
  for (let i = 0; i < 120; i += 1) {
    const s = await status();
    if (!["selecting", "loading"].includes(s.state)) return s;
    await sleep(250);
  }
  throw new Error(`${id} did not finish opening`);
};
const waitUntil = async (what, script, timeoutMs = 20000) => {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = await q(script);
    if (v) return v;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await sleep(200);
  }
};
const diagnostics = () =>
  q(
    `return [...document.querySelectorAll('[data-testid="diagnostics"] li')].map(li => li.dataset.code + ":" + li.dataset.level);`,
  );
const boxOrigins = () =>
  q(
    `return Object.fromEntries([...document.querySelectorAll('[data-testid="box-table"] tbody tr')].map(r => [r.dataset.box, r.dataset.origin]));`,
  );
const selectThumb = async (index, source) => {
  const of = source ? `[data-source="${source}"]` : "";
  await app.click(await app.find(`[data-testid="thumb"]${of}[data-index="${index}"]`));
  await waitUntil(
    `inspector page ${index}`,
    `const i = document.querySelector('[data-testid="inspector"]'); return i?.dataset.page === "${index}"${source ? ` && i.dataset.source === "${source}"` : ""};`,
  );
};
/** Pick an option of a select by its visible text, with a real click on the option. */
const choose = async (testid, text) => {
  const i = await q(
    `return [...document.querySelector('[data-testid="${testid}"]').options].findIndex(o => o.textContent.trim() === arguments[0]);`,
    text,
  );
  expect(i >= 0, `${testid} has no option "${text}"`);
  await app.click(await app.find(`[data-testid="${testid}"] option:nth-child(${i + 1})`));
  await sleep(150);
};
const selectLayer = async (mask) => {
  await app.click(await app.find(`[data-testid="layer"][data-mask="${mask}"]`));
  await app.waitFor('[data-testid="layer-editor"]');
};
/** Wait for the registration view to finish a fresh run after a change. */
const registered = async () => {
  await sleep(500);
  await waitUntil(
    "registration rendered",
    `return document.querySelector('[data-testid="registration"]')?.dataset.state === "ready";`,
    30000,
  );
};
/**
 * The overlay colour at trim-relative millimetre positions, located from the
 * view's own render plan with the PDF.js viewport convention.
 */
const overlayAt = (pointsMm) =>
  q(
    `const root = document.querySelector('[data-testid="registration-page"]');
    const plan = JSON.parse(root.dataset.plan), anchor = JSON.parse(root.dataset.anchor);
    const k = Number(root.dataset.userUnit) * 25.4 / 72;
    const ctx = document.querySelector('[data-testid="overlay"]').getContext('2d', { willReadFrequently: true });
    const base = ([x, y]) => {
      const [l, b, r, t] = plan.view, s = plan.pxPerUnit;
      return plan.rotation === 0 ? [(x - l) * s, (t - y) * s] : plan.rotation === 90 ? [(y - b) * s, (x - l) * s]
        : plan.rotation === 180 ? [(r - x) * s, (y - b) * s] : [(t - y) * s, (r - x) * s];
    };
    return arguments[0].map(([mx, my]) => {
      const [dx, dy] = base([anchor[0] + mx / k, anchor[1] + my / k]);
      const px = ctx.getImageData(Math.round(dx + plan.offsetX), Math.round(dy + plan.offsetY), 1, 1).data;
      return px[3] === 0 ? "none" : px[0] > 200 && px[2] > 150 ? "raisedUv" : px[2] > 200 && px[0] < 60 ? "uv" : "other:" + [...px];
    });`,
    pointsMm,
  );
const registrationWarnings = () =>
  q(
    `return [...document.querySelectorAll('[data-testid="registration-warnings"] li')].map(li => li.dataset.code + "@" + li.dataset.layer);`,
  );
const distance = (p) => Math.hypot(...p);

try {
  console.log(`smoke: ${app.where.app} on WebView2 ${app.where.version}`);

  // Load and hydrate.
  await app.waitFor('[data-testid="viewport"] canvas');
  const origin = await app.exec("return location.origin;");
  expect(origin === "http://tauri.localhost", `unexpected origin ${origin}`);
  ok("static export loaded and the viewport canvas exists", origin);
  // Tauri delivers the policy as a response header on its own protocol, not a meta tag.
  const csp = await app.execAsync(`
    const done = arguments[arguments.length - 1];
    fetch(location.href).then((r) => done(r.headers.get("content-security-policy")), (e) => done("error: " + e.message));`);
  await sleep(1500);
  const violationsAtStart = await app.exec("return window.__maskora?.cspViolations ?? null;");
  expect(Array.isArray(violationsAtStart), "violation recorder missing: the page did not hydrate");
  expect(violationsAtStart.length === 0, `CSP violations at startup: ${violationsAtStart.join("; ")}`);
  expect(
    typeof csp === "string" && csp.includes("default-src 'self'") && /script-src[^;]*'sha256-/.test(csp),
    `the production CSP with hashed inline scripts is not in effect: ${csp}`,
  );
  ok("hydrated with no CSP violations under the production policy", csp);
  ok("screenshot", await app.screenshot("02-shell"));

  // Camera: orbit, zoom, pan — the light must not move.
  const light0 = await data("light");
  const cam0 = await data("camera");
  const centre = await canvasCentre();
  await drag(centre, 160, 0);
  const cam1 = await data("camera");
  expect(!same(cam0, cam1), "orbit drag did not move the camera");
  expect(same(light0, await data("light")), "orbit drag moved the light");
  ok("left-drag orbits the camera, light unchanged", `${JSON.stringify(cam0)} → ${JSON.stringify(cam1)}`);

  await app.actions([
    {
      type: "wheel",
      id: "wheel",
      actions: [
        {
          type: "scroll",
          x: centre.x,
          y: centre.y,
          deltaX: 0,
          deltaY: -400,
          origin: "viewport",
          duration: 100,
        },
      ],
    },
  ]);
  await sleep(300);
  const cam2 = await data("camera");
  expect(
    distance(cam2) < distance(cam1) - 0.01,
    `wheel did not zoom in (${distance(cam1)} → ${distance(cam2)})`,
  );
  ok("wheel zooms", `distance ${distance(cam1).toFixed(3)} → ${distance(cam2).toFixed(3)} m`);

  await drag(centre, 0, 120, 2);
  const cam3 = await data("camera");
  expect(!same(cam2, cam3), "right-drag did not pan");
  ok("right-drag pans", `${JSON.stringify(cam2)} → ${JSON.stringify(cam3)}`);
  expect(same(light0, await data("light")), "camera gestures moved the light");

  // Move Light: drag edits the light, never the camera.
  await app.click(await app.find('[data-testid="mode-light"]'));
  await sleep(200);
  const camBefore = await data("camera");
  await drag(centre, 100, -60);
  const light1 = await data("light");
  expect(!same(light0, light1), "Move Light drag did not move the light");
  expect(same(camBefore, await data("camera")), "Move Light drag moved the camera");
  ok(
    "Move Light drag moves the light, camera unchanged",
    `${JSON.stringify(light0)} → ${JSON.stringify(light1)}`,
  );
  ok("screenshot", await app.screenshot("03-light-moved"));

  const az = await app.find('[data-testid="azimuth"]');
  await app.clear(az);
  await app.type(az, "200");
  await sleep(200);
  expect((await data("light")).azimuth === 200, "typing an azimuth did not set the light");
  ok("numeric azimuth field sets the light", "200°");
  await app.click(await app.find('[data-testid="mode-camera"]'));

  // Resizable panel.
  const panel = await app.find('[data-testid="panel"]');
  const w0 = (await app.rect(panel)).width;
  const handle = await app.rect(await app.find('[data-testid="resize-handle"]'));
  await drag({ x: Math.round(handle.x + handle.width / 2), y: Math.round(handle.y + 200) }, 120, 0);
  const w1 = (await app.rect(panel)).width;
  expect(Math.abs(w1 - w0 - 120) <= 2, `panel width ${w0} → ${w1}, expected +120`);
  ok("panel resizes by drag", `${w0} → ${w1} px`);

  // Native selection: cancel, then documents that exercise every state.
  await app.click(await app.find('[data-testid="open-pdf"]'));
  await dialog(["-Cancel"]);
  await app.waitFor('[data-testid="doc-status"][data-state="cancelled"]');
  ok("a cancelled dialog reads as cancelled", (await status()).text);

  // D1: mixed sizes and labels, identity, both readers, progressive thumbnails.
  const d1 = await pick("D1");
  expect(d1.state === "added", `D1: ${JSON.stringify(d1)}`);
  await waitUntil(
    "D1 thumbnails",
    `return document.querySelectorAll('[data-testid="thumb"][data-state="rendered"]').length === 5;`,
  );
  await waitUntil(
    "D1 geometry",
    `return document.querySelector('[data-testid="geometry-status"]')?.dataset.status === "available";`,
  );
  const want = JSON.parse(readFileSync(join(FIXTURES, "D1.expected.json"), "utf8"));
  const labels = await q(
    `return [...document.querySelectorAll('[data-testid="thumb-label"]')].map(e => e.textContent);`,
  );
  expect(
    labels.every((l, i) => l.startsWith(`${want.labels[i]} · p. ${i + 1}/5`)),
    `labels ${JSON.stringify(labels)}`,
  );
  const sizes = await q(`return [...document.querySelectorAll('.thumb-size')].map(e => e.textContent);`);
  want.pages.forEach((p, i) => {
    const text = `${p.trimSizeMm[0].toFixed(1)} × ${p.trimSizeMm[1].toFixed(1)} mm`;
    expect(sizes[i].startsWith(text), `page ${i} size ${sizes[i]}, expected ${text}`);
  });
  expect(sizes[3].includes("90°"), `page 4 rotation missing: ${sizes[3]}`);
  const digest = await app.attr(await app.find('[data-testid="digest"]'), "title");
  const fileDigest = createHash("sha256")
    .update(readFileSync(join(FIXTURES, "D1.pdf")))
    .digest("hex");
  expect(digest === fileDigest, `digest ${digest} != ${fileDigest}`);
  const d1Diagnostics = await diagnostics();
  expect(d1Diagnostics.length === 0, `unexpected diagnostics ${d1Diagnostics}`);
  ok("D1: 5 progressive thumbnails with labels i, ii, 1, 2, A-1 and trim sizes in mm", sizes.join(" | "));
  const overflow = await q(`
    return [...document.querySelectorAll('.thumb-frame')].filter(f => {
      const a = f.getBoundingClientRect(), b = f.querySelector('canvas').getBoundingClientRect();
      return b.width > a.width + 0.5 || b.height > a.height + 0.5;
    }).length;`);
  expect(overflow === 0, `${overflow} thumbnails overflow their frame`);
  // The first page's preview starts before native geometry and is replaced when it arrives.
  await app.waitFor(
    '[data-testid="inspector"][data-page="0"] [data-testid="box-preview"][data-state="rendered"]',
  );
  ok("every thumbnail fits its frame; the first page's preview survives the arrival of native geometry");
  ok("source identity is the file's SHA-256; the native reader agrees with PDF.js", digest.slice(0, 16));

  const metaBefore = await app.attr(await app.find('[data-testid="metadata-status"]'), "data-status");
  expect(metaBefore === "notRequested", `metadata read before it was asked for: ${metaBefore}`);
  await app.click(await app.find('[data-testid="doc-details"] summary'));
  await app.waitFor('[data-testid="metadata"][data-status="available"]');
  const title = await q(`return document.querySelector('[data-field="Title"] dd').textContent;`);
  const xmp = await q(`return document.querySelector('[data-testid="xmp"] .cap').dataset.status;`);
  expect(title === want.info.Title && xmp === "unsupported", `title ${title}, xmp ${xmp}`);
  ok("document details are read only when opened; XMP shows as unsupported, not absent", `Title "${title}"`);
  ok("screenshot", await app.screenshot("04-d1-document"));

  await selectThumb(4);
  await app.waitFor('[data-testid="box-preview"][data-state="rendered"]');
  const a1 = await boxOrigins();
  expect(
    a1.TrimBox === "explicit" && a1.BleedBox === "explicit" && a1.CropBox === "default",
    JSON.stringify(a1),
  );
  ok(
    "page A-1: stated trim and bleed, defaulted crop, preview rendered with boxes outlined",
    JSON.stringify(a1),
  );
  ok("screenshot", await app.screenshot("05-d1-inspector"));
  await selectThumb(3);
  const rot = await app.text(await app.find('[data-testid="rotation"]'));
  expect(rot.startsWith("90°"), rot);
  ok("page 2 (Letter) shows its 90° rotation", rot);

  // G2: an override replaces the effective box and keeps the source fact.
  expect((await pick("G2")).state === "added", "G2 did not open");
  await waitUntil(
    "G2 boxes",
    `return document.querySelector('[data-testid="box-table"] tr[data-box="TrimBox"]')?.dataset.origin === "default";`,
  );
  const inset = await app.find('[data-testid="trim-inset"]');
  await app.clear(inset);
  await app.type(inset, "3");
  await app.click(await app.find('[data-testid="set-trim"]'));
  await waitUntil(
    "trim override",
    `return document.querySelector('tr[data-box="TrimBox"]').dataset.origin === "override";`,
  );
  const fact = await app.text(await app.find('[data-testid="source-fact"]'));
  expect(fact.includes("format default"), `source fact lost: ${fact}`);
  ok("a manual trim replaces the effective TrimBox; the file's default stays listed", fact.trim());
  ok("screenshot", await app.screenshot("06-g2-override"));
  await app.click(await app.find('[data-testid="clear-overrides"]'));
  await waitUntil(
    "override cleared",
    `return document.querySelector('tr[data-box="TrimBox"]').dataset.origin === "default";`,
  );
  ok("clearing the override restores the source fact");

  // G5: an invalid rotation is diagnosed and shown as invalid.
  expect((await pick("G5")).state === "added", "G5 did not open");
  await waitUntil("G5 diagnostics", `return !!document.querySelector('[data-code="invalidRotation"]');`);
  await selectThumb(3);
  const invalid = await app.attr(await app.find('[data-testid="rotation"]'), "data-invalid");
  expect(invalid === "true", "Rotate 45 not shown as invalid");
  ok(
    "Rotate 45 is diagnosed and shown as invalid, not as 0°",
    await app.text(await app.find('[data-testid="rotation"]')),
  );

  // O1: layers that change for printing produce a visible limitation.
  expect((await pick("O1")).state === "added", "O1 did not open");
  await waitUntil(
    "O1 limitation",
    `return !!document.querySelector('[data-code="printLayersDiffer"][data-level="limitation"]');`,
  );
  ok("layers that change for printing show a limitation", (await diagnostics()).join(", "));
  ok("screenshot", await app.screenshot("07-o1-limitation"));

  // E1b: password needed, wrong, right; no password stays in the page.
  const e1 = await pick("E1b");
  expect(e1.state === "password" && e1.text.includes("needs a password"), JSON.stringify(e1));
  await app.type(await app.find('[data-testid="password"]'), "smoke-wrong-pass");
  await app.click(await app.find('[data-testid="password-submit"]'));
  await waitUntil(
    "wrong password",
    `return document.querySelector('form.password')?.dataset.attempt === "wrong";`,
  );
  const wrong = (await status()).text;
  await app.type(await app.find('[data-testid="password"]'), "maskora");
  await app.click(await app.find('[data-testid="password-submit"]'));
  await app.waitFor('[data-testid="doc-status"][data-state="added"]');
  const leaked = await q(
    `const html = document.documentElement.outerHTML; return html.includes("smoke-wrong-pass") || html.includes('value="maskora"');`,
  );
  expect(!leaked, "a password appears in the page");
  ok("E1b: needed and wrong read differently, the right password opens it, none stays in the page", wrong);

  // Failures: not a PDF; a damaged file PDF.js recovers but the native reader cannot.
  const x1c = await pick("X1c");
  expect(x1c.state === "failed" && x1c.text.includes("invalidPdf"), JSON.stringify(x1c));
  ok("a file that is not a PDF fails by name", x1c.text);
  expect((await pick("X1b")).state === "added", "X1b did not open");
  await waitUntil(
    "X1b native failure",
    `return document.querySelector('[data-testid="geometry-status"]')?.dataset.status === "failed";`,
  );
  const x1b = await app.text(await app.find('[data-testid="geometry-failed"]'));
  expect(x1b.includes("pageTreeUnreadable"), x1b);
  const x1bSize = await q(`return document.querySelector('.thumb-size').textContent;`);
  expect(x1bSize.startsWith("size unknown"), `X1b size should be unknown, not pending: ${x1bSize}`);
  ok("X1b: PDF.js recovers the page; the native reader's failure is shown, not hidden", x1b);
  ok("screenshot", await app.screenshot("08-x1b-geometry-failed"));

  // X2a: 500 pages; thumbnails render only as they come into view.
  expect((await pick("X2a")).state === "added", "X2a did not open");
  await waitUntil(
    "first X2a thumbnail",
    `return document.querySelector('[data-testid="thumb"][data-index="0"]')?.dataset.state === "rendered";`,
  );
  await sleep(1500);
  const rendered = await q(
    `return document.querySelectorAll('[data-testid="thumb"][data-state="rendered"]').length;`,
  );
  expect(rendered > 0 && rendered < 100, `${rendered} of 500 thumbnails rendered without scrolling`);
  ok("500 pages: thumbnails render as they come into view", `${rendered} of 500 rendered without scrolling`);

  // The panel: sections collapse, remember it across a reload, and headers stay in view.
  await q(`document.querySelector('[data-testid="panel"]').scrollTop = 0;`);
  await app.click(await app.find('[data-testid="section-lighting"]'));
  await waitUntil(
    "lighting collapsed",
    `return document.querySelector('[data-section="lighting"]').dataset.open === "false";`,
  );
  await q("location.reload();");
  await sleep(1500);
  await app.waitFor('[data-testid="viewport"] canvas');
  await waitUntil(
    "remembered after reload",
    `return document.querySelector('[data-section="lighting"]')?.dataset.open === "false";`,
  );
  ok("a collapsed section stays collapsed after a reload");
  await app.click(await app.find('[data-testid="section-lighting"]'));
  await waitUntil(
    "lighting reopened",
    `return document.querySelector('[data-section="lighting"]').dataset.open === "true";`,
  );
  expect((await pick("D1")).state === "added", "D1 did not reopen");
  await app.waitFor('[data-testid="box-preview"][data-state="rendered"]');
  const sticky = await q(`
    const panel = document.querySelector('[data-testid="panel"]');
    const section = document.querySelector('[data-section="page"]');
    panel.scrollTop = section.offsetTop + 150;
    const header = section.querySelector('.section-header').getBoundingClientRect();
    return { headerTop: Math.round(header.top - panel.getBoundingClientRect().top), scrolled: panel.scrollTop };`);
  expect(sticky.scrolled > 0 && Math.abs(sticky.headerTop) <= 1, JSON.stringify(sticky));
  ok("a section header stays at the top while its section scrolls past", JSON.stringify(sticky));
  ok("screenshot", await app.screenshot("09-sticky-header"));
  await q(`document.querySelector('[data-testid="panel"]').scrollTop = 0;`);

  // 1.2 — K1: one PDF, pages out of order, mapped to two printed pages and three finishes.
  const k1 = JSON.parse(readFileSync(join(FIXTURES, "K1.expected.json"), "utf8"));
  expect((await pick("K1")).state === "added", "K1 did not open");
  await waitUntil(
    "K1 geometry",
    `return document.querySelector('[data-testid="geometry-status"]')?.dataset.status === "available";`,
  );
  for (const i of [3, 1, 4, 0, 2]) {
    await selectThumb(i);
    await app.click(await app.find(`[data-testid="role-${k1.mapping[i].role}"]`));
  }
  const roles = await q(
    `return [...document.querySelectorAll('[data-testid="thumb"]')].map(t => t.dataset.role);`,
  );
  expect(JSON.stringify(roles) === JSON.stringify(k1.mapping.map((m) => m.role)), `roles ${roles}`);
  for (const m of k1.mapping.filter((x) => x.role === "mask")) {
    await selectLayer(`K1.pdf p. ${m.page + 1}`);
    await choose("layer-type", m.finish === "raisedUv" ? "Raised UV" : "Ordinary UV");
    await choose("layer-target", `K1.pdf p. ${m.target + 1}`);
  }
  const problems = await q(
    `return [...document.querySelectorAll('[data-testid="layer"]')].map(l => l.dataset.problem);`,
  );
  expect(
    problems.every((p) => p === ""),
    `layers not ready: ${problems}`,
  );
  ok("K1: pages classified out of order; three finishes from one PDF target artwork A", roles.join(", "));
  await app.click(await app.find('[data-testid="view-registration"]'));
  await choose("registration-surface", "K1.pdf p. 2");
  await registered();
  const k1Seen = await overlayAt(k1.samples.map((s) => s.at));
  k1.samples.forEach((s, i) => {
    const want = s.raisedUv ? "raisedUv" : s.uv ? "uv" : "none";
    expect(k1Seen[i] === want, `K1 at ${s.at} mm: ${k1Seen[i]}, expected ${want}`);
  });
  ok(
    "K1 coverage matches at every sample; raised UV replaces ordinary UV where both cover",
    k1Seen.join(" "),
  );
  const k1Warnings = await registrationWarnings();
  expect(k1Warnings.includes("beyondTrim@K1.pdf p. 4"), `no beyond-trim warning: ${k1Warnings}`);
  expect(
    k1Warnings.includes("sameTypeOverlap@K1.pdf p. 4 + K1.pdf p. 5"),
    `no overlap warning: ${k1Warnings}`,
  );
  ok("warnings: coverage past the trim, and two ordinary-UV masks overlapping", k1Warnings.join(", "));
  ok("screenshot", await app.screenshot("10-k1-registration"));

  // K2: artwork and masks in separate PDFs.
  const k2 = JSON.parse(readFileSync(join(FIXTURES, "K2m.expected.json"), "utf8")).pages;
  expect((await pick("K2a")).state === "added", "K2a did not open");
  expect((await pick("K2m", { keep: true })).state === "added", "K2m did not open");
  const files = await q(
    `return [...document.querySelectorAll('[data-testid="source"]')].map(s => s.dataset.name);`,
  );
  expect(JSON.stringify(files) === '["K2a.pdf","K2m.pdf"]', `source list ${files}`);
  await waitUntil(
    "K2 geometry",
    `return [...document.querySelectorAll('[data-testid="geometry-status"]')].every(g => g.dataset.status === "available");`,
  );
  await selectThumb(0, "K2a.pdf");
  await app.click(await app.find('[data-testid="role-print"]'));
  for (const p of [0, 1, 2, 3]) {
    await selectThumb(p, "K2m.pdf");
    await app.click(await app.find('[data-testid="role-mask"]'));
  }
  await registered();
  const unassigned = await q(
    `return [...document.querySelectorAll('[data-testid="layer"]')].filter(l => l.dataset.problem === "missingTarget").length;`,
  );
  const missing = await registrationWarnings();
  expect(unassigned === 4 && missing.some((w) => w.startsWith("missingTarget")), `${unassigned}; ${missing}`);
  // K1 left the project; its three layers stay, reported as having lost their mask file.
  expect(
    missing.some((w) => w.startsWith("missingMask")),
    `K1 layers not reported: ${missing}`,
  );
  ok(
    "separate files: the source list names both; unassigned masks are flagged as missing a target",
    files.join(" + "),
  );
  const masks = [0, 1, 2, 3].map((p) => `K2m.pdf p. ${p + 1}`);
  for (const mask of masks) {
    await selectLayer(mask);
    await choose("layer-target", "K2a.pdf p. 1");
  }
  /** Show only one mask in the overlay. */
  const only = async (mask) => {
    for (const m of masks) {
      await selectLayer(m);
      const shown = await app.attr(await app.find('[data-testid="layer-shown"]'), "checked");
      if (Boolean(shown) !== (m === mask)) await app.click(await app.find('[data-testid="layer-shown"]'));
    }
    await selectLayer(mask);
    await registered();
  };
  const coverageAt = async (points) => (await overlayAt(points)).map((c) => (c === "none" ? 0 : 1));

  await only(masks[0]);
  await waitUntil(
    "alpha check",
    `return document.querySelector('[data-testid="alpha-status"]').dataset.usable !== "null";`,
  );
  const opaqueAlpha = await app.attr(await app.find('[data-testid="alpha-status"]'), "data-usable");
  const alphaDisabled = await q(
    `return document.querySelector('[data-testid="mask-mode"] option[value="alpha"]').disabled;`,
  );
  expect(
    opaqueAlpha === "false" && alphaDisabled,
    `opaque page: alpha ${opaqueAlpha}, disabled ${alphaDisabled}`,
  );
  expect(
    JSON.stringify(await coverageAt(k2[0].samples.map((s) => s.at))) ===
      JSON.stringify(k2[0].samples.map((s) => s.coverage)),
    "opaque mask coverage",
  );
  expect((await registrationWarnings()).includes("originMismatch@K2m.pdf p. 1"), "no origin warning");
  ok(
    "opaque mask (painted sheet, trim elsewhere): aligned by the trim, origin difference reported, alpha mode unavailable",
  );

  await only(masks[1]);
  await choose("mask-mode", "Transparency (alpha)");
  await registered();
  const transparentAlpha = await app.attr(await app.find('[data-testid="alpha-status"]'), "data-usable");
  expect(transparentAlpha === "true", "transparent page alpha not usable");
  expect(
    JSON.stringify(await coverageAt(k2[1].samples.map((s) => s.at))) ===
      JSON.stringify(k2[1].samples.map((s) => s.coverage)),
    "alpha coverage",
  );
  ok("transparent mask read by alpha through an app-created alpha context");
  ok("screenshot", await app.screenshot("11-k2-alpha"));

  await only(masks[2]);
  const pts = k2[2].samples.map((s) => s.at);
  const before = await coverageAt(pts);
  expect(
    JSON.stringify(before) === JSON.stringify(k2[2].samples.map((s) => s.uncorrected)),
    `uncorrected ${before}`,
  );
  for (const [field, value] of [
    ["offset-x", k2[2].correctionMm[0]],
    ["offset-y", k2[2].correctionMm[1]],
  ]) {
    const el = await app.find(`[data-testid="${field}"]`);
    await app.clear(el);
    await app.type(el, String(value));
  }
  await registered();
  const after = await coverageAt(pts);
  expect(
    JSON.stringify(after) === JSON.stringify(k2[2].samples.map((s) => s.corrected)),
    `corrected ${after}`,
  );
  ok(
    "misregistered mask: shifting X −1.5 mm, Y +1 mm puts every sample where the nominal shape is",
    `${before} → ${after}`,
  );
  ok("screenshot", await app.screenshot("12-k2-corrected"));
  await app.click(await app.find('[data-testid="reset-interpretation"]'));
  await registered();
  expect(
    JSON.stringify(await coverageAt(pts)) === JSON.stringify(before),
    "reset did not restore the uncorrected mask",
  );
  ok("reset returns the mask settings to their defaults");

  const threshold = await app.find('[data-testid="mask-threshold"]');
  await app.clear(threshold);
  await app.type(threshold, "1.5");
  await app.waitFor('[data-testid="refusal"][data-code="invalidThreshold"]');
  ok(
    "an invalid threshold is refused with its reason",
    await app.text(await app.find('[data-testid="refusal"]')),
  );
  await app.clear(threshold);
  await app.type(threshold, "0.5");

  await only(masks[3]);
  expect((await registrationWarnings()).includes("sizeMismatch@K2m.pdf p. 4"), "no size warning");
  ok("a mask whose trim is 1 mm wider is reported as a size mismatch, not corrected");
  await app.click(await app.find('[data-testid="view-3d"]'));
  await clearSources();

  // Bypass the UI: call the IPC directly with things the user never selected.
  const refusals = await app.execAsync(`
    const done = arguments[arguments.length - 1];
    const invoke = window.__TAURI_INTERNALS__.invoke;
    const attempt = (cmd, args) => invoke(cmd, args).then(() => "ALLOWED", (e) => typeof e === "string" ? e : JSON.stringify(e));
    Promise.all([
      attempt("read_source", { handle: "C:\\\\Windows\\\\win.ini" }),
      attempt("read_source", { handle: "src-00000000000000000000000000000000" }),
      attempt("plugin:dialog|open", { options: {} }),
      attempt("plugin:opener|open_path", { path: "C:\\\\Windows\\\\win.ini" }),
    ]).then(done);`);
  expect(
    refusals.every((r) => r !== "ALLOWED"),
    `an unauthorized call succeeded: ${JSON.stringify(refusals)}`,
  );
  expect(
    refusals[0].includes("unauthorizedSource") && refusals[1].includes("unauthorizedSource"),
    JSON.stringify(refusals),
  );
  ok("path as handle refused", refusals[0]);
  ok("guessed handle refused", refusals[1]);
  ok("dialog plugin refused to the frontend", refusals[2]);
  ok("opener plugin absent", refusals[3]);

  // Requests: everything same-origin, and an external fetch is blocked.
  const resources = await app.exec(
    "return performance.getEntriesByType('resource').map(e => e.name).filter(n => !n.startsWith(location.origin) && !n.startsWith('ipc:') && !n.startsWith('http://ipc.localhost'));",
  );
  expect(resources.length === 0, `requests outside the app origin: ${resources.join(", ")}`);
  const total = await app.exec("return performance.getEntriesByType('resource').length;");
  ok("every resource request stayed on the app origin or IPC", `${total} requests, 0 external`);
  const external = await app.execAsync(`
    const done = arguments[arguments.length - 1];
    fetch("https://example.com/").then(() => done("FETCHED"), (e) => done("blocked: " + e.message));`);
  expect(external !== "FETCHED", "an external fetch succeeded");
  await sleep(300);
  const violations = await app.exec("return window.__maskora.cspViolations;");
  ok("external fetch blocked", `${external}; recorded: ${violations.join("; ") || "none"}`);
} catch (error) {
  console.error(`  FAIL ${error.message}`);
  try {
    console.error(`       screenshot: ${await app.screenshot("failure")}`);
  } catch {
    /* the window may already be gone */
  }
  process.exitCode = 1;
} finally {
  await app.close();
}
if (!process.exitCode) console.log(`smoke: ${passed} checks passed`);
