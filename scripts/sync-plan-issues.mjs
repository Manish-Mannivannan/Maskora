#!/usr/bin/env node
/**
 * Mirror the implementation plan into GitHub milestones and issues.
 *
 * Template copy: `Obsidian/Projects/Coding project template/sync-plan-issues.mjs`.
 * Copy it unchanged to the repository's `scripts/` folder and add
 * `"plan:issues": "node scripts/sync-plan-issues.mjs"` to package.json
 * (General Rules and Methods §19).
 *
 *   npm run plan:issues -- --dry-run <dir>    # write every body to <dir>, publish nothing
 *   npm run plan:issues                       # create or update milestones and issues
 *
 * The plan in the maintainer's Obsidian vault is canonical; this is a one-way,
 * regenerated copy for navigating the work on GitHub. Each phase becomes a
 * milestone carrying its outcome, introduction and exit criteria; each step an
 * issue carrying the step in full — items, decisions, write-up and evidence —
 * closed as completed once the step is marked ✅. A phase not yet split into
 * numbered steps is one outline issue. Editing an issue changes nothing in the
 * plan, and the next run overwrites it.
 *
 * The plan shape it reads (the Implementation Plan Template's):
 *   # Phase N — Title                 a phase; `## Phase N — Title` inside `# Future phases` too
 *   ## N.M — Name · TAG + TAG ✅       a step; ✅ last, only when closed; `NA.M` for lettered phases
 *   ### Exit criteria — Phase N       the phase's exit criteria, after its last step
 *   # Continuous tracks               one issue, no milestone
 * A phase whose sub-headings are not numbered is still an outline. Each known
 * tag (see LABELS) becomes a label ("DB + BE (Rust)" gives DB, BE and Rust);
 * a `DEC:` prefix on the step name gives DEC.
 *
 * Re-runnable: every issue carries a hidden marker naming its step, so a run
 * finds what it made before and updates it rather than duplicating. Links in
 * the plan become links between the issues: a step points at its issue, a
 * phase at its milestone; links to any other note become its plain name.
 *
 * Configuration needs no edits when the method's naming holds: the project is
 * the repository folder's name, the vault folder has the same name, and the
 * repository is the one `gh` sees here. Override with PLAN_PROJECT, PLAN_VAULT
 * and PLAN_REPO. Writes go through the GitHub CLI, which must be signed in
 * (`gh auth login`).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const PROJECT = process.env.PLAN_PROJECT ?? basename(process.cwd());
const VAULT = process.env.PLAN_VAULT ?? `C:/Users/manis/Documents/Obsidian/Projects/${PROJECT}`;
const PLAN_NAME = `${PROJECT} Implementation Plan`;
const PLAN = join(VAULT, `${PLAN_NAME}.md`);
const BODY_LIMIT = 65000;

// The template's step tags, and the labels they become. A tag not listed here
// gives no label: add it here, in the repository's copy, when a project
// introduces one. Existing labels are never recoloured, so a project may
// restyle them on GitHub.
const LABELS = {
  "plan-step": ["0e8a16", "A step of the implementation plan"],
  "phase-outline": ["c5def5", "A phase not yet split into steps"],
  track: ["bfdadc", "A continuous track of the plan"],
  DEC: ["5319e7", "A decision other steps depend on"],
  DB: ["1d76db", "Database and migrations"],
  BE: ["0052cc", "Backend"],
  FE: ["fbca04", "Frontend"],
  INFRA: ["d4c5f9", "Tooling and deployment"],
  SEC: ["b60205", "Security"],
  QA: ["c2e0c6", "Verification"],
  UX: ["f9d0c4", "User experience"],
  Rust: ["dea584", "Rust"],
  Python: ["3572a5", "Python"],
};
const STEP_TAGS = Object.keys(LABELS).filter((name) => !["plan-step", "phase-outline", "track"].includes(name));

const args = process.argv.slice(2);
const dryIndex = args.indexOf("--dry-run");
const DRY = dryIndex >= 0 ? (args[dryIndex + 1] ?? "plan-issues-dry-run") : null;

// ---------------------------------------------------------------------------
// GitHub, through the CLI
// ---------------------------------------------------------------------------

function gh(argv, input) {
  return execFileSync("gh", argv, {
    encoding: "utf8",
    input: input === undefined ? undefined : JSON.stringify(input),
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** The repository `gh` resolves from this folder's remote, unless PLAN_REPO says otherwise. */
function resolveRepo() {
  if (process.env.PLAN_REPO) return process.env.PLAN_REPO;
  try {
    return gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]).trim();
  } catch (error) {
    if (DRY) return "OWNER/REPO";
    throw new Error(`cannot resolve the GitHub repository; set PLAN_REPO (${error.message})`);
  }
}

const REPO = resolveRepo();
const ISSUE_URL = (n) => `https://github.com/${REPO}/issues/${n}`;
const MILESTONE_URL = (n) => `https://github.com/${REPO}/milestone/${n}`;

/** One page at a time, as JSON lines, so a long list never needs one huge buffer. */
function ghLines(path, jq) {
  const out = gh(["api", "--paginate", path, "--jq", jq]);
  return out
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Every write is spaced out: GitHub limits how fast content may be created. */
function write(method, path, payload) {
  if (DRY) throw new Error("a dry run writes nothing");
  const out = gh(["api", "-X", method, path, "--input", "-"], payload);
  sleep(1100);
  return out ? JSON.parse(out) : null;
}

// ---------------------------------------------------------------------------
// Reading the plan
// ---------------------------------------------------------------------------

const raw = readFileSync(PLAN, "utf8").replace(/\r\n/g, "\n");
const lines = raw.split("\n");

const STEP = /^(\d+[A-Z]?\.\d+[a-z]?) — (.+)$/;

/** The heading level and text of a line, or null. */
function headingOf(line) {
  const match = line.match(/^(#{1,6}) (.+)$/);
  return match ? { level: match[1].length, text: match[2].trim() } : null;
}

/** Where the section that starts at `from` ends: the next heading at its level or above. */
function sectionEnd(from, level, limit = lines.length) {
  for (let j = from + 1; j < limit; j += 1) {
    const h = headingOf(lines[j]);
    if (h && h.level <= level) return j;
  }
  return limit;
}

/** Split "2A.8 — Routing … · DB + BE (Rust) ✅" into its parts. */
function parseStepHeading(text) {
  const done = text.includes("✅");
  const clean = text.replace(/\s*✅\s*/g, " ").trim();
  const match = clean.match(STEP);
  if (!match) return null;
  const [, id, rest] = match;
  const dot = rest.lastIndexOf(" · ");
  const name = dot >= 0 ? rest.slice(0, dot).trim() : rest.trim();
  const tags = dot >= 0 ? rest.slice(dot + 3).trim() : "";
  return { id, name, tags, done, heading: text };
}

function labelsFor(step) {
  const labels = new Set(["plan-step"]);
  if (/^DEC\b/.test(step.name)) labels.add("DEC");
  for (const tag of STEP_TAGS) {
    if (new RegExp(`\\b${tag}\\b`).test(step.tags)) labels.add(tag);
  }
  return [...labels];
}

/** The text of a section, without its heading line or the rule that closes a phase. */
function slice(from, to) {
  return lines
    .slice(from + 1, to)
    .join("\n")
    .trim()
    .replace(/\n+---$/, "")
    .trim();
}

/** Exit criteria: a "### … Exit criteria" block, up to the next heading or rule. */
function takeExitCriteria(text) {
  const start = text.search(/^### (?:✅ )?Exit criteria/m);
  if (start < 0) return { rest: text, exit: null };
  const after = text.slice(start);
  const lineEnd = after.indexOf("\n");
  const tail = lineEnd < 0 ? "" : after.slice(lineEnd + 1);
  const stop = tail.search(/^(?:#{1,3} |---\s*$)/m);
  const block = stop < 0 ? tail : tail.slice(0, stop);
  return {
    rest: (text.slice(0, start) + (stop < 0 ? "" : tail.slice(stop))).trim(),
    exit: block.trim(),
  };
}

/** A phase section: numbered child headings are steps; otherwise the whole section is an outline. */
function readPhase(start, level) {
  const end = sectionEnd(start, level);
  const title = headingOf(lines[start]).text;
  const children = [];
  for (let j = start + 1; j < end; j += 1) {
    const h = headingOf(lines[j]);
    if (h && h.level === level + 1) children.push({ at: j, step: parseStepHeading(h.text) });
  }
  const numbered = children.filter((c) => c.step);
  if (numbered.length > 0 && numbered.length < children.length) {
    const odd = children.find((c) => !c.step);
    throw new Error(`a split phase with a section that is not a step: ${lines[odd.at]}`);
  }

  const phase = { title, intro: "", steps: [], exit: null };
  if (numbered.length === 0) {
    const taken = takeExitCriteria(slice(start, end));
    phase.exit = taken.exit;
    phase.outline = taken.rest;
    // A leading prose paragraph (an "Outcome" line) also introduces the milestone.
    const first = taken.rest.split(/\n\s*\n/)[0];
    if (first && !/^(?:- |#)/.test(first)) phase.intro = first;
  } else {
    const taken = takeExitCriteria(slice(start, numbered[0].at));
    if (taken.exit) phase.exit = taken.exit;
    phase.intro = taken.rest;
    numbered.forEach((child, n) => {
      const stepEnd = numbered[n + 1]?.at ?? end;
      const body = takeExitCriteria(slice(child.at, stepEnd));
      if (body.exit) phase.exit = body.exit;
      phase.steps.push({ ...child.step, body: body.rest, phase: title });
    });
  }
  phase.done = phase.steps.length > 0 && phase.steps.every((s) => s.done);
  return phase;
}

const phases = [];
let tracks = null;
for (let i = 0; i < lines.length; i += 1) {
  const h = headingOf(lines[i]);
  if (!h || h.level !== 1) continue;
  if (h.text.startsWith("Phase ")) {
    phases.push(readPhase(i, 1));
  } else if (h.text === "Future phases") {
    const end = sectionEnd(i, 1);
    for (let j = i + 1; j < end; j += 1) {
      const sub = headingOf(lines[j]);
      if (sub && sub.level === 2 && sub.text.startsWith("Phase ")) phases.push(readPhase(j, 2));
    }
  } else if (h.text === "Continuous tracks") {
    tracks = { title: h.text, body: slice(i, sectionEnd(i, 1)) };
  }
}
if (phases.length === 0) throw new Error(`no phases found in ${PLAN}`);

// ---------------------------------------------------------------------------
// The issues to exist, keyed by a stable marker
// ---------------------------------------------------------------------------

const wanted = [];
for (const phase of phases) {
  if (phase.steps.length > 0) {
    for (const step of phase.steps) {
      wanted.push({
        key: step.id,
        title: `${step.id} — ${step.name}`,
        labels: labelsFor(step),
        milestone: phase.title,
        closed: step.done,
        heading: step.heading,
        text: step.body,
        where: `${phase.title}, step ${step.id}`,
      });
    }
  } else {
    wanted.push({
      key: `outline:${phase.title}`,
      title: `${phase.title} — outline`,
      labels: ["phase-outline"],
      milestone: phase.title,
      closed: false,
      heading: phase.title,
      text: phase.outline,
      where: `${phase.title} (not yet split into steps)`,
    });
  }
}
if (tracks) {
  wanted.push({
    key: "tracks",
    title: "Continuous tracks",
    labels: ["track"],
    milestone: null,
    closed: false,
    heading: tracks.title,
    text: tracks.body,
    where: "Continuous tracks",
  });
}

// ---------------------------------------------------------------------------
// Obsidian links, rewritten for GitHub
// ---------------------------------------------------------------------------

const stepByHeading = new Map();
for (const phase of phases) for (const step of phase.steps) stepByHeading.set(step.heading, step.id);
const phaseByHeading = new Map(phases.map((p) => [p.title, p.title]));

/** Links to steps and phases resolve to issues and milestones; any other note becomes its plain name. */
function rewrite(text, issueNumbers, milestoneNumbers) {
  return text.replace(/!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, label) => {
    const [page, heading] = target.includes("#") ? target.split(/#(.*)/s) : [target, null];
    const shown = (label ?? heading ?? page.split("/").pop()).trim();
    const samePlan = page === "" || page === PLAN_NAME;
    if (samePlan && heading) {
      const stepId = stepByHeading.get(heading.trim());
      if (stepId && issueNumbers.has(stepId)) return `[${shown}](${ISSUE_URL(issueNumbers.get(stepId))})`;
      const phase = phaseByHeading.get(heading.trim());
      if (phase && milestoneNumbers.has(phase)) return `[${shown}](${MILESTONE_URL(milestoneNumbers.get(phase))})`;
    }
    return shown;
  });
}

function bodyFor(item, issueNumbers, milestoneNumbers) {
  const header =
    `> Mirrored from the implementation plan — ${item.where}. The plan in the vault is canonical: ` +
    "this issue is regenerated from it, and an edit made here is overwritten on the next sync.";
  let text = rewrite(item.text || "_No items yet._", issueNumbers, milestoneNumbers);
  let body = `${header}\n\n${text}\n\n<!-- plan-sync: ${item.key} -->`;
  if (body.length > BODY_LIMIT) {
    text = text.slice(0, BODY_LIMIT - 1000);
    body = `${header}\n\n${text}\n\n_…truncated here; the rest is in the plan._\n\n<!-- plan-sync: ${item.key} -->`;
  }
  return body;
}

function milestoneDescription(phase, issueNumbers, milestoneNumbers) {
  const parts = [];
  if (phase.intro) parts.push(rewrite(phase.intro, issueNumbers, milestoneNumbers));
  if (phase.exit) parts.push(`**Exit criteria**\n\n${rewrite(phase.exit, issueNumbers, milestoneNumbers)}`);
  let text = parts.join("\n\n") || "Mirrored from the implementation plan.";
  if (text.length > 7500) text = `${text.slice(0, 7400)}\n\n…continued in the plan.`;
  return text;
}

// ---------------------------------------------------------------------------
// Labels, milestones, issues
// ---------------------------------------------------------------------------

if (DRY) {
  mkdirSync(DRY, { recursive: true });
  const placeholder = new Map(wanted.map((item, n) => [item.key, 1000 + n]));
  const milestones = new Map(phases.map((p, n) => [p.title, 100 + n]));
  wanted.forEach((item, n) => {
    const name = `${String(n + 1).padStart(3, "0")} ${item.key.replace(/[^A-Za-z0-9.]+/g, "_")}.md`;
    writeFileSync(
      join(DRY, name),
      `# ${item.title}\n\nlabels: ${item.labels.join(", ")} · milestone: ${item.milestone ?? "none"} · ` +
        `state: ${item.closed ? "closed" : "open"}\n\n---\n\n${bodyFor(item, placeholder, milestones)}\n`,
    );
  });
  phases.forEach((phase, n) => {
    writeFileSync(
      join(DRY, `milestone ${String(n + 1).padStart(2, "0")} ${phase.title.replace(/[^A-Za-z0-9.]+/g, "_")}.md`),
      `# ${phase.title} (${phase.done ? "closed" : "open"})\n\n${milestoneDescription(phase, placeholder, milestones)}\n`,
    );
  });
  const closed = wanted.filter((w) => w.closed).length;
  console.log(
    `dry run of ${PLAN} for ${REPO}: ${phases.length} milestones (${phases.filter((p) => p.done).length} closed), ` +
      `${wanted.length} issues (${closed} closed, ${wanted.length - closed} open) written to ${DRY}`,
  );
  process.exit(0);
}

// Labels: create what is missing.
// Each jq result is an array: the CLI prints a bare string unquoted, which is not JSON.
const haveLabels = new Set(ghLines(`repos/${REPO}/labels?per_page=100`, ".[] | [.name]").map(([name]) => name));
const usedLabels = new Set(wanted.flatMap((item) => item.labels));
for (const name of usedLabels) {
  if (haveLabels.has(name)) continue;
  const [color, description] = LABELS[name];
  write("POST", `repos/${REPO}/labels`, { name, color, description });
}

// Milestones: find by title, create what is missing.
const milestoneNumbers = new Map(
  ghLines(`repos/${REPO}/milestones?state=all&per_page=100`, ".[] | [.title, .number]").map(([t, n]) => [t, n]),
);
for (const phase of phases) {
  if (!milestoneNumbers.has(phase.title)) {
    const made = write("POST", `repos/${REPO}/milestones`, { title: phase.title });
    milestoneNumbers.set(phase.title, made.number);
  }
}

// Issues: find by marker, create what is missing with a placeholder body.
const existing = new Map();
for (const issue of ghLines(
  `repos/${REPO}/issues?state=all&per_page=100`,
  ".[] | select(.pull_request == null) | [.number, (.body // \"\")]",
)) {
  const [number, body] = issue;
  const marker = body.match(/<!-- plan-sync: (.+?) -->/);
  if (marker) existing.set(marker[1], number);
}
for (const item of wanted) {
  if (!existing.has(item.key)) {
    const made = write("POST", `repos/${REPO}/issues`, {
      title: item.title,
      body: `<!-- plan-sync: ${item.key} -->`,
    });
    existing.set(item.key, made.number);
    console.log(`created #${made.number} ${item.title}`);
  }
}

// Every issue: final body, links resolved, labels, milestone and state.
for (const item of wanted) {
  const number = existing.get(item.key);
  write("PATCH", `repos/${REPO}/issues/${number}`, {
    title: item.title,
    body: bodyFor(item, existing, milestoneNumbers),
    labels: item.labels,
    milestone: item.milestone ? milestoneNumbers.get(item.milestone) : null,
    state: item.closed ? "closed" : "open",
    ...(item.closed ? { state_reason: "completed" } : {}),
  });
  console.log(`synced #${number} ${item.title} (${item.closed ? "closed" : "open"})`);
}

// Milestones: description from the phase, closed once every step is.
for (const phase of phases) {
  write("PATCH", `repos/${REPO}/milestones/${milestoneNumbers.get(phase.title)}`, {
    description: milestoneDescription(phase, existing, milestoneNumbers),
    state: phase.done ? "closed" : "open",
  });
}

// Milestone counters. GitHub does not reliably recount a milestone after its
// issues change through the API in bulk: every milestone can read 0 of 0 while
// a search finds all its issues. Moving one issue out of the milestone and
// back makes it recount the whole milestone, so do that wherever the counters
// disagree with the plan.
for (const phase of phases) {
  const number = milestoneNumbers.get(phase.title);
  const items = wanted.filter((item) => item.milestone === phase.title);
  const expectOpen = items.filter((item) => !item.closed).length;
  const expectClosed = items.length - expectOpen;
  const [open, closed] = JSON.parse(
    gh(["api", `repos/${REPO}/milestones/${number}`, "--jq", "[.open_issues, .closed_issues]"]),
  );
  if (open === expectOpen && closed === expectClosed) continue;
  const nudge = existing.get(items[0].key);
  write("PATCH", `repos/${REPO}/issues/${nudge}`, { milestone: null });
  write("PATCH", `repos/${REPO}/issues/${nudge}`, { milestone: number });
  const [after, afterClosed] = JSON.parse(
    gh(["api", `repos/${REPO}/milestones/${number}`, "--jq", "[.open_issues, .closed_issues]"]),
  );
  console.log(`recounted ${phase.title}: ${open}/${closed} -> ${after}/${afterClosed} (plan: ${expectOpen}/${expectClosed})`);
}

console.log(`sync-plan-issues: ${wanted.length} issues and ${phases.length} milestones in step with the plan.`);
