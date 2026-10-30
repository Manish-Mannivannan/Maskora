#!/usr/bin/env node
/**
 * Native smoke: start the built Maskora app in its real WebView2 window and
 * check that the static export loaded and the interface answers.
 *
 *   npx tauri build --debug --no-bundle   (embeds out/ in the binary)
 *   npm run smoke
 *
 * Each check prints one line; screenshots land in probe-out/smoke/ and are
 * meant to be read, not just produced. Exits 1 on the first failed check.
 */
import { openApp } from "./webdriver.mjs";

const results = [];
function pass(name, detail) {
  results.push({ name, ok: true });
  console.log(`  ok   ${name}${detail ? ` — ${detail}` : ""}`);
}

const app = await openApp();
try {
  console.log(`smoke: ${app.where.app} on WebView2 ${app.where.version}`);

  const status = await app.waitFor('[data-testid="shell-status"]');
  pass("static export loaded", await app.text(status));

  const origin = await app.exec("return location.origin + ' ' + document.title;");
  if (!/^http:\/\/tauri\.localhost/.test(origin)) throw new Error(`unexpected origin: ${origin}`);
  pass("served from the app's own origin", origin);

  pass("screenshot", await app.screenshot("01-shell"));
} catch (error) {
  console.error(`  FAIL ${error.message}`);
  process.exitCode = 1;
} finally {
  await app.close();
}
if (!process.exitCode) console.log(`smoke: ${results.length} checks passed`);
