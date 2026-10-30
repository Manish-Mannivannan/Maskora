# Graph Report - Maskora  (2026-10-30)

## Corpus Check
- 100 files · ~51,941 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 808 nodes · 1595 edges · 40 communities (33 shown, 7 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 51 edges (avg confidence: 0.83)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `3e4c5dab`
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
- smoke.mjs
- ProjectStore
- prefix-graphify-vault.mjs
- check-secrets.mjs
- check-adr-references.mjs
- .prettierrc.json
- layout.tsx
- pre-commit
- pre-push
- next.config.ts
- Viewport.tsx
- sources.rs
- csp
- copy-pdfjs.mjs
- pipeline.ts
- adapter.ts
- PageInspector.tsx
- model.ts
- Section.tsx

## God Nodes (most connected - your core abstractions)
1. `ProjectStore` - 34 edges
2. `makeDoc()` - 31 edges
3. `useProject()` - 25 edges
4. `scripts` - 20 edges
5. `compilerOptions` - 19 edges
6. `usePageSummaries()` - 18 edges
7. `pageKey()` - 16 edges
8. `inspect()` - 14 edges
9. `runRegistration()` - 14 edges
10. `fill()` - 14 edges

## Surprising Connections (you probably didn't know these)
- `inspect_geometry()` --references--> `SourceRegistry`  [EXTRACTED]
  src-tauri/src/geometry.rs → src-tauri/src/sources.rs
- `BoxPreview()` --calls--> `toDevice()`  [EXTRACTED]
  src/features/document/PageInspector.tsx → src/pdf/transform.ts
- `BoxTable()` --calls--> `sizeMm()`  [EXTRACTED]
  src/features/document/PageInspector.tsx → src/pdf/transform.ts
- `Overrides()` --calls--> `insetBy()`  [EXTRACTED]
  src/features/document/PageInspector.tsx → src/project/facts.ts
- `PageRoleControls()` --calls--> `surfaceFor()`  [EXTRACTED]
  src/features/document/PageInspector.tsx → src/project/model.ts

## Import Cycles
- None detected.

## Communities (40 total, 7 thin omitted)

### Community 0 - "sync-plan-issues.mjs"
Cohesion: 0.09
Nodes (32): args, bodyFor(), dryIndex, existing, gh(), ghLines(), haveLabels, headingOf() (+24 more)

### Community 1 - "compilerOptions"
Cohesion: 0.06
Nodes (33): dom, dom.iterable, ES2023, .next/dev/types/**/*.ts, next-env.d.ts, .next/types/**/*.ts, node_modules, out (+25 more)

### Community 2 - "scripts"
Cohesion: 0.05
Nodes (43): next, dependencies, next, pdfjs-dist, react, react-dom, @react-three/drei, @react-three/fiber (+35 more)

### Community 3 - "geometry.rs"
Cohesion: 0.11
Nodes (46): Dictionary, Document, Object, ObjectId, a_damaged_page_tree_is_named_not_reported_as_empty(), BoxFact, check(), close() (+38 more)

### Community 4 - "devDependencies"
Cohesion: 0.10
Nodes (21): eslint, eslint-config-next, devDependencies, eslint, eslint-config-next, prettier, @tauri-apps/cli, @types/node (+13 more)

### Community 5 - "default.json"
Cohesion: 0.20
Nodes (9): allow-inspect-geometry, allow-read-source, allow-select-source, main, description, identifier, permissions, $schema (+1 more)

### Community 6 - "corpus.mjs"
Cohesion: 0.08
Nodes (55): A1(), artworkPage(), baseline(), box(), CORPUS, coverageLayout(), D1(), defaulted() (+47 more)

### Community 7 - "AGENTS.md — Instructions for coding agents"
Cohesion: 0.17
Nodes (11): AGENTS.md — Instructions for coding agents, Commits belong to the maintainer, Do not cite vault ADR numbers in the repository, Graphify, Keep architecture, plan, and code synchronized, Next.js version, Project invariants, Read canonical project documents first (+3 more)

### Community 8 - "encrypt.mjs"
Cohesion: 0.56
Nodes (8): fileKey(), md5(), ownerEntry(), PAD, padded(), rc4(), standardSecurity(), userEntry()

### Community 10 - "Maskora"
Cohesion: 0.09
Nodes (20): Build, Check, Codebase map, Fixtures, Maskora, Plan mirror, Prerequisites, Run (+12 more)

### Community 15 - "check-versions.mjs"
Cohesion: 0.18
Nodes (7): cargoLock, declared, npmRows, pkg, problems, root, versionsMd

### Community 16 - "smoke.mjs"
Cohesion: 0.07
Nodes (31): FIXTURES, known(), OUT, report, run, same(), boxOrigins(), choose() (+23 more)

### Community 17 - "ProjectStore"
Cohesion: 0.07
Nodes (11): SourceInfo, PdfSession, codeOf(), ProjectDeps, ProjectStore, add(), deferred(), flush() (+3 more)

### Community 18 - "prefix-graphify-vault.mjs"
Cohesion: 0.25
Nodes (5): canvasPath, DEFAULT_DIR, dir, generated, unprefixed

### Community 19 - "check-secrets.mjs"
Cohesion: 0.33
Nodes (3): findings, repoRoot, TOKEN_PATTERNS

### Community 20 - "check-adr-references.mjs"
Cohesion: 0.40
Nodes (3): GENERATED, repoRoot, violations

### Community 27 - "Viewport.tsx"
Cohesion: 0.18
Nodes (14): Viewport, DRAG_DEGREES_PER_PIXEL, dragLight(), ELEVATION_MAX, ELEVATION_MIN, LightAngles, lightDirection(), normalizeAngles() (+6 more)

### Community 30 - "sources.rs"
Cohesion: 0.16
Nodes (26): AppHandle, HashMap, Mutex, Path, PathBuf, Response, Self, a_deleted_source_reports_missing_not_unauthorized() (+18 more)

### Community 31 - "csp"
Cohesion: 0.05
Nodes (42): icons/128x128@2x.png, icons/128x128.png, icons/32x32.png, icons/icon.icns, icons/icon.ico, app, security, windows (+34 more)

### Community 32 - "copy-pdfjs.mjs"
Cohesion: 0.40
Nodes (4): dest, root, src, { version }

### Community 35 - "pipeline.ts"
Cohesion: 0.07
Nodes (54): alphaVaries(), boxBlur(), compose(), coverageFromPixels(), coveredOutside(), FinishMaps, LayerCoverage, luma() (+46 more)

### Community 36 - "adapter.ts"
Cohesion: 0.08
Nodes (28): classifyOpenError(), createLimiter(), INFO_FIELDS, MetadataField, openSession(), parsePdfDate(), PdfOpenError, PdfOpenErrorCode (+20 more)

### Community 37 - "PageInspector.tsx"
Cohesion: 0.06
Nodes (77): bytesText(), mm(), noSizeText(), ORIGIN_TEXT, sizeText(), BoxPreview(), BoxTable(), OUTLINE (+69 more)

### Community 38 - "model.ts"
Cohesion: 0.10
Nodes (34): LayerInput, BoxName, addLayer(), assignTarget(), DEFAULT_INTERPRETATION, EMPTY_MODEL, FINISH_TYPES, FinishLayer (+26 more)

### Community 39 - "Section.tsx"
Cohesion: 0.43
Nodes (7): key(), listeners, memory, read(), Section(), subscribe(), write()

## Knowledge Gaps
- **238 isolated node(s):** `printWidth`, `endOfLine`, `nextConfig`, `name`, `private` (+233 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `ProjectStore` connect `ProjectStore` to `PageInspector.tsx`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **Why does `PdfSession` connect `ProjectStore` to `pipeline.ts`, `adapter.ts`, `PageInspector.tsx`?**
  _High betweenness centrality (0.007) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `makeDoc()` (e.g. with `.add()` and `.build()`) actually correct?**
  _`makeDoc()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `printWidth`, `endOfLine`, `nextConfig` to the rest of the system?**
  _238 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `sync-plan-issues.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.09090909090909091 - nodes in this community are weakly interconnected._
- **Should `compilerOptions` be split into smaller, more focused modules?**
  _Cohesion score 0.058823529411764705 - nodes in this community are weakly interconnected._
- **Should `scripts` be split into smaller, more focused modules?**
  _Cohesion score 0.045454545454545456 - nodes in this community are weakly interconnected._