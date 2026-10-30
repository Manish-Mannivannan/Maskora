#!/usr/bin/env node
/**
 * VERSIONS.md must state the versions actually locked.
 *
 * A version table that drifts from the lockfiles is worse than none: it is
 * read as the truth. This compares every package and crate row with
 * `package-lock.json` and `src-tauri/Cargo.lock`, the Rust row with
 * `rust-toolchain.toml`, and checks each npm dependency is pinned exactly.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (p) => readFileSync(join(root, p), "utf8");

const versionsMd = read("VERSIONS.md");
const section = (title) => {
  const start = versionsMd.indexOf(`## ${title}`);
  if (start < 0) throw new Error(`VERSIONS.md has no "## ${title}" section`);
  const rest = versionsMd.slice(start + 3);
  const end = rest.search(/^## /m);
  return end < 0 ? rest : rest.slice(0, end);
};
const rows = (text) =>
  [...text.matchAll(/^\| ([^|]+?) \| ([^|]+?) \|/gm)]
    .map(([, a, b]) => [a.trim(), b.trim()])
    .filter(([a]) => !/^-+$/.test(a) && a !== "Package" && a !== "Crate" && a !== "Tool");

const problems = [];

const pkg = JSON.parse(read("package.json"));
const lock = JSON.parse(read("package-lock.json")).packages;
const declared = { ...pkg.dependencies, ...pkg.devDependencies };
for (const [name, range] of Object.entries(declared)) {
  if (!/^\d+\.\d+\.\d+$/.test(range))
    problems.push(`package.json: ${name} is "${range}", not an exact version`);
}
const npmRows = new Map(rows(section("npm packages")));
for (const name of Object.keys(declared)) {
  if (!npmRows.has(name)) problems.push(`VERSIONS.md: no row for npm package ${name}`);
}
for (const [name, version] of npmRows) {
  const locked = lock[`node_modules/${name}`]?.version;
  if (locked !== version)
    problems.push(`VERSIONS.md: ${name} ${version}, but package-lock.json has ${locked}`);
}

const cargoLock = read("src-tauri/Cargo.lock");
for (const [name, version] of rows(section("Rust crates"))) {
  const locked = [...cargoLock.matchAll(new RegExp(`name = "${name}"\nversion = "([^"]+)"`, "g"))].map(
    (m) => m[1],
  );
  if (!locked.includes(version))
    problems.push(`VERSIONS.md: crate ${name} ${version}, but Cargo.lock has ${locked.join(", ") || "none"}`);
}

const toolchain = /channel = "([^"]+)"/.exec(read("rust-toolchain.toml"))?.[1];
const rustRow = rows(section("Toolchain")).find(([tool]) => tool === "Rust")?.[1];
if (rustRow !== toolchain)
  problems.push(`VERSIONS.md: Rust ${rustRow}, but rust-toolchain.toml has ${toolchain}`);

if (problems.length > 0) {
  console.error(`VERSIONS.md disagrees with the lockfiles:\n\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(
  `check-versions: VERSIONS.md matches ${npmRows.size} npm packages, the Rust crates and toolchain.`,
);
