/**
 * Native smoke, step 1.4: save, reopen and still export, driven through the
 * real dialogs in the built app. Called from smoke.mjs with its helpers.
 *
 * Works on copies of fixtures in a fresh folder under probe-out/smoke/, so
 * every path is new to this installation's record of selected files. Proves:
 *   - a saved project restores every setting it records, and a trusted reopen
 *     asks nothing; saving it again elsewhere writes the same content;
 *   - a moved source is found by locating it; an edited one needs approval and
 *     is then held until kept; a copied (imported) project trusts nothing;
 *   - an export renders the frozen settings, waits for their raised-UV
 *     geometry, keeps registration and the overlap rule, shows the chosen
 *     raised-UV representation, and records it in the file;
 *   - saved, replaced, cancelled and permission-denied exports read distinctly;
 *   - no source file changes.
 */
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { readPng } from "./png.mjs";

export async function projectChecks(c) {
  const {
    app,
    q,
    ok,
    expect,
    sleep,
    dialog,
    waitUntil,
    choose,
    selectThumb,
    selectLayer,
    settled3d,
    faces3d,
  } = c;
  const { material, registered, overlayAt, data, FIXTURES, ROOT } = c;

  const work = join(ROOT, "probe-out", "smoke", `project-${Date.now()}`);
  mkdirSync(join(work, "art"), { recursive: true });
  const k1Path = join(work, "art", "K1.pdf");
  copyFileSync(join(FIXTURES, "K1.pdf"), k1Path);
  const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
  const k1 = JSON.parse(readFileSync(join(FIXTURES, "K1.expected.json"), "utf8"));
  const originals = Object.fromEntries(
    ["K1", "K2a", "K2m", "D1"].map((f) => [f, sha(join(FIXTURES, `${f}.pdf`))]),
  );
  const k1Sha = sha(k1Path);

  const click = async (testid) => app.click(await app.find(`[data-testid="${testid}"]`));
  const projectStatus = () =>
    q(
      `const e = document.querySelector('[data-testid="project-status"]'); return { kind: e.dataset.kind, text: e.textContent };`,
    );
  const fileSettled = async () => {
    await sleep(300);
    await waitUntil(
      "project file action",
      `const k = document.querySelector('[data-testid="project-status"]')?.dataset.kind; return k && k !== "saving" && k !== "opening";`,
      30000,
    );
    return projectStatus();
  };
  const relinks = () =>
    q(
      `return [...document.querySelectorAll('[data-testid="relink"]')].map(r => ({ id: r.dataset.source, status: r.dataset.status, note: r.dataset.note, name: r.querySelector('strong').textContent }));`,
    );
  const restored = () =>
    waitUntil(
      "sources restored",
      `const d = document.querySelector('[data-testid="doc-status"]')?.dataset.state; return ![...document.querySelectorAll('[data-testid="relink"]')].some(r => r.dataset.status === "loading") && d !== "loading";`,
      30000,
    );
  /** After a locate or approve: wait until `name` has left `from` and finished loading. */
  const relinkMoved = (name, from) =>
    waitUntil(
      `${name} relinked`,
      `const r = [...document.querySelectorAll('[data-testid="relink"]')].find(r => r.querySelector('strong').textContent === arguments[0]);
      return !!r && r.dataset.status !== arguments[1] && r.dataset.status !== "loading";`
        .replace(/arguments\[0\]/g, JSON.stringify(name))
        .replace(/arguments\[1\]/g, JSON.stringify(from)),
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
  const addFile = async (path) => {
    await click("open-pdf");
    await dialog(["-Path", path]);
    await waitUntil(
      "file added",
      `const s = document.querySelector('[data-testid="doc-status"]')?.dataset.state; return s === "added" || s === "failed";`,
      30000,
    );
  };
  const geometry = () =>
    waitUntil(
      "geometry",
      `const g = [...document.querySelectorAll('[data-testid="geometry-status"]')]; return g.length && g.every(e => e.dataset.status === "available");`,
      30000,
    );
  const setField = async (testid, value) => {
    await app.click(await app.find('[data-testid="finish-look"] summary'));
    const el = await app.find(`[data-testid="${testid}"]`);
    await app.clear(el);
    await app.type(el, value);
    await app.click(await app.find('[data-testid="finish-look"] summary'));
  };
  const raisedMode = async (text) => {
    await app.click(await app.find('[data-testid="finish-look"] summary'));
    await choose("raised-mode", text);
    await app.click(await app.find('[data-testid="finish-look"] summary'));
  };
  const saveProject = async (path, { as = false, replace } = {}) => {
    await click(as ? "project-save-as" : "project-save");
    await dialog(["-Title", "Save project", "-Path", path, ...(replace ? ["-Replace", replace] : [])]);
    return fileSettled();
  };
  const openProject = async (path) => {
    await click("project-open");
    await sleep(150);
    if (await q(`return !!document.querySelector('[data-testid="project-confirm"]');`))
      await click("project-open");
    await dialog(["-Title", "Open project", "-Path", path]);
    const s = await fileSettled();
    await restored();
    return s;
  };
  const exportStatus = () =>
    q(
      `const e = document.querySelector('[data-testid="export-status"]'); return { kind: e.dataset.kind, text: e.textContent };`,
    );
  /** Start an export and wait until it asks where to save (or ends without asking). */
  const startExport = async () => {
    await click("export-png");
    await waitUntil(
      "export rendered",
      `const k = document.querySelector('[data-testid="export-status"]')?.dataset.kind; return ["writing", "failed", "cancelled"].includes(k);`,
      60000,
    );
    return exportStatus();
  };
  const finishExport = async (args) => {
    await dialog(["-Title", "Export PNG", ...args]);
    await waitUntil(
      "export written",
      `const k = document.querySelector('[data-testid="export-status"]')?.dataset.kind; return ["saved", "failed", "cancelled"].includes(k);`,
      30000,
    );
    return exportStatus();
  };
  const exportTo = async (path, extra = []) => {
    const s = await startExport();
    expect(s.kind === "writing", `export did not reach the save dialog: ${JSON.stringify(s)}`);
    return finishExport(["-Path", path, ...extra]);
  };
  const lastExport = () =>
    q(
      `const e = window.__maskora.lastExport; return e && { width: e.width, height: e.height, faces: e.faces, metadata: e.metadata };`,
    );
  const projectPoints = (face, points) =>
    q(`return arguments[1].map(p => window.__maskora.lastExport.project(arguments[0], p));`, face, points);
  const sameContent = (a, b) => {
    const strip = (p) => ({
      ...p,
      savedAt: "",
      sources: p.sources.map((s) => ({ ...s, ref: undefined })),
    });
    return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
  };

  // ---------------------------------------------------------------- build K1 project
  await newProject();
  await addFile(k1Path);
  await geometry();
  for (const i of [3, 1, 4, 0, 2]) {
    await selectThumb(i);
    await click(`role-${k1.mapping[i].role}`);
  }
  for (const m of k1.mapping.filter((x) => x.role === "mask")) {
    await selectLayer(`K1.pdf p. ${m.page + 1}`);
    await choose("layer-type", m.finish === "raisedUv" ? "Raised UV" : "Ordinary UV");
    await choose("layer-target", `K1.pdf p. ${m.target + 1}`);
  }
  // Non-default settings everywhere a project records them.
  await selectLayer("K1.pdf p. 5");
  for (const [testid, value] of [
    ["offset-x", "0.5"],
    ["mask-feather", "0.2"],
  ]) {
    const el = await app.find(`[data-testid="${testid}"]`);
    await app.clear(el);
    await app.type(el, value);
  }
  await setField("recipe-raisedUv-heightUm", "150");
  await setField("recipe-raisedUv-bevelMm", "1");
  await setField("recipe-raisedUv-crownUm", "10");
  await setField("recipe-uv-gloss", "0.8");
  await choose("stock-preset", "Silk coated");
  await click("view-3d");
  await choose("slot-front", "K1.pdf p. 2");
  await choose("slot-back", "K1.pdf p. 3");
  await click("light-grazing");
  const env = await app.find('[data-testid="env-rotation"]');
  await app.clear(env);
  await app.type(env, "30");
  await settled3d();
  await click("camera-low");
  await sleep(300);
  await click("camera-front");
  await sleep(300);
  await waitUntil(
    "coating at 150 µm",
    `const s = window.__maskora.scene.faces().find(f => f.name === "front")?.stats; return !!s && s.mode === "mesh" && s.profile.heightUm === 150 && s.profile.crownUm === 10;`,
    30000,
  );
  const before = {
    faces: (await faces3d()).map((f) => [f.name, f.digest, f.stats?.mode]),
    samples: await material(
      "front",
      k1.samples.map((s) => s.at),
    ),
    light: await data("light"),
    camera: await data("camera"),
  };
  expect(
    (await q(`return document.querySelector('[data-testid="project-name"]').dataset.dirty;`)) === "true",
    "a new project with work is not marked unsaved",
  );
  ok(
    "K1 project built: two pages, three finishes, shifted and feathered mask, non-default recipes, stock and light",
  );

  // ---------------------------------------------------------------- save
  const projectPath = join(work, "job.maskora.json");
  await click("project-save");
  await dialog(["-Title", "Save project", "-Cancel"]);
  const cancelled = await fileSettled();
  expect(cancelled.kind === "cancelled" && !existsSync(projectPath), `cancel: ${JSON.stringify(cancelled)}`);
  ok("a cancelled save dialog reads as cancelled and writes nothing", cancelled.text);
  const saved = await saveProject(projectPath);
  expect(saved.kind === "saved" && /Saved as job\.maskora\.json/.test(saved.text), JSON.stringify(saved));
  const file = JSON.parse(readFileSync(projectPath, "utf8"));
  expect(
    file.format === "maskora-project" && file.schemaVersion === 2 && file.sources[0].pages?.length === 5,
    "not a schema-2 project with page geometry",
  );
  expect(
    file.sources[0].ref.relativePath === "art/K1.pdf" && file.sources[0].ref.fileName === "K1.pdf",
    `ref ${JSON.stringify(file.sources[0].ref)}`,
  );
  expect(file.sources[0].sha256 === k1Sha, "saved digest differs from the file's");
  const text = readFileSync(projectPath, "utf8");
  expect(
    !text.includes(work.slice(0, 12)) && !/[A-Za-z]:\\\\/.test(text),
    "the project file holds an absolute path",
  );
  expect(
    file.model.recipes.raisedUv.heightUm === 150 &&
      file.model.recipes.raisedUv.crownUm === 10 &&
      file.model.stock.preset === "silk" &&
      file.lighting.azimuth === 278 &&
      file.lighting.environmentDeg === 30 &&
      file.view.raisedMode === "mesh" &&
      file.model.scene.back !== null &&
      file.model.layers.some(
        (l) => l.interpretation.offsetMm[0] === 0.5 && l.interpretation.featherMm === 0.2,
      ),
    "the saved project lacks a setting",
  );
  expect(
    (await q(`return document.querySelector('[data-testid="project-name"]').dataset.dirty;`)) === "false",
    "still unsaved after saving",
  );
  ok("saved: relative source reference, content digest, every finish setting; no absolute path", saved.text);
  ok("screenshot", await app.screenshot("30-project-saved"));

  // ---------------------------------------------------------------- trusted reopen
  await newProject();
  const opened = await openProject(projectPath);
  expect(opened.kind === "opened", JSON.stringify(opened));
  expect((await relinks()).length === 0, `reopen asked about sources: ${JSON.stringify(await relinks())}`);
  await click("view-3d");
  await settled3d();
  await waitUntil(
    "coating rebuilt",
    `const s = window.__maskora.scene.faces().find(f => f.name === "front")?.stats; return !!s && s.mode === "mesh" && s.profile.heightUm === 150;`,
    30000,
  );
  const after = {
    faces: (await faces3d()).map((f) => [f.name, f.digest, f.stats?.mode]),
    samples: await material(
      "front",
      k1.samples.map((s) => s.at),
    ),
    light: await data("light"),
    camera: await data("camera"),
  };
  expect(
    JSON.stringify(after.faces) === JSON.stringify(before.faces),
    `faces ${JSON.stringify(after.faces)}`,
  );
  expect(
    JSON.stringify(after.samples) === JSON.stringify(before.samples),
    "material samples differ after reopen",
  );
  expect(
    JSON.stringify(after.light) === JSON.stringify(before.light),
    `light ${JSON.stringify(after.light)}`,
  );
  expect(
    after.camera.every((v, i) => Math.abs(v - before.camera[i]) < 0.002),
    `camera ${after.camera} vs ${before.camera}`,
  );
  expect(
    (await q(`return document.querySelector('[data-testid="project-name"]').dataset.dirty;`)) === "false",
    "a reopened project reads as changed",
  );
  ok(
    "trusted reopen: no dialog for the source; front/back digests, material samples, light and camera restored",
    after.faces.map((f) => f.join(" ")).join("; "),
  );
  mkdirSync(join(work, "copies"), { recursive: true });
  const copyPath = join(work, "copies", "job2.maskora.json");
  const savedAs = await saveProject(copyPath, { as: true });
  expect(savedAs.kind === "saved", JSON.stringify(savedAs));
  const copy = JSON.parse(readFileSync(copyPath, "utf8"));
  expect(sameContent(copy, file), "the reopened project saves different content");
  expect(
    copy.sources[0].ref.relativePath === "../art/K1.pdf",
    `copy ref ${JSON.stringify(copy.sources[0].ref)}`,
  );
  ok("saved again elsewhere: identical content, reference rebased to ../art/K1.pdf");
  await click("view-registration");
  await choose("registration-surface", "K1.pdf p. 2");
  await registered();
  const seen = await overlayAt(k1.samples.map((s) => s.at));
  const want = k1.samples.map((x) => (x.raisedUv ? "raisedUv" : x.uv ? "uv" : "none"));
  expect(JSON.stringify(seen) === JSON.stringify(want), `overlay ${seen}, expected ${want}`);
  const regDigest = await app.attr(await app.find('[data-testid="registration-page"]'), "data-digest");
  const frontDigest = before.faces.find((f) => f[0] === "front")[1];
  expect(regDigest === frontDigest, `registration ${regDigest} vs material ${frontDigest}`);
  ok(
    "reopened registration: same digest as the 3D material; raised UV still replaces ordinary UV",
    seen.join(" "),
  );
  await click("view-3d");
  ok("screenshot", await app.screenshot("31-project-reopened"));

  // ---------------------------------------------------------------- 2.1: undo, migration, failed save
  const gloss = () => q(`return document.querySelector('[data-testid="recipe-uv-gloss"]').value;`);
  const chord = async (key) => {
    await q("document.activeElement?.blur();");
    await app.actions([
      {
        type: "key",
        id: "keyboard",
        actions: [
          { type: "keyDown", value: "\uE009" },
          { type: "keyDown", value: key },
          { type: "keyUp", value: key },
          { type: "keyUp", value: "\uE009" },
        ],
      },
    ]);
    await app.releaseActions();
    await sleep(300);
  };
  const glossBefore = await gloss();
  await setField("recipe-uv-gloss", "0.4");
  expect((await gloss()) === "0.4", `gloss ${await gloss()}`);
  await chord("z");
  expect((await gloss()) === glossBefore, `undo left gloss at ${await gloss()}`);
  await chord("y");
  expect((await gloss()) === "0.4", `redo left gloss at ${await gloss()}`);
  await chord("z");
  ok(
    "Ctrl+Z undoes a recipe edit and Ctrl+Y redoes it",
    `${glossBefore} → 0.4 → ${glossBefore} → 0.4 → ${await gloss()}`,
  );

  // A project written in schema 1 opens, reads as unsaved, and saving it keeps the original beside it.
  const oldPath = join(work, "old.maskora.json");
  const v1 = { ...file, schemaVersion: 1, sources: file.sources.map((x) => ({ ...x, pages: undefined })) };
  writeFileSync(oldPath, JSON.stringify(v1, null, 2));
  const v1Bytes = readFileSync(oldPath);
  await newProject();
  const openedOld = await openProject(oldPath);
  expect(/older format \(schema 1\)/.test(openedOld.text), openedOld.text);
  expect(
    (await q(`return document.querySelector('[data-testid="project-name"]').dataset.dirty;`)) === "true",
    "an older-format project reads as saved",
  );
  await click("project-save");
  const upgraded = await fileSettled();
  const backupPath = join(work, "old (schema 1 backup).maskora.json");
  expect(/original is kept as old \(schema 1 backup\)\.maskora\.json/.test(upgraded.text), upgraded.text);
  expect(readFileSync(backupPath).equals(v1Bytes), "the backup is not the original, byte for byte");
  const now2 = JSON.parse(readFileSync(oldPath, "utf8"));
  expect(
    now2.schemaVersion === 2 && now2.sources[0].pages.length === 5,
    "the saved file is not schema 2 with geometry",
  );
  ok(
    "a schema-1 project opens as unsaved; saving writes schema 2 with page geometry and keeps the original",
    upgraded.text,
  );

  // A save that fails leaves the project unsaved and the file as it was.
  await click("print-only");
  const lockedBefore = readFileSync(oldPath);
  const lock = spawn("powershell", [
    "-NoProfile",
    "-Command",
    `$f = [System.IO.File]::Open('${oldPath}', 'Open', 'Read', 'None'); Start-Sleep -Seconds 60; $f.Close()`,
  ]);
  await sleep(1500);
  let failedSave;
  try {
    await click("project-save");
    failedSave = await fileSettled();
  } finally {
    lock.kill();
  }
  await sleep(500);
  expect(
    failedSave.kind === "failed" && /permissionDenied/.test(failedSave.text),
    JSON.stringify(failedSave),
  );
  expect(/still has unsaved changes/.test(failedSave.text), failedSave.text);
  expect(
    (await q(`return document.querySelector('[data-testid="project-name"]').dataset.dirty;`)) === "true",
    "a failed save cleared the unsaved marker",
  );
  expect(readFileSync(oldPath).equals(lockedBefore), "a failed save changed the file");
  ok(
    "a save that fails (file held open) reads as failed, keeps the project unsaved and the file unchanged",
    failedSave.text,
  );
  await click("print-only");
  await click("project-save");
  expect((await fileSettled()).kind === "saved", "saving after the lock was released failed");

  // ---------------------------------------------------------------- export
  await click("camera-front");
  await sleep(300);
  await click("export-framing-fit");
  const size = await app.find('[data-testid="export-size"]');
  await app.clear(size);
  await app.type(size, "2400");
  await click("export-png");
  await dialog(["-Title", "Export PNG", "-Cancel"]).catch(() => undefined);
  await waitUntil(
    "export cancelled",
    `return document.querySelector('[data-testid="export-status"]')?.dataset.kind === "cancelled";`,
    60000,
  );
  ok("a cancelled export dialog reads as cancelled; nothing written", (await exportStatus()).text);

  const meshPath = join(work, "mesh.png");
  const meshDone = await exportTo(meshPath);
  expect(meshDone.kind === "saved" && /^Saved mesh\.png/.test(meshDone.text), JSON.stringify(meshDone));
  const mesh = readPng(meshPath);
  const meshProbe = await lastExport();
  expect(
    mesh.width === meshProbe.width && mesh.height === meshProbe.height,
    "file size differs from the render",
  );
  expect(Math.max(mesh.width, mesh.height) === 2400, `exported ${mesh.width} × ${mesh.height}`);
  expect(mesh.text.Software?.startsWith("Maskora"), `metadata ${Object.keys(mesh.text)}`);
  expect(mesh.text["Maskora coverage"].includes(regDigest), `coverage ${mesh.text["Maskora coverage"]}`);
  expect(
    /front: approximate, coating geometry/.test(mesh.text["Maskora raised UV"]),
    mesh.text["Maskora raised UV"],
  );
  expect(mesh.text["Maskora sources"].includes(k1Sha), "sources not recorded");
  expect(/approximation/.test(mesh.text.Description), "no approximation statement");
  const frontStats = meshProbe.faces.find((f) => f.name === "front");
  expect(frontStats.coating && frontStats.stats.profile.heightUm === 150, JSON.stringify(frontStats));
  ok(
    "exported PNG: 2400 px, coverage digest = registration digest, raised UV recorded as coating geometry, sources and approximation stated",
    `${mesh.width} × ${mesh.height}, ${(mesh.bytes / 1e6).toFixed(1)} MB`,
  );

  // Pixels at projected points: relief edges where the raised mask is (x 10–40 mm), and a cast shadow past
  // its far edge only from the coating geometry. A tall, steep coating throws a shadow about 1.8 mm long under
  // the 8° grazing light; each image is judged against its own uncoated paper at x 44 mm.
  await setField("recipe-raisedUv-heightUm", "250");
  await setField("recipe-raisedUv-bevelMm", "0.3");
  const edgePts = [
    [10.15, 22],
    [40.6, 22],
    [44, 22],
    [5, 22],
  ];
  const tallPath = join(work, "mesh-tall.png");
  expect((await exportTo(tallPath)).kind === "saved", "tall coating export failed");
  const tall = readPng(tallPath);
  const meshPx = (await projectPoints("front", edgePts)).map((p) => tall.around(p, 2));
  await click("print-only");
  const printPath = join(work, "print.png");
  expect((await exportTo(printPath)).kind === "saved", "print-only export failed");
  const print = readPng(printPath);
  const printPx = (await projectPoints("front", edgePts)).map((p) => print.around(p, 2));
  expect(print.text["Maskora raised UV"] === "not shown", print.text["Maskora raised UV"]);
  await click("print-only");
  await raisedMode("Surface normals (lighter, no shadows)");
  const normalsPath = join(work, "normals.png");
  expect((await exportTo(normalsPath)).kind === "saved", "normals export failed");
  const normals = readPng(normalsPath);
  const normalsPx = (await projectPoints("front", edgePts)).map((p) => normals.around(p, 2));
  expect(/surface normals only/.test(normals.text["Maskora raised UV"]), normals.text["Maskora raised UV"]);
  const fmt = (s) => s.map((v) => v.mean.toFixed(0)).join("/");
  const drop = (px) => px[2].mean - px[1].mean;
  expect(meshPx[0].max > meshPx[2].max + 10, `lit edge: mesh ${fmt(meshPx)}`);
  expect(normalsPx[0].max > normalsPx[2].max + 10, `lit edge: normals ${fmt(normalsPx)}`);
  expect(Math.abs(printPx[0].mean - printPx[2].mean) < 2, `print-only edge: ${fmt(printPx)}`);
  expect(
    drop(meshPx) > 6 && Math.abs(drop(normalsPx)) < 2 && Math.abs(drop(printPx)) < 2,
    `shadow past the far edge (drop from paper): mesh ${drop(meshPx).toFixed(1)}, normals ${drop(normalsPx).toFixed(1)}, print ${drop(printPx).toFixed(1)}`,
  );
  ok(
    "export pixels: the raised edge brightens in both representations; only the coating geometry casts a shadow past its far edge",
    `mean lum lit/past far edge/paper/left — mesh ${fmt(meshPx)}, normals ${fmt(normalsPx)}, print ${fmt(printPx)}`,
  );
  await raisedMode("Coating geometry");
  await setField("recipe-raisedUv-heightUm", "150");
  await setField("recipe-raisedUv-bevelMm", "1");

  // Ordinary UV and the overlap rule in pixels: with raised UV hidden, where raised replaced UV nothing is coated.
  await click("light-studio");
  await click("show-raised");
  const uvPts = [
    [45, 30],
    [26, 40],
    [30, 30],
    [23, 40],
    [80, 120],
  ];
  const uvOnlyPath = join(work, "uv-only.png");
  expect((await exportTo(uvOnlyPath)).kind === "saved", "uv-only export failed");
  const uvOnly = readPng(uvOnlyPath);
  const uvPx = (await projectPoints("front", uvPts)).map((p) => uvOnly.around(p, 1));
  await click("print-only");
  const printStudioPath = join(work, "print-studio.png");
  expect((await exportTo(printStudioPath)).kind === "saved", "print-only studio export failed");
  const printStudio = readPng(printStudioPath);
  const psPx = (await projectPoints("front", uvPts)).map((p) => printStudio.around(p, 1));
  await click("print-only");
  await click("show-raised");
  const delta = uvPx.map((v, i) => v.mean - psPx[i].mean);
  expect(
    Math.abs(delta[0]) > 1.5 && Math.abs(delta[1]) > 1.5,
    `ordinary UV invisible in the export: ${delta.map((d) => d.toFixed(2))}`,
  );
  expect(
    Math.abs(delta[2]) < 0.5 && Math.abs(delta[3]) < 0.5 && Math.abs(delta[4]) < 0.5,
    `coating where there should be none: ${delta.map((d) => d.toFixed(2))}`,
  );
  ok(
    "export pixels: ordinary UV coats only its registered area; where raised UV replaced it nothing is coated when raised is hidden",
    `Δ lum vs print-only at UV, UV edge, overlap, outside edge, blank: ${delta.map((d) => d.toFixed(1)).join(", ")}`,
  );

  // The export waits for the geometry of its own settings, and later live edits do not reach it.
  await click("light-grazing");
  await setField("recipe-raisedUv-heightUm", "200");
  await click("export-png");
  await sleep(50);
  await setField("recipe-raisedUv-heightUm", "60");
  await click("print-only");
  await waitUntil(
    "frozen export rendered",
    `return ["writing", "failed"].includes(document.querySelector('[data-testid="export-status"]')?.dataset.kind);`,
    60000,
  );
  const frozenPath = join(work, "frozen.png");
  const frozenDone = await finishExport(["-Path", frozenPath]);
  expect(frozenDone.kind === "saved", JSON.stringify(frozenDone));
  const frozen = await lastExport();
  const frozenPng = readPng(frozenPath);
  const fs = frozen.faces.find((f) => f.name === "front").stats;
  expect(fs.mode === "mesh" && fs.profile.heightUm === 200, `export used ${JSON.stringify(fs.profile)}`);
  expect(JSON.parse(frozenPng.text["Maskora view"]).printOnly === false, "a live change reached the export");
  expect(/coating geometry/.test(frozenPng.text["Maskora raised UV"]), frozenPng.text["Maskora raised UV"]);
  ok(
    "export waited for raised-UV geometry built at its own 200 µm, while the live view moved on to 60 µm and print-only",
    `${fs.triangles.toLocaleString("en")} triangles`,
  );
  await click("print-only");
  await setField("recipe-raisedUv-heightUm", "150");

  // Transparent background: the page is opaque, the empty surround is not.
  await choose("export-background", "Transparent");
  const clearPath = join(work, "transparent.png");
  expect((await exportTo(clearPath)).kind === "saved", "transparent export failed");
  const clear = readPng(clearPath);
  const [centre] = await projectPoints("front", [[50, 75]]);
  expect(clear.around(centre, 2).alpha === 255, "the page is not opaque");
  expect(clear.around([2, 2], 1).alpha < 5, `corner alpha ${clear.around([2, 2], 1).alpha}`);
  ok(
    "transparent background: page opaque, surround transparent",
    `corner alpha ${clear.around([2, 2], 1).alpha}`,
  );
  await choose("export-background", "Viewport grey");

  // Overwrite, declined overwrite, and a read-only destination.
  const replaced = await exportTo(meshPath, ["-Replace", "yes"]);
  expect(replaced.kind === "saved" && /^Replaced mesh\.png/.test(replaced.text), JSON.stringify(replaced));
  ok("exporting over an existing file, confirmed, reads as replaced", replaced.text);
  const declined = await exportTo(meshPath, ["-Replace", "no"]);
  expect(declined.kind === "cancelled", JSON.stringify(declined));
  ok("declining to replace reads as cancelled", declined.text);
  // A destination another program holds open: Windows' own dialog already refuses read-only files, so this is
  // the write failure a user can actually meet. The old file must survive it.
  const busyPath = join(work, "busy.png");
  copyFileSync(printPath, busyPath);
  const busyBefore = sha(busyPath);
  const holder = spawn("powershell", [
    "-NoProfile",
    "-Command",
    `$f = [System.IO.File]::Open('${busyPath}', 'Open', 'Read', 'None'); Start-Sleep -Seconds 90; $f.Close()`,
  ]);
  await sleep(1500);
  let denied;
  try {
    denied = await exportTo(busyPath, ["-Replace", "yes"]);
  } finally {
    holder.kill();
  }
  await sleep(500);
  expect(denied.kind === "failed" && /permissionDenied/.test(denied.text), JSON.stringify(denied));
  expect(sha(busyPath) === busyBefore, "the held file changed");
  ok(
    "a destination held open by another program fails as permission denied and keeps the old file",
    denied.text,
  );
  ok("screenshot", await app.screenshot("32-export-states"));
  ok("exported still", meshPath);

  // ---------------------------------------------------------------- relink: K2 in two files
  const two = join(work, "k2");
  mkdirSync(two, { recursive: true });
  copyFileSync(join(FIXTURES, "K2a.pdf"), join(two, "K2a.pdf"));
  copyFileSync(join(FIXTURES, "K2m.pdf"), join(two, "K2m.pdf"));
  await newProject();
  await addFile(join(two, "K2a.pdf"));
  await addFile(join(two, "K2m.pdf"));
  await geometry();
  await selectThumb(0, "K2a.pdf");
  await click("role-print");
  await selectThumb(1, "K2m.pdf");
  await click("role-mask");
  await selectLayer("K2m.pdf p. 2");
  await choose("layer-target", "K2a.pdf p. 1");
  await click("view-3d");
  await choose("slot-front", "K2a.pdf p. 1");
  await settled3d();
  const k2Digest = (await faces3d()).find((f) => f.name === "front").digest;
  const k2Project = join(two, "k2.maskora.json");
  expect((await saveProject(k2Project)).kind === "saved", "K2 project not saved");

  // Moved: the mask file is somewhere else now.
  mkdirSync(join(two, "moved"), { recursive: true });
  renameSync(join(two, "K2m.pdf"), join(two, "moved", "K2m.pdf"));
  await newProject();
  await openProject(k2Project);
  let r = await relinks();
  expect(r.length === 1 && r[0].name === "K2m.pdf" && r[0].status === "missing", JSON.stringify(r));
  await click("view-3d");
  await waitUntil(
    "blocked note",
    `return !!document.querySelector('[data-testid="scene-hud"] [data-code="sourceBlocked"]');`,
  );
  expect(
    await q(`return document.querySelector('[data-testid="export-png"]').disabled;`),
    "export allowed with a missing source",
  );
  ok("moved mask file: reported missing, its page shows a blocked note, export is refused", r[0].status);
  await q(`document.querySelector('[data-section="project"]').scrollIntoView();`);
  ok("screenshot", await app.screenshot("33-relink-missing"));
  await click("relink-locate");
  await dialog(["-Title", "Locate K2m.pdf", "-Path", join(two, "moved", "K2m.pdf")]);
  await relinkMoved("K2m.pdf", "missing");
  r = await relinks();
  expect(r.length === 1 && r[0].status === "ok" && r[0].note === "moved", JSON.stringify(r));
  await settled3d();
  expect((await faces3d()).find((f) => f.name === "front").digest === k2Digest, "relinked coverage differs");
  ok("located at its new place: same content, so it comes back as moved with identical coverage", k2Digest);
  // The project came from a file, so Save writes back to it without asking.
  await click("project-save");
  const resaved = await fileSettled();
  expect(
    resaved.kind === "saved" && /Saved over k2\.maskora\.json/.test(resaved.text),
    JSON.stringify(resaved),
  );
  expect(
    JSON.parse(readFileSync(k2Project, "utf8")).sources.find((x) => x.name === "K2m.pdf").ref.relativePath ===
      "moved/K2m.pdf",
    "the relinked reference was not saved",
  );
  ok(
    "Save writes back to the opened project without a dialog; the reference now names the new place",
    resaved.text,
  );

  // Edited in place: the file at the trusted path now has other content.
  const edited = join(two, "moved", "K2m.pdf");
  copyFileSync(join(FIXTURES, "K1.pdf"), edited);
  await newProject();
  await openProject(k2Project);
  r = await relinks();
  expect(r.length === 1 && r[0].status === "needsApproval", JSON.stringify(r));
  const reason = await q(`return document.querySelector('[data-testid="relink"] .hint').textContent;`);
  expect(/differs from the one approved/.test(reason), reason);
  ok("content changed at an approved path: not opened until approved again", reason);
  await click("relink-approve");
  await dialog(["-Title", "Locate K2m.pdf", "-Path", edited]);
  await relinkMoved("K2m.pdf", "needsApproval");
  r = await relinks();
  expect(r.length === 1 && r[0].status === "changed", JSON.stringify(r));
  await click("view-3d");
  await waitUntil(
    "held note",
    `return /changed since the project was saved/.test(document.querySelector('[data-testid="scene-hud"] [data-code="sourceBlocked"]')?.textContent ?? "");`,
  );
  ok("approved changed content is held: its assignments do not render until kept", r[0].status);
  await click("relink-reconcile");
  await app.waitFor('[data-testid="reconcile"]');
  const rows = await q(
    `return [...document.querySelectorAll('[data-testid="reconcile-row"]')].map(r => r.dataset.page + ":" + r.textContent);`,
  );
  expect(rows.length === 1 && rows[0].startsWith("1:"), `rows ${rows}`);
  // The mask was the old file's page 2; in the new file it is page 4.
  await app.click(await app.find('[data-testid="reconcile-target"] option:nth-child(5)'));
  await sleep(200);
  const sizeNote = await q(
    `return document.querySelector('[data-testid="reconcile-size"]')?.textContent ?? "";`,
  );
  const effectsText = await q(
    `return document.querySelector('[data-testid="reconcile-effects"]').textContent;`,
  );
  await q(`document.querySelector('[data-section="project"]').scrollIntoView();`);
  ok("screenshot", await app.screenshot("34-relink-held"));
  await click("reconcile-apply");
  await sleep(300);
  r = await relinks();
  expect(r[0].status === "ok" && r[0].note === "reconciled", JSON.stringify(r));
  await settled3d();
  const keptDigest = (await faces3d()).find((f) => f.name === "front").digest;
  expect(keptDigest !== k2Digest, "reconciled content rendered the old coverage");
  ok(
    "reconciled page by page: the old page 2's finish moved to the new file's page 4 and renders its coverage",
    `${keptDigest}; ${sizeNote || "same size"}; ${effectsText}`,
  );

  // Imported: the same project and files copied elsewhere are trusted for nothing.
  const imported = join(work, "imported");
  cpSync(two, imported, { recursive: true });
  await newProject();
  await openProject(join(imported, "k2.maskora.json"));
  r = await relinks();
  expect(r.length === 2 && r.every((x) => x.status === "needsApproval"), JSON.stringify(r));
  expect(
    (await q(`return document.querySelectorAll('[data-testid="source"]').length;`)) === 0,
    "an imported project opened a source",
  );
  const unfamiliar = await q(`return document.querySelector('[data-testid="relink"] .hint').textContent;`);
  expect(/Not yet opened in Maskora on this computer/.test(unfamiliar), unfamiliar);
  ok("a copied project with copied files: both need approval; nothing was opened", unfamiliar);
  await q(`document.querySelector('[data-section="project"]').scrollIntoView();`);
  ok("screenshot", await app.screenshot("35-relink-imported"));
  await click("relink-approve");
  await dialog(["-Title", "Locate K2a.pdf", "-Path", join(imported, "K2a.pdf")]);
  await relinkMoved("K2a.pdf", "needsApproval");
  r = await relinks();
  expect(r.find((x) => x.name === "K2a.pdf").note === "approved", JSON.stringify(r));
  ok("approved one source; the other still waits", JSON.stringify(r.map((x) => `${x.name}:${x.status}`)));
  await newProject();

  // ---------------------------------------------------------------- sources untouched
  for (const [f, d] of Object.entries(originals))
    expect(sha(join(FIXTURES, `${f}.pdf`)) === d, `fixture ${f} changed`);
  expect(sha(k1Path) === k1Sha, "the project's K1 copy changed");
  expect(sha(join(imported, "K2a.pdf")) === originals.K2a, "K2a copy changed");
  expect(statSync(projectPath).size > 0, "project vanished");
  ok(
    "no source PDF changed: fixtures and the project's copies keep their digests",
    Object.keys(originals).join(", "),
  );
}

/**
 * Unsaved work survives a crash (architecture §9.2, §12): with a change made
 * and its snapshot written, the app is killed, started again, and offers the
 * work back. Runs in its own sessions after the main smoke; `smoke.mjs` has
 * already set aside any snapshot that was there before the run.
 */
export async function crashRecoveryChecks({ openApp, ok, expect, sleep, dialog, FIXTURES, ROOT }) {
  const slot = recoverySlot();
  rmSync(slot, { force: true });
  const work = join(ROOT, "probe-out", "smoke", `recovery-${Date.now()}`);
  mkdirSync(work, { recursive: true });
  const k1 = join(work, "K1.pdf");
  copyFileSync(join(FIXTURES, "K1.pdf"), k1);
  let app = await openApp();
  const q = (script, ...args) => app.exec(script, ...args);
  const click = async (testid) => app.click(await app.find(`[data-testid="${testid}"]`));
  const until = async (what, test, timeoutMs = 20000) => {
    const end = Date.now() + timeoutMs;
    while (!(await test())) {
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
      await sleep(250);
    }
  };
  try {
    await app.waitFor('[data-testid="viewport"] canvas');
    await click("open-pdf");
    await dialog(["-Path", k1]);
    await until(
      "K1 added",
      async () =>
        (await q(`return document.querySelector('[data-testid="geometry-status"]')?.dataset.status;`)) ===
        "available",
    );
    const thickness = await app.find('[data-testid="stock-thickness"]');
    // Select all, then type: the field is controlled, and clearing it alone is undone on the next render.
    await app.type(thickness, "a1.2");
    const typed = await q(`return document.querySelector('[data-testid="stock-thickness"]').value;`);
    expect(typed === "1.2", `the edit did not take: ${typed}`);
    await until("recovery snapshot written", async () => existsSync(slot), 15000);
    execFileSync("taskkill", ["/F", "/IM", "maskora.exe"], { stdio: "ignore" });
    await app.close().catch(() => undefined);
    ok("unsaved work was snapshotted, then the app was killed", slot);

    app = await openApp();
    await app.waitFor('[data-testid="recovery-offer"]');
    const offer = await q(`return document.querySelector('[data-testid="recovery-offer"]').textContent;`);
    ok("screenshot", await app.screenshot("36-recovery-offer"));
    await click("recovery-recover");
    await until(
      "recovered sources loaded",
      async () =>
        (await q(`return document.querySelector('[data-testid="geometry-status"]')?.dataset.status;`)) ===
        "available",
    );
    const state = await q(`return {
      thickness: document.querySelector('[data-testid="stock-thickness"]').value,
      dirty: document.querySelector('[data-testid="project-name"]').dataset.dirty,
      status: document.querySelector('[data-testid="project-status"]').dataset.kind,
      relink: document.querySelectorAll('[data-testid="relink"]').length,
    };`);
    expect(
      state.thickness === "1.2" &&
        state.dirty === "true" &&
        state.status === "recovered" &&
        state.relink === 0,
      JSON.stringify(state),
    );
    ok(
      "after a restart the work is offered, and recovering it brings back the edit, still unsaved",
      offer.trim(),
    );
    await until(
      "the recovered page drawn",
      async () =>
        (await q(
          `const v = document.querySelector('[data-testid="viewport"]'); return v.dataset.faces !== "" && v.dataset.busy === "false";`,
        )) === true,
      30000,
    );
    ok("screenshot", await app.screenshot("37-recovered"));
    // Discarding the work (New, confirmed) forgets the snapshot.
    await click("project-new");
    await sleep(150);
    if (await q(`return !!document.querySelector('[data-testid="project-confirm"]');`))
      await click("project-new");
    await until("snapshot forgotten", async () => !existsSync(slot), 15000);
    ok("once the work is discarded the snapshot is gone");
  } finally {
    await app.close().catch(() => undefined);
  }
}

/** This installation's recovery snapshot, in local app data. */
export function recoverySlot() {
  return join(process.env.LOCALAPPDATA, "com.manis.maskora", "recovery.json");
}

/**
 * Keep a snapshot that was there before the run (it may be real unsaved work)
 * out of the smoke's way; `restore` deletes whatever the run left and puts it back.
 */
export function asideRecovery() {
  const slot = recoverySlot();
  const aside = `${slot}.smoke-aside`;
  if (existsSync(slot) && !existsSync(aside)) renameSync(slot, aside);
  return {
    restore() {
      rmSync(slot, { force: true });
      if (existsSync(aside)) renameSync(aside, slot);
    },
  };
}
