#!/usr/bin/env node
/**
 * Fail if anything secret-shaped is tracked in git.
 *
 * Maskora needs no runtime secrets (architecture §11.3), so any credential in
 * the repository is a mistake: a token pasted while setting up tooling, a key
 * from another project. This is the mechanical check; it runs in the root
 * check, the pre-commit hook and CI.
 *
 * Scans only files git tracks, so node_modules, .venv and build output are out
 * of scope by construction.
 *
 * Usage: node scripts/check-secrets.mjs
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath, not URL.pathname: on Windows the latter yields "/C:/..."
// which is not a valid cwd, and git then fails to spawn.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Literal credential formats. A match is a finding regardless of context. */
const TOKEN_PATTERNS = [
  { name: "Supabase secret key", re: /\bsb_secret_[A-Za-z0-9_-]{8,}/ },
  { name: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "private key block", re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{30,}/ },
];

/**
 * Assignments of a secret-shaped name to a real value.
 *
 * Only the *value* side matters: `/SECRET/i` appearing in a regex or a comment
 * is not a leak, so a bare mention must not trip this.
 */
const ASSIGNMENT =
  /^\s*(?:export\s+)?([A-Z0-9_]*(?:SECRET|SERVICE_ROLE|PASSWORD|PRIVATE_KEY|ACCESS_TOKEN)[A-Z0-9_]*)\s*=\s*(.+)$/;

/** Values that are obviously not credentials. */
function isPlaceholder(raw) {
  const value = raw
    .trim()
    .replace(/^["']|["'][;,]?$/g, "")
    .trim();
  if (value.length === 0) return true;
  if (value.length < 8) return true;
  // env(...) indirection, ${VAR} interpolation, and <angle> placeholders.
  if (/^env\(/.test(value)) return true;
  if (/^\$\{?[A-Z0-9_]+\}?$/.test(value)) return true;
  if (/^[<{[].*[>}\]]$/.test(value)) return true;
  if (/^(your|example|changeme|placeholder|dummy|xxx+|\.\.\.)/i.test(value)) return true;
  return false;
}

function trackedFiles() {
  const out = execFileSync("git", ["ls-files", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split("\0").filter(Boolean);
}

const findings = [];

// 1. No env file may be tracked except the template.
for (const file of trackedFiles()) {
  const base = path.basename(file);
  if (base.startsWith(".env") && base !== ".env.example") {
    findings.push({ file, line: 0, what: `tracked env file (${base})` });
  }
}

// 2. Scan contents.
const BINARY = /\.(png|jpg|jpeg|gif|webp|ico|pdf|woff2?|ttf|zip|gz|exe|dll|lock)$/i;

for (const file of trackedFiles()) {
  if (BINARY.test(file)) continue;
  // The scanner necessarily contains the patterns it looks for.
  if (file === "scripts/check-secrets.mjs") continue;

  const abs = path.join(repoRoot, file);
  let text;
  try {
    text = fs.readFileSync(abs, "utf8");
  } catch {
    continue;
  }
  if (text.includes("\0")) continue;

  text.split(/\r?\n/).forEach((line, index) => {
    for (const { name, re } of TOKEN_PATTERNS) {
      if (re.test(line)) findings.push({ file, line: index + 1, what: name });
    }
    const m = line.match(ASSIGNMENT);
    if (m && !isPlaceholder(m[2])) {
      findings.push({ file, line: index + 1, what: `${m[1]} assigned a value` });
    }
  });
}

if (findings.length > 0) {
  console.error("Secret scan FAILED:\n");
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  ${f.what}`);
  }
  console.error(
    "\nNothing secret may be committed. Move the value to .env.local (gitignored)\n" +
      "and leave only an empty placeholder in .env.example.",
  );
  process.exit(1);
}

console.log("Secret scan passed: no credentials found in tracked files.");
