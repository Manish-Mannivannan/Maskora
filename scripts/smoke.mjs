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
import { statSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { ROOT, openApp } from "./webdriver.mjs";

const run = promisify(execFile);
const FIXTURE = join(ROOT, "tests", "fixtures", "pdf", "G1.pdf");
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

  // Native selection: cancel, then a real file.
  await app.click(await app.find('[data-testid="open-pdf"]'));
  await run("powershell", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    join(ROOT, "scripts", "dialog.ps1"),
    "-Cancel",
  ]);
  await app.waitFor('[data-testid="doc-status"][data-state="cancelled"]');
  ok("a cancelled dialog reads as cancelled", await app.text(await app.find('[data-testid="doc-status"]')));

  await app.click(await app.find('[data-testid="open-pdf"]'));
  await run("powershell", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    join(ROOT, "scripts", "dialog.ps1"),
    "-Path",
    FIXTURE,
  ]);
  await app.waitFor('[data-testid="doc-status"][data-state="loaded"]', 30000);
  const loaded = await app.text(await app.find('[data-testid="doc-status"]'));
  const size = statSync(FIXTURE).size;
  expect(loaded.includes(`${size} bytes read locally`), `expected ${size} bytes: ${loaded}`);
  expect(loaded.includes("%PDF-1.7") && loaded.includes("1 page"), `unexpected document status: ${loaded}`);
  ok("dialog-selected file read through its handle and parsed by local PDF.js", loaded);
  ok("screenshot", await app.screenshot("04-document-loaded"));

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
