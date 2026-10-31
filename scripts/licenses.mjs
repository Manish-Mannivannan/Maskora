#!/usr/bin/env node
/**
 * Third-party license inventory for what the installed app ships (architecture §14, plan 2.4).
 *
 *   npm run licenses     writes probe-out/licenses/inventory.md and .json; exits 1 on a license that is
 *                        not on the accepted list and not reviewed below
 *
 * Covers the npm production dependency tree (a superset of what the static
 * export bundles), the Rust crates the app links on Windows (normal
 * dependencies reachable from `maskora`, read offline from Cargo.lock), and the
 * PDF.js resources copied into the app (fonts, character maps, ICC profiles,
 * wasm). Nothing is fetched.
 */
import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./webdriver.mjs";

/** Licenses accepted for a closed, personally used desktop build. */
const ACCEPTED = new Set([
  "MIT",
  "MIT-0",
  "Apache-2.0",
  "Apache-2.0 WITH LLVM-exception",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "0BSD",
  "Zlib",
  "CC0-1.0",
  "Unicode-3.0",
  "Unicode-DFS-2016",
  "BSL-1.0",
  "OFL-1.1",
  "Unlicense",
  "MPL-2.0",
  "CDLA-Permissive-2.0",
  "BlueOak-1.0.0",
  "Python-2.0",
  "CC-BY-4.0",
]);
/**
 * Decisions on packages whose license alone would fail, with the reason. A
 * package listed here is reported as reviewed, not hidden.
 */
const REVIEWED = {
  "@img/sharp-win32-x64":
    "Next.js's server-side image optimiser (LGPL-3.0 libvips). The static export sets images.unoptimized, so it is neither run nor shipped: it is only in the npm tree.",
  "@img/sharp-wasm32":
    "As @img/sharp-win32-x64: server-side image optimisation, not part of the static export.",
};

/** Copyleft that would bind the app's own code: never accepted without a decision. */
const REFUSED = /\b(A?GPL|LGPL|SSPL|EUPL|OSL)\b/i;

/** "MIT OR Apache-2.0" passes if any alternative is accepted; "A AND B" needs both. */
function verdict(expr) {
  if (!expr) return "unknown";
  const text = String(expr).replace(/[()]/g, " ").replace(/\//g, " OR ").trim();
  const alternatives = text.split(/\s+OR\s+/i).map((alt) => alt.split(/\s+AND\s+/i).map((s) => s.trim()));
  if (alternatives.some((all) => all.every((l) => ACCEPTED.has(l)))) return "accepted";
  if (REFUSED.test(text) && !alternatives.some((all) => all.every((l) => ACCEPTED.has(l)))) return "refused";
  return "review";
}

// npm production tree.
const npmTree = JSON.parse(
  // A fixed command line, no user input: run through the shell so npm's .cmd shim resolves on Windows.
  execSync("npm ls --omit=dev --all --json", { cwd: ROOT, encoding: "utf8", maxBuffer: 64 << 20 }),
);
const npm = new Map();
(function walk(deps) {
  for (const [name, info] of Object.entries(deps ?? {})) {
    const key = `${name}@${info.version}`;
    if (npm.has(key) || !info.version) continue;
    const pj = join(ROOT, "node_modules", name, "package.json");
    let license = existsSync(pj) ? (JSON.parse(readFileSync(pj, "utf8")).license ?? null) : null;
    if (typeof license === "object" && license) license = license.type;
    // No license field: read what the package's own LICENSE file says.
    if (!license) {
      const file = ["LICENSE", "LICENSE.md", "LICENSE.txt"]
        .map((f) => join(ROOT, "node_modules", name, f))
        .find(existsSync);
      const head = file ? readFileSync(file, "utf8").slice(0, 200) : "";
      license = /^\s*MIT License/i.test(head)
        ? "MIT"
        : /^\s*ISC License/i.test(head)
          ? "ISC"
          : /Apache License/i.test(head)
            ? "Apache-2.0"
            : null;
    }
    npm.set(key, { name, version: info.version, license });
    walk(info.dependencies);
  }
})(npmTree.dependencies);

// Rust crates reachable from maskora through normal dependencies.
const meta = JSON.parse(
  execFileSync(
    "cargo",
    [
      "metadata",
      "--format-version",
      "1",
      "--offline",
      "--manifest-path",
      join(ROOT, "src-tauri", "Cargo.toml"),
    ],
    { encoding: "utf8", maxBuffer: 256 << 20 },
  ),
);
const byId = new Map(meta.packages.map((p) => [p.id, p]));
const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
const rootId = meta.resolve.root;
const crates = new Map();
const stack = [rootId];
while (stack.length) {
  const id = stack.pop();
  if (crates.has(id)) continue;
  const p = byId.get(id);
  crates.set(id, {
    name: p.name,
    version: p.version,
    license: p.license ?? (p.license_file ? `file:${p.license_file}` : null),
  });
  for (const dep of nodes.get(id)?.deps ?? []) {
    const normal = dep.dep_kinds.some(
      (k) => k.kind === null && (!k.target || !/linux|macos|android|ios|unix|apple|wasm/i.test(k.target)),
    );
    if (normal) stack.push(dep.pkg);
  }
}
crates.delete(rootId);

// PDF.js resources copied into the app.
const pdfjs = join(ROOT, "node_modules", "pdfjs-dist");
const assets = [
  {
    name: "pdfjs-dist (worker, cmaps, iccs, wasm)",
    license: JSON.parse(readFileSync(join(pdfjs, "package.json"), "utf8")).license,
  },
  ...readdirSync(join(pdfjs, "standard_fonts"))
    .filter((f) => /^LICENSE/i.test(f))
    .map((f) => ({
      name: `pdfjs-dist/standard_fonts (${f})`,
      license: /FOXIT/i.test(f) ? "BSD-3-Clause" : /LIBERATION/i.test(f) ? "OFL-1.1" : null,
    })),
];

const rows = [
  ...[...npm.values()].map((r) => ({ kind: "npm", ...r })),
  ...[...crates.values()].map((r) => ({ kind: "crate", ...r })),
  ...assets.map((r) => ({ kind: "asset", version: "", ...r })),
].map((r) => {
  const v = verdict(r.license);
  return v !== "accepted" && REVIEWED[r.name]
    ? { ...r, verdict: "reviewed", note: REVIEWED[r.name] }
    : { ...r, verdict: v };
});

const counts = {};
for (const r of rows) counts[r.license ?? "none"] = (counts[r.license ?? "none"] ?? 0) + 1;
const reviewed = rows.filter((r) => r.verdict === "reviewed");
const flagged = rows.filter((r) => r.verdict !== "accepted" && r.verdict !== "reviewed");
const out = join(ROOT, "probe-out", "licenses");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "inventory.json"), JSON.stringify({ rows, counts }, null, 2));
writeFileSync(
  join(out, "inventory.md"),
  [
    "# Third-party license inventory",
    "",
    `${npm.size} npm packages, ${crates.size} Rust crates, ${assets.length} bundled PDF.js resource sets.`,
    "",
    "| License | Count |",
    "|---|---|",
    ...Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([l, n]) => `| ${l} | ${n} |`),
    "",
    "## Reviewed",
    "",
    ...(reviewed.length
      ? reviewed.map((r) => `- ${r.kind} ${r.name} ${r.version}: ${r.license}. ${r.note}`)
      : ["None."]),
    "",
    "## Needing a decision",
    "",
    ...(flagged.length
      ? flagged.map(
          (r) => `- ${r.kind} ${r.name} ${r.version}: ${r.license ?? "no license stated"} (${r.verdict})`,
        )
      : ["None."]),
    "",
  ].join("\n"),
);
console.log(
  `licenses: ${npm.size} npm packages, ${crates.size} crates, ${assets.length} asset sets; ${reviewed.length} reviewed, ${flagged.length} need a decision`,
);
for (const r of flagged)
  console.log(`  ${r.verdict.padEnd(8)} ${r.kind} ${r.name}@${r.version}: ${r.license}`);
console.log(`inventory: ${join(out, "inventory.md")}`);
if (flagged.length) process.exitCode = 1;
