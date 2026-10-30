#!/usr/bin/env node
/**
 * The repository must never cite an ADR by number.
 *
 * ADR numbering belongs to the Obsidian vault, and the vault may be
 * reorganised. A rename in a notes application must never break or invalidate
 * anything here. So code, comments and repo documentation state the decision
 * itself instead of pointing at a record only some readers can open:
 *
 *   Bad:   # committed migration files are the source of truth per ADR-NNNN
 *   Good:  # committed migration files are the source of truth for the schema
 *
 * Section references into the architecture document (§4.3, §7.2, §14.1) are
 * the exception and are encouraged — that document's numbering is stable by
 * design.
 *
 * On the project where this method was worked out, the rule was broken twice
 * by people who had read it, because nothing checked. Here something does from
 * the start.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * There are deliberately no exemptions. The documents that state this rule use
 * `ADR-NNNN` as their example, so they comply with it — a rule whose own
 * statement has to be excused from it is a rule with a hole in it.
 */

/** Generated artifacts that mirror repo content rather than being authored. */
const GENERATED = [/^graphify-out\//, /^\.claude\/skills\//, /^tests\/fixtures\/.*\.pdf$/];

const CITATION = /ADR[-\s]?\d{3,4}/i;

function trackedAndNewFiles() {
  // Tracked plus untracked-but-not-ignored, so a new file is covered before
  // anyone remembers to commit it.
  const out = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split("\n").filter(Boolean);
}

const TEXT = /\.(md|txt|ts|tsx|js|jsx|mjs|cjs|rs|ya?ml|toml|json|sh|css)$/i;

const violations = [];

for (const relative of trackedAndNewFiles()) {
  if (GENERATED.some((pattern) => pattern.test(relative))) continue;
  if (!TEXT.test(relative)) continue;

  const absolute = join(repoRoot, relative);
  let contents;
  try {
    if (statSync(absolute).size > 2_000_000) continue;
    contents = readFileSync(absolute, "utf8");
  } catch {
    continue; // deleted between listing and reading
  }

  if (!CITATION.test(contents)) continue;

  contents.split(/\r?\n/).forEach((line, index) => {
    if (CITATION.test(line)) {
      violations.push({ file: relative, line: index + 1, text: line.trim().slice(0, 100) });
    }
  });
}

if (violations.length > 0) {
  console.error(
    `The repository cites ADR numbers in ${violations.length} place(s).\n` +
      "ADR numbering belongs to the vault; a rename there must not invalidate\n" +
      "anything here. State the decision itself instead of citing the record.\n",
  );
  for (const { file, line, text } of violations) {
    console.error(`  ${file}:${line}`);
    console.error(`    ${text}`);
  }
  console.error("\nArchitecture section references (§7, §13.1) are fine — use those.");
  process.exit(1);
}

console.log("check-adr-references: no ADR numbers cited in the repository.");
