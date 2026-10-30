/**
 * A minimal W3C WebDriver client for driving the real Maskora window.
 *
 * Tauri's supported route to automate its Windows WebView2 is `tauri-driver`
 * in front of Microsoft's `msedgedriver`, whose version must match the
 * installed WebView2 runtime. This module starts both, opens a session on a
 * built Maskora binary, and exposes the handful of commands the smoke and
 * probe scripts need. It speaks plain HTTP through `fetch`; no client library.
 *
 * Locations (overridable):
 *   MASKORA_APP          the built app (default src-tauri/target/debug/maskora.exe)
 *   MASKORA_EDGEDRIVER   msedgedriver.exe (default ~/.local/share/msedgedriver/<WebView2 version>/)
 *   MASKORA_TAURI_DRIVER tauri-driver (default ~/.cargo/bin/tauri-driver.exe)
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.MASKORA_WEBDRIVER_PORT ?? 4444);
const BASE = `http://127.0.0.1:${PORT}`;
const ELEMENT = "element-6066-11e4-a52e-4f735466cecf";

/** The installed WebView2 runtime version, read from its registry key. */
export function webview2Version() {
  const key =
    "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
  const out = execFileSync("reg", ["query", key, "/v", "pv"], { encoding: "utf8" });
  const version = /pv\s+REG_SZ\s+(\S+)/.exec(out)?.[1];
  if (!version) throw new Error("WebView2 runtime version not found in the registry");
  return version;
}

function locate() {
  const app = resolve(process.env.MASKORA_APP ?? join(ROOT, "src-tauri", "target", "debug", "maskora.exe"));
  const version = webview2Version();
  const edgedriver =
    process.env.MASKORA_EDGEDRIVER ??
    join(homedir(), ".local", "share", "msedgedriver", version, "msedgedriver.exe");
  const tauriDriver =
    process.env.MASKORA_TAURI_DRIVER ?? join(homedir(), ".cargo", "bin", "tauri-driver.exe");
  for (const [what, path, how] of [
    ["the built app", app, "npx tauri build --debug --no-bundle"],
    [
      `msedgedriver ${version}`,
      edgedriver,
      `download https://msedgedriver.microsoft.com/${version}/edgedriver_win64.zip`,
    ],
    ["tauri-driver", tauriDriver, "cargo install tauri-driver --locked"],
  ]) {
    if (!existsSync(path)) throw new Error(`${what} not found at ${path} (${how})`);
  }
  return { app, edgedriver, tauriDriver, version };
}

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.value?.error) {
    throw new Error(
      `WebDriver ${method} ${path} failed: ${json.value?.error ?? res.status} ${json.value?.message ?? ""}`,
    );
  }
  return json.value;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Start the drivers and open the app. Returns a session with helpers; always `await session.close()`. */
export async function openApp({ shotsDir = join(ROOT, "probe-out", "smoke") } = {}) {
  const where = locate();
  const driver = spawn(where.tauriDriver, ["--port", String(PORT), "--native-driver", where.edgedriver], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let driverLog = "";
  driver.stdout.on("data", (d) => (driverLog += d));
  driver.stderr.on("data", (d) => (driverLog += d));

  for (let i = 0; ; i += 1) {
    try {
      await fetch(`${BASE}/status`);
      break;
    } catch {
      if (i > 50) throw new Error(`tauri-driver did not start:\n${driverLog}`);
      await sleep(200);
    }
  }

  let sessionId;
  try {
    const created = await call("POST", "/session", {
      capabilities: { alwaysMatch: { browserName: "wry", "tauri:options": { application: where.app } } },
    });
    sessionId = created.sessionId;
  } catch (error) {
    driver.kill();
    throw new Error(`${error.message}\n${driverLog}`);
  }

  mkdirSync(shotsDir, { recursive: true });
  const s = (path) => `/session/${sessionId}${path}`;
  const session = {
    where,
    shotsDir,
    /** Run a script in the page. `script` is a function body; `args` are JSON values. */
    exec: (script, ...args) => call("POST", s("/execute/sync"), { script, args }),
    /** Run an async script: the body receives `done` as its last argument. */
    execAsync: (script, ...args) => call("POST", s("/execute/async"), { script, args }),
    find: async (css) => (await call("POST", s("/element"), { using: "css selector", value: css }))[ELEMENT],
    text: (id) => call("GET", s(`/element/${id}/text`)),
    click: (id) => call("POST", s(`/element/${id}/click`), {}),
    clear: (id) => call("POST", s(`/element/${id}/clear`), {}),
    type: (id, text) => call("POST", s(`/element/${id}/value`), { text }),
    attr: (id, name) => call("GET", s(`/element/${id}/attribute/${name}`)),
    rect: (id) => call("GET", s(`/element/${id}/rect`)),
    actions: (actions) => call("POST", s("/actions"), { actions }),
    releaseActions: () => call("DELETE", s("/actions")),
    windowRect: () => call("GET", s("/window/rect")),
    setTimeouts: (t) => call("POST", s("/timeouts"), t),
    /** Wait until a CSS selector exists, or fail after `timeoutMs`. */
    async waitFor(css, timeoutMs = 20000) {
      const until = Date.now() + timeoutMs;
      for (;;) {
        try {
          return await session.find(css);
        } catch (error) {
          if (Date.now() > until) throw new Error(`timed out waiting for ${css}: ${error.message}`);
          await sleep(250);
        }
      }
    },
    /** Save a screenshot of the window's web content; returns the file path. */
    async screenshot(name) {
      const png = Buffer.from(await call("GET", s("/screenshot")), "base64");
      const file = join(shotsDir, `${name}.png`);
      writeFileSync(file, png);
      return file;
    },
    async close() {
      try {
        await call("DELETE", s(""));
      } finally {
        driver.kill();
      }
    },
  };
  await session.setTimeouts({ script: 120000 });
  return session;
}
