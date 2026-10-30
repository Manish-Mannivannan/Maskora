#!/usr/bin/env node
/**
 * Prefix graphify's Obsidian export so its notes can never shadow authored ones.
 *
 * The problem
 * -----------
 * Obsidian resolves `[[Links]]` by basename across the entire vault, ignoring
 * folders. graphify names each exported note after a graph node, and node names
 * come from text in the repository — so `AGENTS.md` mentioning a document by
 * title produces a generated note with that exact basename, which then competes
 * with the authored note of the same name.
 *
 * graphify has no prefix option (its Obsidian export accepts only `--dir`), so
 * this runs afterwards.
 *
 * What it does
 * ------------
 * Renames every generated note to `<PREFIX><name>.md` and rewrites the
 * wikilinks between them so they still resolve. Links keep their original
 * display text via an alias, so `[[Foo]]` becomes `[[Graphify - Foo|Foo]]` and
 * still reads as "Foo" in Obsidian.
 *
 * Idempotent: it deletes any previously prefixed files first, then prefixes
 * whatever graphify just wrote. Safe to run after every export.
 *
 * Template copy: `Obsidian/Projects/Coding project template/prefix-graphify-vault.mjs`.
 * Copy it unchanged to the repository's `scripts/` folder and add
 * `"graphify:vault": "node scripts/prefix-graphify-vault.mjs"` to package.json
 * (General Rules and Methods §11.4). Run it after every Obsidian export:
 *
 *   graphify export obsidian --dir "<vault>/Projects/<Project>/Graphify"
 *   npm run graphify:vault
 *
 * The export folder defaults to the vault folder named like this repository
 * (PLAN_PROJECT and PLAN_VAULT override it, as for sync-plan-issues.mjs).
 *
 * Usage:  node scripts/prefix-graphify-vault.mjs [exportDir]
 */

import fs from "node:fs";
import path from "node:path";

const PREFIX = "Graphify - ";

const PROJECT = process.env.PLAN_PROJECT ?? path.basename(process.cwd());
const VAULT = process.env.PLAN_VAULT ?? `C:/Users/manis/Documents/Obsidian/Projects/${PROJECT}`;
const DEFAULT_DIR = path.join(VAULT, "Graphify");

const dir = path.resolve(process.argv[2] ?? DEFAULT_DIR);

if (!fs.existsSync(dir)) {
  console.error(`[prefix-graphify] export directory not found: ${dir}`);
  process.exit(1);
}

const allMd = () => fs.readdirSync(dir).filter((f) => f.endsWith(".md"));

// 1. Decide whether there is anything to do.
//
// Only unprefixed files represent a fresh graphify export. If there are none,
// the directory is already prefixed and this run must do nothing — deleting the
// prefixed files here would destroy the export, since step 2 would then have
// nothing to regenerate them from.
const unprefixed = allMd().filter((f) => !f.startsWith(PREFIX));

if (unprefixed.length === 0) {
  console.log(
    `[prefix-graphify] already prefixed (${allMd().length} note(s)); nothing to do.`,
  );
  process.exit(0);
}

// A fresh export exists, so previously prefixed copies are stale duplicates.
let removed = 0;
for (const file of allMd()) {
  if (file.startsWith(PREFIX)) {
    fs.unlinkSync(path.join(dir, file));
    removed += 1;
  }
}

const files = unprefixed;

// 2. Every basename graphify just produced. Only links pointing at these get
//    rewritten — anything else is left untouched.
const generated = new Set(files.map((f) => f.slice(0, -3)));

/** `[[target]]`, `[[target#heading]]`, `[[target|alias]]`, `[[target#heading|alias]]` */
const WIKILINK = /\[\[([^\]|#]+)(#[^\]|]+)?(?:\|([^\]]+))?\]\]/g;

/**
 * Obsidian rewrites links to absolute vault paths when it detects an ambiguous
 * or renamed target. If it has done that, reduce the target back to a bare
 * basename before deciding whether it points at a generated note.
 */
function basename(target) {
  const slash = target.lastIndexOf("/");
  return slash === -1 ? target : target.slice(slash + 1);
}

let rewritten = 0;

for (const file of files) {
  const source = path.join(dir, file);
  const body = fs.readFileSync(source, "utf8");

  const updated = body.replace(WIKILINK, (whole, target, heading, alias) => {
    let name = basename(target.trim());
    // Already-prefixed targets can appear if Obsidian touched the file between
    // the export and this run. Normalise so the result is the same either way.
    if (name.startsWith(PREFIX)) name = name.slice(PREFIX.length);
    if (!generated.has(name)) return whole;
    rewritten += 1;
    // Keep the visible text as it was, so the notes still read naturally.
    return `[[${PREFIX}${name}${heading ?? ""}|${alias ?? name}]]`;
  });

  fs.writeFileSync(source, updated, "utf8");
  fs.renameSync(source, path.join(dir, `${PREFIX}${file}`));
}

// 3. The canvas. graphify's `graph.canvas` names each card's note by bare
//    basename, as if the export folder were its own vault. Point each card at
//    its prefixed note by its path from the real vault's root, the nearest
//    ancestor holding `.obsidian/`, so the canvas opens notes from the main
//    vault. The export writes its own `.obsidian/` inside the folder, so the
//    search starts at the folder's parent.
let cards = 0;
const canvasPath = path.join(dir, "graph.canvas");
if (fs.existsSync(canvasPath)) {
  let root = path.dirname(dir);
  while (!fs.existsSync(path.join(root, ".obsidian")) && path.dirname(root) !== root) root = path.dirname(root);
  if (!fs.existsSync(path.join(root, ".obsidian"))) root = dir;
  const canvas = JSON.parse(fs.readFileSync(canvasPath, "utf8"));
  for (const node of canvas.nodes ?? []) {
    if (typeof node.file !== "string") continue;
    let name = basename(node.file.replace(/\\/g, "/"));
    if (name.startsWith(PREFIX)) name = name.slice(PREFIX.length);
    if (!generated.has(name.replace(/\.md$/, ""))) continue;
    node.file = path.relative(root, path.join(dir, `${PREFIX}${name}`)).split(path.sep).join("/");
    cards += 1;
  }
  fs.writeFileSync(canvasPath, `${JSON.stringify(canvas, null, 2)}\n`, "utf8");
}

console.log(
  `[prefix-graphify] prefixed ${files.length} note(s), rewrote ${rewritten} link(s) and ${cards} canvas card(s)` +
    (removed > 0 ? `, cleared ${removed} from a previous run` : ""),
);
