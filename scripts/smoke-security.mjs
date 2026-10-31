/**
 * Native smoke, step 2.3: security boundary probes in the built app. Called
 * from smoke.mjs with its helpers.
 *
 * Proves:
 *   - C1's scripts, web and launch links and attachment stay inert: the page
 *     renders, and no dialog, program, request or policy violation follows;
 *   - forgetting an approval means the next project that uses the file asks again;
 *   - with the UI bypassed: out-of-range numbers and deep nesting in a project,
 *     an oversized password, a malformed approval id, and a second dialog while
 *     one is open are all refused with their codes.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export async function securityChecks(c) {
  const { app, q, ok, expect, sleep, dialog, waitUntil, settled3d, faces3d, FIXTURES, ROOT } = c;
  const click = async (testid) => app.click(await app.find(`[data-testid="${testid}"]`));
  const fileSettled = () =>
    waitUntil(
      "file action",
      `const k = document.querySelector('[data-testid="project-status"]')?.dataset.kind; return k && k !== "saving" && k !== "opening";`,
      30000,
    );
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
  const external = () =>
    q(
      "return performance.getEntriesByType('resource').map(e => e.name).filter(n => !n.startsWith(location.origin) && !n.startsWith('ipc:') && !n.startsWith('http://ipc.localhost'));",
    );
  const calculator = () =>
    /calc\.exe|CalculatorApp/i.test(execFileSync("tasklist", ["/FO", "CSV", "/NH"], { encoding: "utf8" }));

  const work = join(ROOT, "probe-out", "smoke", `security-${Date.now()}`);
  mkdirSync(work, { recursive: true });
  const c1 = join(work, "C1.pdf");
  copyFileSync(join(FIXTURES, "C1.pdf"), c1);

  // C1: active content stays inert.
  const calcBefore = calculator();
  const cspBefore = (await q("return window.__maskora.cspViolations.slice();")).length;
  await newProject();
  await click("open-pdf");
  await dialog(["-Path", c1]);
  await waitUntil(
    "C1 read",
    `return document.querySelector('[data-testid="geometry-status"]')?.dataset.status === "available";`,
    30000,
  );
  await click("view-3d");
  await settled3d();
  await click("doc-details");
  await sleep(3000);
  const face = (await faces3d()).find((f) => f.name === "front");
  const after = {
    external: await external(),
    csp: (await q("return window.__maskora.cspViolations.slice();")).slice(cspBefore),
    calc: calculator(),
    // Any alert left open would make this call fail.
    title: await q("return document.title;"),
  };
  expect(!!face && face.sizeMm[0] > 70 && face.sizeMm[0] < 71, `C1 not drawn: ${JSON.stringify(face)}`);
  expect(after.external.length === 0, `C1 caused requests: ${after.external}`);
  expect(after.csp.length === 0, `C1 caused policy violations: ${after.csp}`);
  expect(!after.calc || calcBefore, "a program started after C1 opened");
  ok(
    "C1's document and page scripts, web link, launch link and attachment stay inert: drawn, no dialog, program, request or violation",
    `${face.sizeMm.map((v) => v.toFixed(1)).join(" × ")} mm, 0 requests, 0 violations`,
  );
  ok("screenshot", await app.screenshot("42-c1-inert"));

  // Approvals: forget C1's, and the project that uses it asks again.
  const projectPath = join(work, "c1.maskora.json");
  await click("project-save");
  await dialog(["-Title", "Save project", "-Path", projectPath]);
  await fileSettled();
  await app.click(await app.find('[data-testid="approvals-panel"] summary'));
  await click("approvals-show");
  await app.waitFor('[data-testid="approval"][data-name="C1.pdf"]');
  const listed = await q(
    `return [...document.querySelectorAll('[data-testid="approval"]')].map(a => a.textContent).join(" | ");`,
  );
  // A drive letter or a backslash would mean a path reached the page (dates contain "/").
  expect(!/[A-Za-z]:\\|\\/.test(listed), `a path is shown: ${listed}`);
  ok("screenshot", await app.screenshot("43-approvals"));
  // Newest first: this run's copy of C1 is the first C1 listed (earlier runs approved copies elsewhere).
  const id = await q(
    `return document.querySelector('[data-testid="approval"][data-name="C1.pdf"]').dataset.id;`,
  );
  await app.click(
    await app.find(`[data-testid="approval"][data-id="${id}"] [data-testid="approval-forget"]`),
  );
  await waitUntil(
    "forgotten",
    `return !document.querySelector('[data-testid="approval"][data-id="${id}"]');`,
  );
  await app.click(await app.find('[data-testid="approvals-panel"] summary'));
  await newProject();
  await click("project-open");
  await dialog(["-Title", "Open project", "-Path", projectPath]);
  await fileSettled();
  await waitUntil(
    "C1 needs approval",
    `return document.querySelector('[data-testid="relink"]')?.dataset.status === "needsApproval";`,
  );
  const reason = await q(`return document.querySelector('[data-testid="relink"] .hint').textContent;`);
  expect(/Not yet opened in Maskora on this computer/.test(reason), reason);
  ok("approvals list file names and dates only; a forgotten one makes its project ask again", reason);
  await newProject();

  // Bypassing the UI.
  const refusals = await app.execAsync(`
    const done = arguments[arguments.length - 1];
    const invoke = window.__TAURI_INTERNALS__.invoke;
    const attempt = (cmd, args) => invoke(cmd, args).then((v) => "ALLOWED " + JSON.stringify(v), (e) => typeof e === "string" ? e : JSON.stringify(e));
    const save = (extra) => attempt("save_project", { request: { json: JSON.stringify({ format: "maskora-project", schemaVersion: 2, sources: [], ...extra }), sources: [], token: null, saveAs: false, suggestedName: "x" } });
    let deep = "0"; for (let i = 0; i < 80; i += 1) deep = "[" + deep + "]";
    Promise.all([
      save({ x: 1e300 }),
      attempt("save_project", { request: { json: '{"format":"maskora-project","schemaVersion":2,"sources":[],"x":' + deep + "}", sources: [], token: null, saveAs: false, suggestedName: "x" } }),
      attempt("inspect_geometry", { handle: "src-0", password: "p".repeat(2000) }),
      attempt("forget_approval", { id: "../../authorized-sources" }),
    ]).then(done);`);
  expect(/number out of range/.test(refusals[0]), refusals[0]);
  expect(/nested too deeply/.test(refusals[1]), refusals[1]);
  expect(/invalidRequest/.test(refusals[2]), refusals[2]);
  expect(refusals[3] === "ALLOWED false", refusals[3]);
  ok("a project number beyond any setting is refused before any dialog", refusals[0]);
  ok("a project nested 80 deep is refused before any dialog", refusals[1]);
  ok("a 2,000-character password is refused before the file is read", refusals[2]);
  ok("a malformed approval id forgets nothing", refusals[3]);

  // One dialog at a time: a second request while the first is open is refused at once.
  const second = await app.execAsync(`
    const done = arguments[arguments.length - 1];
    const invoke = window.__TAURI_INTERNALS__.invoke;
    window.__first = invoke("open_project").then((v) => "closed " + JSON.stringify(v), (e) => JSON.stringify(e));
    setTimeout(() => invoke("open_project").then((v) => done("ALLOWED " + JSON.stringify(v)), (e) => done(JSON.stringify(e))), 1500);`);
  await dialog(["-Title", "Open project", "-Cancel"]);
  const first = await app.execAsync(
    `const done = arguments[arguments.length - 1]; window.__first.then(done);`,
  );
  expect(/dialogBusy/.test(second) && first === "closed null", `second ${second}, first ${first}`);
  ok("a second file dialog while one is open is refused at once; the first still closes normally", second);
}
