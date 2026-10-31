#!/usr/bin/env node
/**
 * The installed app's core workflow with the network physically unavailable (plan 2.4).
 *
 *   1. Install Maskora (the unsigned per-user NSIS installer).
 *   2. Disconnect every network connection (Wi-Fi off, cable out, or airplane mode).
 *   3. npm run offline-check
 *   4. Reconnect. Results are in probe-out/offline/<time>/report.md (and .json, screenshots).
 *
 * Needs nothing from the network or from anyone: Node, the installed app,
 * msedgedriver and tauri-driver are all local. It records whether the machine
 * really was offline (adapters up, a TCP connection and a DNS lookup), so a
 * run made online is reported as such rather than counted as offline evidence.
 *
 * MASKORA_APP overrides the app (default: the per-user install location).
 */
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { readPng } from "./png.mjs";
import { asideAppData } from "./smoke-project.mjs";
import { ROOT } from "./webdriver.mjs";

const run = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FIXTURES = join(ROOT, "tests", "fixtures", "pdf");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const out = join(ROOT, "probe-out", "offline", stamp);
const work = join(out, "work");
mkdirSync(work, { recursive: true });
process.env.MASKORA_APP ??= join(process.env.LOCALAPPDATA, "Maskora", "maskora.exe");
const { openApp } = await import("./webdriver.mjs");

const ps = (command) => {
  try {
    return execFileSync("powershell", ["-NoProfile", "-Command", command], {
      encoding: "utf8",
      timeout: 20000,
    }).trim();
  } catch (error) {
    return `error: ${String(error.message).split("\n")[0]}`;
  }
};
/** What the machine's network looked like: adapters up, and whether a connection or a lookup works. */
function network() {
  const adapters = ps(
    "Get-NetAdapter | Where-Object Status -eq 'Up' | ForEach-Object { $_.Name + ' (' + $_.InterfaceDescription + ')' }",
  );
  const tcp = ps("(New-Object System.Net.Sockets.TcpClient).ConnectAsync('1.1.1.1', 443).Wait(3000)");
  const dns = ps("try { [System.Net.Dns]::GetHostAddresses('example.com').Count } catch { 'failed' }");
  const offline = tcp !== "True" && !/^\d+$/.test(dns) && dns !== "0";
  return { offline, adaptersUp: adapters ? adapters.split(/\r?\n/) : [], tcp1111: tcp, dnsExampleCom: dns };
}

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass: !!pass, detail: detail ?? "" });
  console.log(`  ${pass ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

const before = network();
console.log(
  `offline-check: network ${before.offline ? "unavailable" : "AVAILABLE (this run is not offline evidence)"}`,
);
const recovery = asideAppData("recovery.json");
const approvals = asideAppData("authorized-sources.json");
const k1 = join(work, "K1.pdf");
const c1 = join(work, "C1.pdf");
copyFileSync(join(FIXTURES, "K1.pdf"), k1);
copyFileSync(join(FIXTURES, "C1.pdf"), c1);
const digests = { k1: sha(k1), c1: sha(c1) };

let app;
const shots = [];
try {
  app = await openApp();
  const q = (script, ...args) => app.exec(script, ...args);
  const click = async (testid) => app.click(await app.find(`[data-testid="${testid}"]`));
  const until = async (what, script, ms = 30000) => {
    const end = Date.now() + ms;
    for (;;) {
      if (await q(script)) return;
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
      await sleep(250);
    }
  };
  const dialog = (args) =>
    run("powershell", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      join(ROOT, "scripts", "dialog.ps1"),
      ...args,
    ]);
  const choose = async (testid, text) => {
    const i = await q(
      `return [...document.querySelector('[data-testid="${testid}"]').options].findIndex(o => o.textContent.trim() === arguments[0]);`,
      text,
    );
    await app.click(await app.find(`[data-testid="${testid}"] option:nth-child(${i + 1})`));
    await sleep(150);
  };
  const settled = () =>
    until(
      "3D settled",
      `const v = document.querySelector('[data-testid="viewport"]'); return v.dataset.busy === "false" && v.dataset.faces !== "";`,
    );
  const shot = async (name) => shots.push(await app.screenshot(`offline-${name}`));
  const fileDone = () =>
    until(
      "file action",
      `const k = document.querySelector('[data-testid="project-status"]')?.dataset.kind; return k && k !== "saving" && k !== "opening";`,
    );

  // Start and hydrate under the production policy.
  await app.waitFor('[data-testid="viewport"] canvas');
  await sleep(1500);
  const where = await q("return location.origin;");
  const violations = await q("return window.__maskora?.cspViolations ?? null;");
  check(
    "the installed app starts and hydrates",
    Array.isArray(violations) && where === "http://tauri.localhost",
    `${process.env.MASKORA_APP} · WebView2 ${app.where.version}`,
  );
  await shot("start");

  // Import and map K1: two printed pages, raised and ordinary UV.
  await click("open-pdf");
  await dialog(["-Path", k1]);
  await until(
    "K1 read",
    `return document.querySelector('[data-testid="geometry-status"]')?.dataset.status === "available";`,
  );
  const mapping = JSON.parse(readFileSync(join(FIXTURES, "K1.expected.json"), "utf8")).mapping;
  for (const i of [3, 1, 4, 0, 2]) {
    await app.click(await app.find(`[data-testid="thumb"][data-index="${i}"]`));
    await click(`role-${mapping[i].role}`);
  }
  for (const m of mapping.filter((x) => x.role === "mask")) {
    await app.click(await app.find(`[data-testid="layer"][data-mask="K1.pdf p. ${m.page + 1}"]`));
    await choose("layer-type", m.finish === "raisedUv" ? "Raised UV" : "Ordinary UV");
    await choose("layer-target", `K1.pdf p. ${m.target + 1}`);
  }
  await click("view-3d");
  await choose("slot-front", "K1.pdf p. 2");
  await settled();
  await until(
    "coating",
    `const s = window.__maskora.scene.faces().find(f => f.name === "front")?.stats; return !!s && s.mode === "mesh";`,
  );
  const face = (await q("return window.__maskora.scene.faces();")).find((f) => f.name === "front");
  check(
    "K1 mapped: raised UV drawn as coating geometry on the front page",
    face?.stats?.mode === "mesh",
    face?.digest,
  );
  await shot("k1-3d");

  // Save, close, reopen silently.
  const projectPath = join(work, "offline.maskora.json");
  await click("project-save");
  await dialog(["-Title", "Save project", "-Path", projectPath]);
  await fileDone();
  check("saved a project", existsSync(projectPath), projectPath);
  await click("project-new");
  await sleep(150);
  if (await q(`return !!document.querySelector('[data-testid="project-confirm"]');`))
    await click("project-new");
  await click("project-open");
  await dialog(["-Title", "Open project", "-Path", projectPath]);
  await fileDone();
  await click("view-3d");
  await settled();
  const reopened = (await q("return window.__maskora.scene.faces();")).find((f) => f.name === "front");
  const relinks = await q(`return document.querySelectorAll('[data-testid="relink"]').length;`);
  check(
    "reopened without asking, same coverage",
    relinks === 0 && reopened?.digest === face?.digest,
    reopened?.digest,
  );

  // Export a still and read it back from disk.
  await click("export-framing-fit");
  const size = await app.find('[data-testid="export-size"]');
  await app.type(size, "a1600");
  const pngPath = join(work, "offline.png");
  await click("export-png");
  await until(
    "export rendered",
    `return document.querySelector('[data-testid="export-status"]')?.dataset.kind === "writing";`,
    60000,
  );
  await dialog(["-Title", "Export PNG", "-Path", pngPath]);
  await until(
    "export saved",
    `return document.querySelector('[data-testid="export-status"]')?.dataset.kind === "saved";`,
  );
  const png = readPng(pngPath);
  check(
    "exported a PNG that states its sources and approximation",
    Math.max(png.width, png.height) === 1600 &&
      /approximation/.test(png.text.Description ?? "") &&
      (png.text["Maskora sources"] ?? "").includes(digests.k1),
    `${png.width} × ${png.height}, ${png.text["Maskora raised UV"]}`,
  );
  await shot("export");

  // Active content stays inert.
  await click("project-new");
  await sleep(150);
  if (await q(`return !!document.querySelector('[data-testid="project-confirm"]');`))
    await click("project-new");
  await click("open-pdf");
  await dialog(["-Path", c1]);
  await until(
    "C1 read",
    `return document.querySelector('[data-testid="geometry-status"]')?.dataset.status === "available";`,
  );
  await settled();
  await sleep(2000);
  const calc = /calc\.exe|CalculatorApp/i.test(
    execFileSync("tasklist", ["/FO", "CSV", "/NH"], { encoding: "utf8" }),
  );
  // Reading the title fails while a dialog is open, so reaching it also means no alert appeared.
  check(
    "C1's scripts, links and attachment stay inert",
    (await q("return document.title;")) !== undefined && !calc,
    calc ? "a calculator process is running" : "no dialog, no program started",
  );
  await shot("c1");

  // Requests: nothing left the app's origin; an outside fetch is refused.
  const external = await q(
    "return performance.getEntriesByType('resource').map(e => e.name).filter(n => !n.startsWith(location.origin) && !n.startsWith('ipc:') && !n.startsWith('http://ipc.localhost'));",
  );
  const total = await q("return performance.getEntriesByType('resource').length;");
  check(
    "every request stayed on the app's origin or IPC",
    external.length === 0,
    `${total} requests, ${external.length} outside`,
  );
  const fetched = await app.execAsync(`const done = arguments[arguments.length - 1];
    fetch("https://example.com/").then(() => done("FETCHED"), (e) => done("blocked: " + e.message));`);
  check("an outside fetch is refused", fetched !== "FETCHED", fetched);
  const csp = await q("return window.__maskora.cspViolations;");
  check(
    "no policy violation other than that refused fetch",
    csp.every((v) => /example\.com/.test(v)),
    csp.join("; ") || "none",
  );

  check(
    "source files unchanged",
    sha(k1) === digests.k1 && sha(c1) === digests.c1,
    `${digests.k1.slice(0, 12)}…, ${digests.c1.slice(0, 12)}…`,
  );
} catch (error) {
  check("run completed", false, error.message);
  try {
    shots.push(await app?.screenshot("offline-failure"));
  } catch {
    /* the window may be gone */
  }
} finally {
  await app?.close().catch(() => undefined);
  recovery.restore();
  approvals.restore();
}

const after = network();
const passed = results.every((r) => r.pass);
const report = {
  when: new Date().toISOString(),
  machine: process.env.COMPUTERNAME,
  app: process.env.MASKORA_APP,
  network: { before, after },
  offlineEvidence: before.offline && after.offline,
  passed,
  results,
  screenshots: shots,
};
writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
writeFileSync(
  join(out, "report.md"),
  [
    `# Offline check, ${report.when}`,
    "",
    `- App: ${report.app}`,
    `- Machine: ${report.machine}`,
    `- Network before: ${before.offline ? "unavailable" : "AVAILABLE"} (adapters up: ${before.adaptersUp.join(", ") || "none"}; TCP 1.1.1.1:443 ${before.tcp1111}; DNS example.com ${before.dnsExampleCom})`,
    `- Network after: ${after.offline ? "unavailable" : "AVAILABLE"} (adapters up: ${after.adaptersUp.join(", ") || "none"})`,
    `- Offline evidence: ${report.offlineEvidence ? "yes" : "NO: the network was reachable during the run"}`,
    `- Result: ${passed ? "all checks passed" : "FAILED"}`,
    "",
    ...results.map((r) => `- ${r.pass ? "ok" : "FAIL"} ${r.name}${r.detail ? `: ${r.detail}` : ""}`),
    "",
  ].join("\n"),
);
console.log(
  `offline-check: ${passed ? "passed" : "FAILED"}; offline evidence ${report.offlineEvidence ? "yes" : "no"}; report ${join(out, "report.md")}`,
);
if (!passed) process.exitCode = 1;
