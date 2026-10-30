# Graph Report - Maskora  (2026-10-30)

## Corpus Check
- 17 files · ~4,950 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 150 nodes · 154 edges · 17 communities (12 shown, 5 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `343b9fd2`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- sync-plan-issues.mjs
- compilerOptions
- package.json
- tauri.conf.json
- devDependencies
- default.json
- icon
- compilerOptions
- App
- lib.rs
- Tauri + React + Typescript
- CLAUDE.md
- maskora

## God Nodes (most connected - your core abstractions)
1. `compilerOptions` - 16 edges
2. `scripts` - 6 edges
3. `slice()` - 6 edges
4. `readPhase()` - 6 edges
5. `icon` - 6 edges
6. `compilerOptions` - 6 edges
7. `rewrite()` - 5 edges
8. `build` - 5 edges
9. `gh()` - 4 edges
10. `bundle` - 4 edges

## Surprising Connections (you probably didn't know these)
- None detected - all connections are within the same source files.

## Import Cycles
- None detected.

## Communities (17 total, 5 thin omitted)

### Community 0 - "sync-plan-issues.mjs"
Cohesion: 0.09
Nodes (32): args, bodyFor(), dryIndex, existing, gh(), ghLines(), haveLabels, headingOf() (+24 more)

### Community 1 - "compilerOptions"
Cohesion: 0.09
Nodes (21): DOM, ES2020, src, compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib (+13 more)

### Community 2 - "package.json"
Cohesion: 0.10
Nodes (19): dependencies, react, react-dom, @tauri-apps/api, @tauri-apps/plugin-opener, name, private, scripts (+11 more)

### Community 3 - "tauri.conf.json"
Cohesion: 0.14
Nodes (13): app, security, windows, build, beforeBuildCommand, beforeDevCommand, devUrl, frontendDist (+5 more)

### Community 4 - "devDependencies"
Cohesion: 0.15
Nodes (13): devDependencies, @tauri-apps/cli, @types/react, @types/react-dom, typescript, vite, @vitejs/plugin-react, @tauri-apps/cli (+5 more)

### Community 5 - "default.json"
Cohesion: 0.22
Nodes (8): core:default, main, opener:default, description, identifier, permissions, $schema, windows

### Community 6 - "icon"
Cohesion: 0.22
Nodes (9): icons/128x128@2x.png, icons/128x128.png, icons/32x32.png, icons/icon.icns, icons/icon.ico, bundle, active, icon (+1 more)

### Community 7 - "compilerOptions"
Cohesion: 0.22
Nodes (8): vite.config.ts, compilerOptions, allowSyntheticDefaultImports, composite, module, moduleResolution, skipLibCheck, include

## Knowledge Gaps
- **85 isolated node(s):** `name`, `private`, `version`, `type`, `dev` (+80 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `devDependencies` connect `devDependencies` to `package.json`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **What connects `name`, `private`, `version` to the rest of the system?**
  _85 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `sync-plan-issues.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.09090909090909091 - nodes in this community are weakly interconnected._
- **Should `compilerOptions` be split into smaller, more focused modules?**
  _Cohesion score 0.09090909090909091 - nodes in this community are weakly interconnected._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._
- **Should `tauri.conf.json` be split into smaller, more focused modules?**
  _Cohesion score 0.14285714285714285 - nodes in this community are weakly interconnected._