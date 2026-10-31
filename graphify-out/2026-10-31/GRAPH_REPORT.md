# Graph Report - Maskora  (2026-10-31)

## Corpus Check
- 118 files · ~71,347 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 946 nodes · 1999 edges · 50 communities (41 shown, 9 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 55 edges (avg confidence: 0.83)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `911bec6c`
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
- PageScene.tsx
- sources.rs
- csp
- copy-pdfjs.mjs
- pipeline.ts
- adapter.ts
- model.ts
- facts.ts
- Section.tsx
- probe-pdf.mjs
- reliefMesh.ts
- store.ts
- dependencies
- .#begin
- ProjectContext.tsx
- store.test.ts
- .#patchSource
- package.json
- PdfSession

## God Nodes (most connected - your core abstractions)
1. `ProjectStore` - 37 edges
2. `useProject()` - 34 edges
3. `makeDoc()` - 34 edges
4. `usePageSummaries()` - 23 edges
5. `scripts` - 21 edges
6. `pageKey()` - 21 edges
7. `compilerOptions` - 19 edges
8. `Rect` - 17 edges
9. `Viewport()` - 16 edges
10. `runRegistration()` - 15 edges

## Surprising Connections (you probably didn't know these)
- `PasswordForm()` --calls--> `useProject()`  [EXTRACTED]
  src/features/document/SourcesSection.tsx → src/project/ProjectContext.tsx
- `plan()` --calls--> `planRender()`  [EXTRACTED]
  src/pdf/transform.test.ts → src/pdf/transform.ts
- `OverrideRect` --references--> `Rect`  [EXTRACTED]
  src/project/facts.ts → src/pdf/transform.ts
- `inspect_geometry()` --references--> `SourceRegistry`  [EXTRACTED]
  src-tauri/src/geometry.rs → src-tauri/src/sources.rs
- `BoxPreview()` --calls--> `useProject()`  [EXTRACTED]
  src/features/document/PageInspector.tsx → src/project/ProjectContext.tsx

## Import Cycles
- None detected.

## Communities (50 total, 9 thin omitted)

### Community 0 - "sync-plan-issues.mjs"
Cohesion: 0.09
Nodes (32): args, bodyFor(), dryIndex, existing, gh(), ghLines(), haveLabels, headingOf() (+24 more)

### Community 1 - "compilerOptions"
Cohesion: 0.06
Nodes (33): dom, dom.iterable, ES2023, .next/dev/types/**/*.ts, next-env.d.ts, .next/types/**/*.ts, node_modules, out (+25 more)

### Community 2 - "scripts"
Cohesion: 0.10
Nodes (21): scripts, build, check, check:conventions, check:rust, dev, format, format:check (+13 more)

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
Nodes (60): A1(), artworkPage(), baseline(), box(), circle(), CORPUS, coverageLayout(), D1() (+52 more)

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
Cohesion: 0.13
Nodes (23): boxOrigins(), choose(), clearSources(), diagnostics(), dialog(), drag(), expect(), faces3d() (+15 more)

### Community 18 - "prefix-graphify-vault.mjs"
Cohesion: 0.25
Nodes (5): canvasPath, DEFAULT_DIR, dir, generated, unprefixed

### Community 19 - "check-secrets.mjs"
Cohesion: 0.33
Nodes (3): findings, repoRoot, TOKEN_PATTERNS

### Community 20 - "check-adr-references.mjs"
Cohesion: 0.40
Nodes (3): GENERATED, repoRoot, violations

### Community 27 - "PageScene.tsx"
Cohesion: 0.07
Nodes (49): normalMap(), ReliefShape, FinishRecipe, FinishType, Stock, artworkTexture(), coatDigest(), coatTexture() (+41 more)

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
Cohesion: 0.06
Nodes (52): BoxPreview(), alphaVaries(), boxBlur(), compose(), coverageFromPixels(), coveredOutside(), FinishMaps, LayerCoverage (+44 more)

### Community 36 - "adapter.ts"
Cohesion: 0.08
Nodes (30): classifyOpenError(), createLimiter(), INFO_FIELDS, MetadataField, openSession(), parsePdfDate(), PdfOpenError, PdfOpenErrorCode (+22 more)

### Community 37 - "model.ts"
Cohesion: 0.05
Nodes (90): mm(), noSizeText(), ORIGIN_TEXT, sizeText(), BoxTable(), OUTLINE, Overrides(), PageInspector() (+82 more)

### Community 38 - "facts.ts"
Cohesion: 0.16
Nodes (15): PageInput, BoxFact, FactOrigin, Rotation, BOX_NAMES, boxFact(), BoxName, BoxRow (+7 more)

### Community 39 - "Section.tsx"
Cohesion: 0.43
Nodes (7): key(), listeners, memory, read(), Section(), subscribe(), write()

### Community 40 - "probe-pdf.mjs"
Cohesion: 0.08
Nodes (24): FIXTURES, known(), OUT, report, run, same(), choose(), click() (+16 more)

### Community 41 - "reliefMesh.ts"
Cohesion: 0.12
Nodes (26): heightProfile(), ReliefRequest, blurField(), BoundedRelief, buildBoundedReliefMesh(), buildReliefMesh(), distanceField(), downsample() (+18 more)

### Community 42 - "store.ts"
Cohesion: 0.15
Nodes (19): bytesText(), CapabilityText(), PasswordForm(), SourceCard(), SourcesSection(), statusText(), GeometryReport, DocMetadata (+11 more)

### Community 43 - "dependencies"
Cohesion: 0.12
Nodes (17): next, dependencies, next, pdfjs-dist, react, react-dom, @react-three/drei, @react-three/fiber (+9 more)

### Community 44 - ".#begin"
Cohesion: 0.26
Nodes (3): SourceInfo, codeOf(), ProjectDeps

### Community 45 - "ProjectContext.tsx"
Cohesion: 0.24
Nodes (8): inspectGeometry(), PageGeometry, readSource(), selectSource(), SourceError, nativeDeps, ProjectContext, ProjectProvider()

### Community 46 - "store.test.ts"
Cohesion: 0.33
Nodes (6): add(), deferred(), flush(), info(), scriptedDeps(), session()

### Community 47 - ".#patchSource"
Cohesion: 0.29
Nodes (3): available(), failed(), valueOf()

### Community 48 - "package.json"
Cohesion: 0.29
Nodes (6): engines, node, name, private, type, version

## Knowledge Gaps
- **253 isolated node(s):** `printWidth`, `endOfLine`, `nextConfig`, `name`, `private` (+248 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **9 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `label()` connect `reliefMesh.ts` to `probe-pdf.mjs`?**
  _High betweenness centrality (0.064) - this node is a cross-community bridge._
- **Why does `ProjectStore` connect `ProjectStore` to `facts.ts`, `store.ts`, `.#begin`, `ProjectContext.tsx`, `store.test.ts`, `.#patchSource`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **Why does `openApp()` connect `probe-pdf.mjs` to `smoke.mjs`?**
  _High betweenness centrality (0.017) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `makeDoc()` (e.g. with `.add()` and `.build()`) actually correct?**
  _`makeDoc()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `printWidth`, `endOfLine`, `nextConfig` to the rest of the system?**
  _253 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `sync-plan-issues.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.09090909090909091 - nodes in this community are weakly interconnected._
- **Should `compilerOptions` be split into smaller, more focused modules?**
  _Cohesion score 0.058823529411764705 - nodes in this community are weakly interconnected._