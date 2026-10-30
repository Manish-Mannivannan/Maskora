# Graph Report - Maskora  (2026-10-30)

## Corpus Check
- 72 files · ~27,712 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 514 nodes · 780 edges · 35 communities (28 shown, 7 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 32 edges (avg confidence: 0.84)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `cebde61f`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- sync-plan-issues.mjs
- compilerOptions
- scripts
- geometry.rs
- devDependencies
- default.json
- corpus.mjs
- AGENTS.md — Instructions for coding agents
- encrypt.mjs
- Maskora
- CLAUDE.md
- maskora
- check-versions.mjs
- probe-pdf.mjs
- dependencies
- prefix-graphify-vault.mjs
- check-secrets.mjs
- check-adr-references.mjs
- .prettierrc.json
- layout.tsx
- pre-commit
- pre-push
- next.config.ts
- Workspace.tsx
- sources.rs
- csp
- copy-pdfjs.mjs

## God Nodes (most connected - your core abstractions)
1. `makeDoc()` - 27 edges
2. `scripts` - 20 edges
3. `compilerOptions` - 19 edges
4. `inspect()` - 13 edges
5. `page_geometry()` - 12 edges
6. `csp` - 12 edges
7. `resolve()` - 11 edges
8. `inspect_geometry()` - 11 edges
9. `check()` - 11 edges
10. `fill()` - 11 edges

## Surprising Connections (you probably didn't know these)
- `inspect_geometry()` --references--> `SourceRegistry`  [EXTRACTED]
  src-tauri/src/geometry.rs → src-tauri/src/sources.rs
- `withDocument()` --calls--> `openDocument()`  [EXTRACTED]
  src/pdf/probe.ts → src/pdf/pdfjs.ts
- `makeDoc()` --calls--> `standardSecurity()`  [EXTRACTED]
  tests/fixtures/corpus.mjs → tests/fixtures/encrypt.mjs
- `Workspace()` --calls--> `clampPanelWidth()`  [EXTRACTED]
  src/features/workspace/Workspace.tsx → src/features/workspace/panel.ts
- `Workspace()` --calls--> `isSourceError()`  [EXTRACTED]
  src/features/workspace/Workspace.tsx → src/native/sources.ts

## Import Cycles
- None detected.

## Communities (35 total, 7 thin omitted)

### Community 0 - "sync-plan-issues.mjs"
Cohesion: 0.09
Nodes (32): args, bodyFor(), dryIndex, existing, gh(), ghLines(), haveLabels, headingOf() (+24 more)

### Community 1 - "compilerOptions"
Cohesion: 0.06
Nodes (33): dom, dom.iterable, ES2023, .next/dev/types/**/*.ts, next-env.d.ts, .next/types/**/*.ts, node_modules, out (+25 more)

### Community 2 - "scripts"
Cohesion: 0.07
Nodes (26): engines, node, name, private, scripts, build, check, check:conventions (+18 more)

### Community 3 - "geometry.rs"
Cohesion: 0.12
Nodes (42): Dictionary, Document, Object, ObjectId, BoxFact, check(), close(), coverage_fixtures_report_their_explicit_boxes() (+34 more)

### Community 4 - "devDependencies"
Cohesion: 0.10
Nodes (21): eslint, eslint-config-next, devDependencies, eslint, eslint-config-next, prettier, @tauri-apps/cli, @types/node (+13 more)

### Community 5 - "default.json"
Cohesion: 0.20
Nodes (9): allow-inspect-geometry, allow-read-source, allow-select-source, main, description, identifier, permissions, $schema (+1 more)

### Community 6 - "corpus.mjs"
Cohesion: 0.09
Nodes (47): A1(), baseline(), box(), CORPUS, coverageLayout(), defaulted(), E1a(), E1b() (+39 more)

### Community 7 - "AGENTS.md — Instructions for coding agents"
Cohesion: 0.17
Nodes (11): AGENTS.md — Instructions for coding agents, Commits belong to the maintainer, Do not cite vault ADR numbers in the repository, Graphify, Keep architecture, plan, and code synchronized, Next.js version, Project invariants, Read canonical project documents first (+3 more)

### Community 8 - "encrypt.mjs"
Cohesion: 0.56
Nodes (8): fileKey(), md5(), ownerEntry(), PAD, padded(), rc4(), standardSecurity(), userEntry()

### Community 10 - "Maskora"
Cohesion: 0.10
Nodes (18): Build, Check, Codebase map, Fixtures, Maskora, Plan mirror, Prerequisites, Run (+10 more)

### Community 15 - "check-versions.mjs"
Cohesion: 0.18
Nodes (7): cargoLock, declared, npmRows, pkg, problems, root, versionsMd

### Community 16 - "probe-pdf.mjs"
Cohesion: 0.08
Nodes (17): FIXTURES, known(), OUT, report, run, same(), drag(), FIXTURE (+9 more)

### Community 17 - "dependencies"
Cohesion: 0.12
Nodes (17): next, dependencies, next, pdfjs-dist, react, react-dom, @react-three/drei, @react-three/fiber (+9 more)

### Community 18 - "prefix-graphify-vault.mjs"
Cohesion: 0.25
Nodes (5): canvasPath, DEFAULT_DIR, dir, generated, unprefixed

### Community 19 - "check-secrets.mjs"
Cohesion: 0.33
Nodes (3): findings, repoRoot, TOKEN_PATTERNS

### Community 20 - "check-adr-references.mjs"
Cohesion: 0.40
Nodes (3): GENERATED, repoRoot, violations

### Community 27 - "Workspace.tsx"
Cohesion: 0.06
Nodes (38): clampPanelWidth(), PANEL_DEFAULT, PANEL_KEY_STEP, PANEL_MAX, PANEL_MIN, DocumentState, Viewport, Window (+30 more)

### Community 30 - "sources.rs"
Cohesion: 0.16
Nodes (26): AppHandle, HashMap, Mutex, Path, PathBuf, Response, Self, a_deleted_source_reports_missing_not_unauthorized() (+18 more)

### Community 31 - "csp"
Cohesion: 0.05
Nodes (42): icons/128x128@2x.png, icons/128x128.png, icons/32x32.png, icons/icon.icns, icons/icon.ico, app, security, windows (+34 more)

### Community 32 - "copy-pdfjs.mjs"
Cohesion: 0.40
Nodes (4): dest, root, src, { version }

## Knowledge Gaps
- **210 isolated node(s):** `printWidth`, `endOfLine`, `nextConfig`, `name`, `private` (+205 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `devDependencies` connect `devDependencies` to `scripts`?**
  _High betweenness centrality (0.008) - this node is a cross-community bridge._
- **Why does `SourceRegistry` connect `sources.rs` to `geometry.rs`?**
  _High betweenness centrality (0.008) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `makeDoc()` (e.g. with `.add()` and `.build()`) actually correct?**
  _`makeDoc()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `printWidth`, `endOfLine`, `nextConfig` to the rest of the system?**
  _210 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `sync-plan-issues.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.09090909090909091 - nodes in this community are weakly interconnected._
- **Should `compilerOptions` be split into smaller, more focused modules?**
  _Cohesion score 0.058823529411764705 - nodes in this community are weakly interconnected._
- **Should `scripts` be split into smaller, more focused modules?**
  _Cohesion score 0.07407407407407407 - nodes in this community are weakly interconnected._