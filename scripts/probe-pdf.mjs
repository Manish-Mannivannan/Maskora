#!/usr/bin/env node
/**
 * Phase 0.4 PDF compatibility probe, run in the real WebView2 window.
 *
 *   NEXT_PUBLIC_MASKORA_PROBE=1 npx tauri build --debug --no-bundle
 *   node scripts/probe-pdf.mjs
 *
 * Feeds the synthetic corpus (tests/fixtures/pdf) to PDF.js inside the app,
 * checks raster coverage, masks, annotations and optional content against
 * positions computed here from each fixture's own geometry, records failure
 * and password behaviour, runs the native geometry command on a
 * dialog-selected fixture, and measures timings, memory and WebGL limits.
 * Writes probe-out/probe-0.4.json and screenshots; prints one line per check.
 * Exits 1 if any acceptance check fails; measurements are reported, not judged.
 */
import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { ROOT, openApp } from "./webdriver.mjs";

const run = promisify(execFile);
const FIXTURES = join(ROOT, "tests", "fixtures", "pdf");
const OUT = join(ROOT, "probe-out");
const b64 = (id) => readFileSync(join(FIXTURES, `${id}.pdf`)).toString("base64");
const expected = (id) => JSON.parse(readFileSync(join(FIXTURES, `${id}.expected.json`), "utf8"));

const report = {
  machine: process.env.COMPUTERNAME,
  startedAt: new Date().toISOString(),
  checks: [],
  measurements: {},
};
let failures = 0;
function check(name, ok, detail) {
  report.checks.push({ name, ok, detail });
  if (!ok) failures += 1;
  console.log(
    `  ${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`,
  );
}

/**
 * A known engine behaviour, pinned: passes while PDF.js behaves exactly as
 * recorded in the plan, fails ("behaviour changed; revisit") if it changes.
 */
function known(name, actual, recorded) {
  const unchanged = JSON.stringify(actual) === JSON.stringify(recorded) || same(actual, recorded);
  report.checks.push({ name, ok: unchanged, known: true, detail: actual });
  if (!unchanged) failures += 1;
  console.log(
    `  ${unchanged ? "known" : "FAIL "} ${name}${unchanged ? "" : ` — behaviour changed; revisit: ${JSON.stringify(actual)}`}`,
  );
}

/** Device pixel of user-space point (x, y) in a render of `region` at scale `s` and rotation `rot`. */
function devicePoint([x, y], [llx, lly, urx, ury], rot, s) {
  switch (rot) {
    case 0:
      return [(x - llx) * s, (ury - y) * s];
    case 90:
      return [(y - lly) * s, (x - llx) * s];
    case 180:
      return [(urx - x) * s, (y - lly) * s];
    case 270:
      return [(ury - y) * s, (urx - x) * s];
    default:
      throw new Error(`rotation ${rot}`);
  }
}
const centre = ([x, y, w, h]) => [x + w / 2, y + h / 2];
const matches = (px, rgb, tol = 40) =>
  px !== null && px[3] > 200 && rgb.every((c, i) => Math.abs(px[i] - Math.round(c * 255)) <= tol);
/** Deep equality independent of key order: WebDriver returns object keys sorted. */
const same = (a, b) => {
  if (Array.isArray(a) || Array.isArray(b))
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => same(v, b[i]));
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    return same(ka, kb) && ka.every((k) => same(a[k], b[k]));
  }
  return a === b;
};
const luminance = (px) => (0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2]) / 255;

const memoryOfApp = () => {
  const out = execFileSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      "(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'maskora.exe' -or ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -like '*maskora*') } | Measure-Object WorkingSetSize -Sum).Sum",
    ],
    { encoding: "utf8" },
  );
  return Math.round(Number(out.trim()) / (1024 * 1024));
};

mkdirSync(OUT, { recursive: true });
const app = await openApp({ shotsDir: join(OUT, "probe") });
try {
  await app.waitFor('[data-testid="viewport"] canvas');
  for (let i = 0; i < 40 && !(await app.exec("return !!window.__maskoraProbe;")); i += 1)
    await new Promise((r) => setTimeout(r, 250));
  const probe = (fn, ...args) =>
    app.execAsync(
      `const done = arguments[arguments.length - 1]; const [fn, args] = [arguments[0], arguments[1]];
       window.__maskoraProbe[fn](...args).then(done, (e) => done({ error: String(e && e.stack || e) }));`,
      fn,
      args,
    );
  report.pdfjs = await probe("pdfjsVersion");
  report.webview2 = app.where.version;
  console.log(`probe: PDF.js ${report.pdfjs} in WebView2 ${report.webview2}`);

  // 1. What PDF.js's public API exposes about geometry.
  console.log("geometry (PDF.js public API)");
  for (const id of ["G1", "G3", "G5", "G6", "G8"]) {
    const facts = await probe("geometry", b64(id));
    const want = expected(id).pages;
    const cropOk = facts.every(
      (p, i) => JSON.stringify(p.view) === JSON.stringify(want[i].boxes.CropBox.effective),
    );
    const rotOk = facts.every((p, i) => p.rotate === (want[i].rotate.effective ?? "invalid"));
    report.measurements[`pdfjsGeometry${id}`] = facts;
    check(`${id}: PDF.js view equals the effective CropBox`, cropOk);
    if (id === "G5") {
      // Known: PDF.js turns the invalid Rotate 45 into 0. Native geometry is authoritative for rotation.
      known(
        "G5: PDF.js reports invalid Rotate 45 as 0",
        facts.map((p) => p.rotate),
        [90, 180, 270, 0, 270, 90],
      );
    } else {
      check(`${id}: PDF.js rotate matches`, rotOk, facts.map((p) => p.rotate).join(","));
    }
  }
  const g6 = report.measurements.pdfjsGeometryG6[0];
  report.measurements.pdfjsAppliesUserUnitToViewport = g6.viewport1[0] !== g6.view[2] - g6.view[0];

  // 2. Raster coverage: every region of R1 and R2, marks where the fixture says.
  console.log("raster coverage");
  const SCALE = 2;
  for (const id of ["R1", "R2"]) {
    for (const page of expected(id).pages) {
      for (const region of ["MediaBox", "CropBox", "BleedBox", "TrimBox"]) {
        const label = `${id} p${page.index} rot${page.rotate} uu${page.userUnit} ${region}`;
        const first = await probe(
          "renderAndSample",
          b64(id),
          page.index,
          page.boxes[region],
          SCALE,
          [],
          {},
          "",
        );
        // The effective scale from the rendered size: PDF.js multiplies by UserUnit.
        const [llx, lly, urx, ury] = page.boxes[region];
        const s = first.size[0] / (page.rotate % 180 === 0 ? urx - llx : ury - lly);
        report.measurements[`scale ${label}`] = {
          requested: SCALE,
          effective: s,
          reported: first.viewportScale,
        };
        const points = page.marks.map((m) => devicePoint(centre(m.rect), page.boxes[region], page.rotate, s));
        const res = await probe(
          "renderAndSample",
          b64(id),
          page.index,
          page.boxes[region],
          SCALE,
          points,
          {},
          label,
        );
        const results = page.marks.map((m, i) => {
          const want = m.in.includes(region);
          const got = matches(res.pixels[i], m.color);
          return { mark: m.id, want, got, ok: want === got, pixel: res.pixels[i] };
        });
        check(
          `${label}: marks present exactly where expected`,
          results.every((r) => r.ok),
          results.filter((r) => !r.ok),
        );
      }
    }
  }
  await app.screenshot("05-coverage-renders");
  await app.exec("document.querySelector('[data-testid=probe-overlay]')?.replaceChildren();");

  // 3. Masks: luminance and alpha at known points, transparent background.
  console.log("masks");
  for (const id of ["M1", "M2", "M3"]) {
    const page = expected(id).pages[0];
    const region = page.boxes.MediaBox;
    const points = page.samples.map((smp) => devicePoint(smp.at, region, 0, SCALE));
    const res = await probe(
      "renderAndSample",
      b64(id),
      0,
      region,
      SCALE,
      points,
      { background: "rgba(0,0,0,0)" },
      `${id} transparent bg`,
    );
    report.measurements[`mask${id}`] = res.pixels;
    if (id === "M3") {
      const lum = res.pixels.map(luminance);
      const monotonic = lum.every((v, i) => i === 0 || v > lum[i - 1]);
      check(
        "M3: luminance rises band by band (thresholds measurable)",
        monotonic,
        lum.map((v) => v.toFixed(2)).join(" "),
      );
    } else {
      const [inside, outside] = res.pixels;
      const lumCov = [1 - luminance(inside), outside[3] === 0 ? 0 : 1 - luminance(outside)];
      const alphaCov = [inside[3] / 255, outside[3] / 255];
      check(`${id}: luminance separates inside from outside`, lumCov[0] > 0.9 && lumCov[1] < 0.1, {
        inside,
        outside,
      });
      const alphaSeparates = alphaCov[0] > 0.9 && alphaCov[1] < 0.1;
      check(
        `${id}: alpha ${page.alphaUsable ? "separates" : "does not separate (painted page)"}`,
        alphaSeparates === page.alphaUsable,
        { alphaCov },
      );
    }
  }

  // 4. Annotations under each annotation mode and intent.
  console.log("annotations");
  const a1 = expected("A1").pages[0];
  const aPoints = a1.annotations.map((a) => devicePoint(a.at, a1.boxes.MediaBox, 0, SCALE));
  report.measurements.annotations = [];
  for (const intent of ["display", "print"]) {
    for (const [modeName, mode] of [
      ["DISABLE", 0],
      ["ENABLE", 1],
      ["ENABLE_FORMS", 2],
    ]) {
      const res = await probe(
        "renderAndSample",
        b64("A1"),
        0,
        a1.boxes.MediaBox,
        SCALE,
        aPoints,
        { intent, annotationMode: mode },
        `A1 ${intent} ${modeName}`,
      );
      const shown = Object.fromEntries(a1.annotations.map((a, i) => [a.id, matches(res.pixels[i], a.color)]));
      report.measurements.annotations.push({ intent, mode: modeName, shown });
      console.log(`  ..   A1 ${intent} ${modeName}: ${JSON.stringify(shown)}`);
    }
  }
  const printDisable = report.measurements.annotations.find(
    (r) => r.intent === "print" && r.mode === "DISABLE",
  ).shown;
  check(
    "A1: annotations can be excluded from a print-artwork render",
    Object.values(printDisable).every((v) => !v),
  );
  const printEnable = report.measurements.annotations.find(
    (r) => r.intent === "print" && r.mode === "ENABLE",
  ).shown;
  check(
    "A1: print intent honours the print flag",
    printEnable.printSquare && !printEnable.noPrintSquare,
    printEnable,
  );

  // 5. Optional content by intent.
  console.log("optional content");
  const o1 = expected("O1").pages[0];
  const oPoints = o1.groups.map((g) => devicePoint(g.at, o1.boxes.MediaBox, 0, SCALE));
  report.measurements.optionalContent = {};
  for (const intent of ["display", "print"]) {
    const res = await probe(
      "renderAndSample",
      b64("O1"),
      0,
      o1.boxes.MediaBox,
      SCALE,
      oPoints,
      { intent, ocIntent: intent },
      `O1 ${intent}`,
    );
    const shown = Object.fromEntries(o1.groups.map((g, i) => [g.id, matches(res.pixels[i], g.color)]));
    report.measurements.optionalContent[intent] = shown;
    const want = Object.fromEntries(o1.groups.map((g) => [g.id, intent === "display" ? g.view : g.print]));
    if (intent === "print") {
      // Known: PDF.js hides the view-only group for print but does not switch on a
      // print-only group that is off in /D, so /AS print usage is only half applied.
      known("O1: PDF.js print intent shows neither group", shown, { ViewOnly: false, PrintOnly: false });
    } else {
      check("O1: display intent shows the groups that are on for viewing", same(shown, want), shown);
    }
  }
  await app.screenshot("06-masks-annotations-oc");
  await app.exec("document.querySelector('[data-testid=probe-overlay]')?.replaceChildren();");

  // 6. Malformed and encrypted inputs.
  console.log("failures and passwords");
  const opened = {};
  for (const [label, id, pw] of [
    ["X1a truncated", "X1a"],
    ["X1b broken xref", "X1b"],
    ["X1c not a PDF", "X1c"],
    ["E1a owner-password only", "E1a"],
    ["E1b no password", "E1b"],
    ["E1b wrong password", "E1b", "wrong"],
    ["E1b right password", "E1b", "maskora"],
  ]) {
    opened[label] = await probe("open", b64(id), pw);
    console.log(`  ..   ${label}: ${JSON.stringify(opened[label])}`);
  }
  report.measurements.open = opened;
  check(
    "X1a/X1c fail by name, quickly",
    ["X1a truncated", "X1c not a PDF"].every(
      (k) => !opened[k].ok && opened[k].name === "InvalidPDFException" && opened[k].ms < 5000,
    ),
  );
  check("X1b is rebuilt or fails by name", opened["X1b broken xref"].ok || !!opened["X1b broken xref"].name);
  check(
    "E1a opens without a password and reports permissions",
    opened["E1a owner-password only"].ok && Array.isArray(opened["E1a owner-password only"].permissions),
  );
  check(
    "E1b: refused without (code 1) and with a wrong password (code 2), opens with the right one",
    opened["E1b no password"].code === 1 &&
      opened["E1b wrong password"].code === 2 &&
      opened["E1b right password"].ok,
  );

  // 7. The native geometry command on a dialog-selected file, end to end in the app.
  console.log("native geometry through the app");
  const pick = app.execAsync(`const done = arguments[arguments.length - 1];
    window.__TAURI_INTERNALS__.invoke("select_source").then(done, (e) => done({ error: e }));`);
  await run("powershell", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    join(ROOT, "scripts", "dialog.ps1"),
    "-Path",
    join(FIXTURES, "G3.pdf"),
  ]);
  const source = await pick;
  const native = await app.execAsync(
    `const done = arguments[arguments.length - 1];
     window.__TAURI_INTERNALS__.invoke("inspect_geometry", { handle: arguments[0], password: null }).then(done, (e) => done({ error: e }));`,
    source.handle,
  );
  const g3 = expected("G3").pages;
  const nativeOk =
    Array.isArray(native) &&
    native.every(
      (p, i) =>
        p.boxes.every(([name, fact]) => same(fact, g3[i].boxes[name])) && same(p.rotate, g3[i].rotate),
    );
  check(
    "G3 via select_source + inspect_geometry in the app matches the expected boxes, origins and rotation",
    nativeOk,
  );
  report.measurements.nativeG3 = native;

  // Cancellation: a large render cancelled mid-way, and a document destroyed while loading.
  const cancel = await probe("cancellation", b64("X2c"), b64("X2a"), 20);
  report.measurements.cancellation = cancel;
  check(
    "a cancelled render ends as RenderingCancelledException, promptly",
    cancel.render.ended === "RenderingCancelledException" && cancel.render.ms < 2000,
    cancel.render,
  );
  check("a destroyed load never completes", cancel.load.ended !== "completed", cancel.load);

  // 8. Measurements (reported, not judged): five runs each where it applies.
  console.log("measurements");
  const thumbs = [];
  for (let r = 0; r < 5; r += 1) thumbs.push(await probe("thumbnails", b64("X2a"), 160));
  report.measurements.thumbnails500 = thumbs;
  const stat = (xs) => ({
    median: Math.round([...xs].sort((a, b) => a - b)[2]),
    max: Math.round(Math.max(...xs)),
  });
  console.log(
    `  ..   X2a 500 pages @160px: open ${JSON.stringify(stat(thumbs.map((t) => t.openMs)))} ms, first thumbnail ${JSON.stringify(stat(thumbs.map((t) => t.firstThumbnailMs)))} ms, all ${JSON.stringify(stat(thumbs.map((t) => t.allMs)))} ms`,
  );
  report.measurements.renders = {};
  for (const id of ["X2c", "X2b", "R1"]) {
    for (const width of [1500, 4000]) {
      const res = await probe("renderTimes", b64(id), width, 5, width === 1500 ? `${id} @${width}` : "");
      report.measurements.renders[`${id}@${width}`] = res;
      console.log(
        `  ..   ${id} page render @${width}px: median ${Math.round(res.medianMs)} ms, max ${Math.round(res.maxMs)} ms`,
      );
    }
  }
  report.measurements.frames = await probe("framesDuringRender", b64("X2c"), 4000);
  console.log(`  ..   frames during a 4000px X2c render: ${JSON.stringify(report.measurements.frames)}`);
  const memBefore = memoryOfApp();
  report.measurements.switches = await probe("pageSwitches", b64("X2a"), 1200, 50);
  const memAfter = memoryOfApp();
  report.measurements.processMemoryMb = { before: memBefore, after: memAfter };
  console.log(
    `  ..   50 page switches @1200px: heap ${JSON.stringify(report.measurements.switches)}, app processes ${memBefore} → ${memAfter} MB`,
  );
  report.measurements.textures = await probe("textures");
  console.log(`  ..   WebGL: ${JSON.stringify(report.measurements.textures)}`);
  await app.screenshot("07-measurement-renders");
} catch (error) {
  console.error(`  FAIL ${error.stack ?? error}`);
  failures += 1;
} finally {
  await app.close();
  report.failures = failures;
  writeFileSync(join(OUT, "probe-0.4.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `probe: ${report.checks.length} checks, ${failures} failed; report in probe-out/probe-0.4.json`,
  );
  process.exitCode = failures ? 1 : 0;
}
