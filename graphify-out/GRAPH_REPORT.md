# Graph Report - Maskora  (2026-10-30)

## Corpus Check
- 35 files · ~10,611 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 290 nodes · 303 edges · 30 communities (22 shown, 8 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 3 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `54922b13`
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
- lib.rs
- Maskora
- CLAUDE.md
- maskora
- check-versions.mjs
- webdriver.mjs
- dependencies
- prefix-graphify-vault.mjs
- check-secrets.mjs
- check-adr-references.mjs
- .prettierrc.json
- layout.tsx
- pre-commit
- pre-push
- next.config.ts

## God Nodes (most connected - your core abstractions)
1. `compilerOptions` - 19 edges
2. `scripts` - 17 edges
3. `AGENTS.md — Instructions for coding agents` - 11 edges
4. `Maskora` - 10 edges
5. `singlePage()` - 7 edges
6. `PdfBuilder` - 7 edges
7. `include` - 7 edges
8. `slice()` - 6 edges
9. `readPhase()` - 6 edges
10. `icon` - 6 edges

## Surprising Connections (you probably didn't know these)
- `singlePage()` --calls--> `name()`  [EXTRACTED]
  tests/fixtures/generate.mjs → tests/fixtures/pdf-writer.mjs
- `singlePage()` --calls--> `ref()`  [EXTRACTED]
  tests/fixtures/generate.mjs → tests/fixtures/pdf-writer.mjs
- `singlePage()` --calls--> `stream()`  [EXTRACTED]
  tests/fixtures/generate.mjs → tests/fixtures/pdf-writer.mjs

## Import Cycles
- None detected.

## Communities (30 total, 8 thin omitted)

### Community 0 - "sync-plan-issues.mjs"
Cohesion: 0.09
Nodes (32): args, bodyFor(), dryIndex, existing, gh(), ghLines(), haveLabels, headingOf() (+24 more)

### Community 1 - "compilerOptions"
Cohesion: 0.09
Nodes (22): dom, dom.iterable, ES2023, compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules (+14 more)

### Community 2 - "scripts"
Cohesion: 0.08
Nodes (23): engines, node, name, private, scripts, build, check, check:conventions (+15 more)

### Community 3 - "tauri.conf.json"
Cohesion: 0.09
Nodes (22): icons/128x128@2x.png, icons/128x128.png, icons/32x32.png, icons/icon.icns, icons/icon.ico, app, security, windows (+14 more)

### Community 4 - "devDependencies"
Cohesion: 0.10
Nodes (21): eslint, eslint-config-next, devDependencies, eslint, eslint-config-next, prettier, @tauri-apps/cli, @types/node (+13 more)

### Community 5 - "default.json"
Cohesion: 0.22
Nodes (8): core:default, main, opener:default, description, identifier, permissions, $schema, windows

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

### Community 16 - "webdriver.mjs"
Cohesion: 0.27
Nodes (8): results, call(), locate(), openApp(), PORT, ROOT, sleep(), webview2Version()

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

## Knowledge Gaps
- **162 isolated node(s):** `printWidth`, `endOfLine`, `nextConfig`, `name`, `private` (+157 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `devDependencies` connect `devDependencies` to `scripts`?**
  _High betweenness centrality (0.024) - this node is a cross-community bridge._
- **Why does `dependencies` connect `dependencies` to `scripts`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **What connects `printWidth`, `endOfLine`, `nextConfig` to the rest of the system?**
  _162 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `sync-plan-issues.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.09090909090909091 - nodes in this community are weakly interconnected._
- **Should `compilerOptions` be split into smaller, more focused modules?**
  _Cohesion score 0.09090909090909091 - nodes in this community are weakly interconnected._
- **Should `scripts` be split into smaller, more focused modules?**
  _Cohesion score 0.08333333333333333 - nodes in this community are weakly interconnected._
- **Should `tauri.conf.json` be split into smaller, more focused modules?**
  _Cohesion score 0.08695652173913043 - nodes in this community are weakly interconnected._