#!/usr/bin/env node
/**
 * Per-clone setup that git cannot carry in the repository. Run by
 * `npm run setup` after `npm ci`.
 *
 * - Tracked hooks: `core.hooksPath .githooks`, so the hooks that review sees
 *   are the hooks that run (also set by the `prepare` script on install).
 * - Graphify's union merge driver for `graphify-out/graph.json`, named in
 *   `.gitattributes` but registered only in local git config.
 * - Rust dependencies fetched for the pinned toolchain.
 *
 * Re-runnable; each step reports what it did.
 */
import { execFileSync } from "node:child_process";

function run(cmd, args) {
  return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

run("git", ["config", "core.hooksPath", ".githooks"]);
console.log("setup: git hooks path is .githooks");

try {
  run("graphify", ["--version"]);
  run("git", ["config", "merge.graphify.name", "graphify graph.json union merge"]);
  run("git", ["config", "merge.graphify.driver", "graphify merge-driver %O %A %B"]);
  console.log("setup: graphify merge driver registered");
} catch {
  console.warn(
    "setup: graphify CLI not found; install it (`uv tool install graphifyy`) and rerun, or graph.json merges will conflict",
  );
}

execFileSync("cargo", ["fetch", "--manifest-path", "src-tauri/Cargo.toml"], { stdio: "inherit" });
console.log("setup: Rust dependencies fetched");
