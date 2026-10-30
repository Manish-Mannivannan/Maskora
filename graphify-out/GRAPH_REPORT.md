# Graph Report - Maskora  (2026-10-30)

## Corpus Check
- 46 files · ~15,080 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 395 nodes · 485 edges · 35 communities (28 shown, 7 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 4 edges (avg confidence: 0.81)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `6befc9c5`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- sync-plan-issues.mjs
- compilerOptions
- scripts
- tauri.conf.json
- devDependencies
- default.json
- generate.mjs
- AGENTS.md — Instructions for coding agents
- include
- Maskora
- CLAUDE.md
- maskora
- check-versions.mjs
- smoke.mjs
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
1. `scripts` - 19 edges
2. `compilerOptions` - 19 edges
3. `csp` - 12 edges
4. `AGENTS.md — Instructions for coding agents` - 11 edges
5. `select_source()` - 10 edges
6. `Maskora` - 10 edges
7. `SourceRegistry` - 9 edges
8. `devCsp` - 9 edges
9. `read_source()` - 8 edges
10. `Workspace()` - 8 edges

## Surprising Connections (you probably didn't know these)
- `Workspace()` --calls--> `clampPanelWidth()`  [EXTRACTED]
  src/features/workspace/Workspace.tsx → src/features/workspace/panel.ts
- `Workspace()` --calls--> `isSourceError()`  [EXTRACTED]
  src/features/workspace/Workspace.tsx → src/native/sources.ts
- `Workspace()` --calls--> `readSource()`  [EXTRACTED]
  src/features/workspace/Workspace.tsx → src/native/sources.ts
- `Workspace()` --calls--> `selectSource()`  [EXTRACTED]
  src/features/workspace/Workspace.tsx → src/native/sources.ts
- `Workspace()` --calls--> `openDocument()`  [EXTRACTED]
  src/features/workspace/Workspace.tsx → src/pdf/pdfjs.ts

## Import Cycles
- None detected.

## Communities (35 total, 7 thin omitted)

### Community 0 - "sync-plan-issues.mjs"
Cohesion: 0.09
Nodes (32): args, bodyFor(), dryIndex, existing, gh(), ghLines(), haveLabels, headingOf() (+24 more)

### Community 1 - "compilerOptions"
Cohesion: 0.09
Nodes (22): dom, dom.iterable, ES2023, compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules (+14 more)

### Community 2 - "scripts"
Cohesion: 0.08
Nodes (25): engines, node, name, private, scripts, build, check, check:conventions (+17 more)

### Community 3 - "tauri.conf.json"
Cohesion: 0.11
Nodes (18): icons/128x128@2x.png, icons/128x128.png, icons/32x32.png, icons/icon.icns, icons/icon.ico, build, beforeBuildCommand, beforeDevCommand (+10 more)

### Community 4 - "devDependencies"
Cohesion: 0.10
Nodes (21): eslint, eslint-config-next, devDependencies, eslint, eslint-config-next, prettier, @tauri-apps/cli, @types/node (+13 more)

### Community 5 - "default.json"
Cohesion: 0.22
Nodes (8): allow-read-source, allow-select-source, main, description, identifier, permissions, $schema, windows

### Community 6 - "generate.mjs"
Cohesion: 0.14
Nodes (13): buildAll(), FIXTURES, OUT, singlePage(), escapeString(), name(), num(), PdfBuilder (+5 more)

### Community 7 - "AGENTS.md — Instructions for coding agents"
Cohesion: 0.17
Nodes (11): AGENTS.md — Instructions for coding agents, Commits belong to the maintainer, Do not cite vault ADR numbers in the repository, Graphify, Keep architecture, plan, and code synchronized, Next.js version, Project invariants, Read canonical project documents first (+3 more)

### Community 8 - "include"
Cohesion: 0.17
Nodes (11): .next/dev/types/**/*.ts, next-env.d.ts, .next/types/**/*.ts, node_modules, out, src-tauri, src/**/*.ts, src/**/*.tsx (+3 more)

### Community 10 - "Maskora"
Cohesion: 0.10
Nodes (18): Build, Check, Codebase map, Fixtures, Maskora, Plan mirror, Prerequisites, Run (+10 more)

### Community 15 - "check-versions.mjs"
Cohesion: 0.18
Nodes (7): cargoLock, declared, npmRows, pkg, problems, root, versionsMd

### Community 16 - "smoke.mjs"
Cohesion: 0.15
Nodes (11): drag(), FIXTURE, run, sleep(), call(), locate(), openApp(), PORT (+3 more)

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
Cohesion: 0.09
Nodes (31): clampPanelWidth(), PANEL_DEFAULT, PANEL_KEY_STEP, PANEL_MAX, PANEL_MIN, DocumentState, Viewport, Window (+23 more)

### Community 30 - "sources.rs"
Cohesion: 0.16
Nodes (26): AppHandle, HashMap, Into, Mutex, Option, Path, PathBuf, Response (+18 more)

### Community 31 - "csp"
Cohesion: 0.08
Nodes (24): app, security, windows, base-uri, connect-src, default-src, font-src, form-action (+16 more)

### Community 32 - "copy-pdfjs.mjs"
Cohesion: 0.40
Nodes (4): dest, root, src, { version }

## Knowledge Gaps
- **195 isolated node(s):** `printWidth`, `endOfLine`, `nextConfig`, `name`, `private` (+190 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `devDependencies` connect `devDependencies` to `scripts`?**
  _High betweenness centrality (0.013) - this node is a cross-community bridge._
- **Why does `dependencies` connect `dependencies` to `scripts`?**
  _High betweenness centrality (0.011) - this node is a cross-community bridge._
- **What connects `printWidth`, `endOfLine`, `nextConfig` to the rest of the system?**
  _195 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `sync-plan-issues.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.09090909090909091 - nodes in this community are weakly interconnected._
- **Should `compilerOptions` be split into smaller, more focused modules?**
  _Cohesion score 0.09090909090909091 - nodes in this community are weakly interconnected._
- **Should `scripts` be split into smaller, more focused modules?**
  _Cohesion score 0.07692307692307693 - nodes in this community are weakly interconnected._
- **Should `tauri.conf.json` be split into smaller, more focused modules?**
  _Cohesion score 0.10526315789473684 - nodes in this community are weakly interconnected._