# Graph Report - Maskora  (2026-10-31)

## Corpus Check
- 136 files · ~99,005 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1242 nodes · 2944 edges · 59 communities (52 shown, 7 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 102 edges (avg confidence: 0.83)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `a197c230`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- sync-plan-issues.mjs
- compilerOptions
- scripts
- geometry.rs
- devDependencies
- permissions
- corpus.mjs
- AGENTS.md — Instructions for coding agents
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
- ExportStage.tsx
- sources.rs
- csp
- copy-pdfjs.mjs
- pipeline.ts
- adapter.ts
- ReconcilePanel.tsx
- PageInspector.tsx
- Section.tsx
- probe-pdf.mjs
- PageScene.tsx
- store.ts
- dependencies
- .#begin
- ProjectContext.tsx
- store.test.ts
- .save
- package.json
- project.rs
- projectFile.ts
- model.ts
- probe.ts
- transform.ts
- model.test.ts
- probe-relief.mjs
- pngText.ts
- webdriver.mjs
- parseProjectFile
- smoke-project.mjs

## God Nodes (most connected - your core abstractions)
1. `ProjectStore` - 67 edges
2. `useProject()` - 42 edges
3. `makeDoc()` - 34 edges
4. `usePageSummaries()` - 27 edges
5. `pageKey()` - 25 edges
6. `SourceRegistry` - 22 edges
7. `scripts` - 21 edges
8. `Rect` - 20 edges
9. `TrustStore` - 19 edges
10. `compilerOptions` - 19 edges

## Surprising Connections (you probably didn't know these)
- `PasswordForm()` --calls--> `useProject()`  [EXTRACTED]
  src/features/document/SourcesSection.tsx → src/project/ProjectContext.tsx
- `inspect_geometry()` --references--> `SourceRegistry`  [EXTRACTED]
  src-tauri/src/geometry.rs → src-tauri/src/sources.rs
- `write_snapshot()` --calls--> `write_atomically()`  [INFERRED]
  src-tauri/src/recovery.rs → src-tauri/src/project.rs
- `recover()` --calls--> `validate_project()`  [INFERRED]
  src-tauri/src/recovery.rs → src-tauri/src/project.rs
- `write_snapshot()` --calls--> `validate_project()`  [INFERRED]
  src-tauri/src/recovery.rs → src-tauri/src/project.rs

## Import Cycles
- None detected.

## Communities (59 total, 7 thin omitted)

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

### Community 5 - "permissions"
Cohesion: 0.11
Nodes (17): allow-discard-recovery, allow-export-png, allow-inspect-geometry, allow-locate-source, allow-open-project, allow-peek-recovery, allow-read-source, allow-recover-project (+9 more)

### Community 6 - "corpus.mjs"
Cohesion: 0.07
Nodes (68): A1(), artworkPage(), baseline(), box(), circle(), CORPUS, coverageLayout(), D1() (+60 more)

### Community 7 - "AGENTS.md — Instructions for coding agents"
Cohesion: 0.17
Nodes (11): AGENTS.md — Instructions for coding agents, Commits belong to the maintainer, Do not cite vault ADR numbers in the repository, Graphify, Keep architecture, plan, and code synchronized, Next.js version, Project invariants, Read canonical project documents first (+3 more)

### Community 10 - "Maskora"
Cohesion: 0.09
Nodes (20): Build, Check, Codebase map, Fixtures, Maskora, Plan mirror, Prerequisites, Run (+12 more)

### Community 15 - "check-versions.mjs"
Cohesion: 0.18
Nodes (7): cargoLock, declared, npmRows, pkg, problems, root, versionsMd

### Community 16 - "smoke.mjs"
Cohesion: 0.12
Nodes (24): boxOrigins(), choose(), clearSources(), diagnostics(), dialog(), drag(), expect(), faces3d() (+16 more)

### Community 17 - "ProjectStore"
Cohesion: 0.11
Nodes (3): buildProject(), peek(), ProjectStore

### Community 18 - "prefix-graphify-vault.mjs"
Cohesion: 0.25
Nodes (5): canvasPath, DEFAULT_DIR, dir, generated, unprefixed

### Community 19 - "check-secrets.mjs"
Cohesion: 0.33
Nodes (3): findings, repoRoot, TOKEN_PATTERNS

### Community 20 - "check-adr-references.mjs"
Cohesion: 0.40
Nodes (3): GENERATED, repoRoot, violations

### Community 27 - "ExportStage.tsx"
Cohesion: 0.05
Nodes (97): noSizeText(), PageInspector(), PageRoleControls(), PagesSection(), ROLE_BADGE, SourcePages(), Thumbnail(), ThumbState (+89 more)

### Community 30 - "sources.rs"
Cohesion: 0.16
Nodes (28): Response, a_deleted_source_reports_missing_not_unauthorized(), a_path_is_not_a_handle(), an_authorized_handle_reads_the_selected_bytes(), an_unknown_handle_is_refused(), authorize_and_remember(), errors_never_contain_the_path(), handles_are_unguessable_and_distinct() (+20 more)

### Community 31 - "csp"
Cohesion: 0.05
Nodes (42): icons/128x128@2x.png, icons/128x128.png, icons/32x32.png, icons/icon.icns, icons/icon.ico, app, security, windows (+34 more)

### Community 32 - "copy-pdfjs.mjs"
Cohesion: 0.40
Nodes (4): dest, root, src, { version }

### Community 35 - "pipeline.ts"
Cohesion: 0.12
Nodes (30): alphaVaries(), boxBlur(), compose(), coverageFromPixels(), coveredOutside(), FinishMaps, LayerCoverage, luma() (+22 more)

### Community 36 - "adapter.ts"
Cohesion: 0.13
Nodes (19): classifyOpenError(), createLimiter(), INFO_FIELDS, MetadataField, openSession(), parsePdfDate(), PdfOpenError, PdfOpenErrorCode (+11 more)

### Community 37 - "ReconcilePanel.tsx"
Cohesion: 0.26
Nodes (10): lastText(), ProjectSection(), relinkText(), WHAT, close(), fmt(), ReconcilePanel(), remapSource() (+2 more)

### Community 38 - "PageInspector.tsx"
Cohesion: 0.14
Nodes (25): mm(), sizeText(), BoxTable(), OUTLINE, Overrides(), ROLES, SURFACE_BOXES, PageInput (+17 more)

### Community 39 - "Section.tsx"
Cohesion: 0.43
Nodes (7): key(), listeners, memory, read(), Section(), subscribe(), write()

### Community 40 - "probe-pdf.mjs"
Cohesion: 0.14
Nodes (6): FIXTURES, known(), OUT, report, run, same()

### Community 41 - "PageScene.tsx"
Cohesion: 0.05
Nodes (57): heightProfile(), normalMap(), cache, clearFinishJobs(), FINISH_RESOLUTION, latestOnly(), ReliefRequest, blurField() (+49 more)

### Community 42 - "store.ts"
Cohesion: 0.09
Nodes (25): bytesText(), ORIGIN_TEXT, CapabilityText(), PasswordForm(), SourceCard(), SourcesSection(), statusText(), DocMetadata (+17 more)

### Community 43 - "dependencies"
Cohesion: 0.12
Nodes (17): next, dependencies, next, pdfjs-dist, react, react-dom, @react-three/drei, @react-three/fiber (+9 more)

### Community 44 - ".#begin"
Cohesion: 0.14
Nodes (6): SourceOnOpen, codeOf(), flush(), reopen(), locate(), safeJson()

### Community 45 - "ProjectContext.tsx"
Cohesion: 0.09
Nodes (33): discardRecovery(), Exported, Located, locateSource(), Opened, openProject(), peekRecovery(), Recovered (+25 more)

### Community 46 - "store.test.ts"
Cohesion: 0.17
Nodes (7): PdfSession, add(), deferred(), flush(), info(), scriptedDeps(), session()

### Community 47 - ".save"
Cohesion: 0.24
Nodes (4): toJson(), contentKey(), discard(), savedPages()

### Community 48 - "package.json"
Cohesion: 0.29
Nodes (6): engines, node, name, private, type, version

### Community 49 - "project.rs"
Cohesion: 0.06
Nodes (95): Error, Located, Request, SourceInfo, SourceOnOpen, a_file_held_open_elsewhere_is_reported_and_kept(), an_interrupted_write_leaves_nothing_behind_on_the_next(), atomic_writes_replace_whole_files_and_leave_nothing_behind_on_failure() (+87 more)

### Community 50 - "projectFile.ts"
Cohesion: 0.10
Nodes (25): RECIPE_LIMITS, SceneAssignment, STOCK_LIMITS, STOCK_PRESETS, SurfaceBox, arr(), BOXES, DEFAULT_LIGHTING (+17 more)

### Community 51 - "model.ts"
Cohesion: 0.12
Nodes (22): BoxName, addLayer(), assignTarget(), DEFAULT_INTERPRETATION, DEFAULT_RECIPES, FINISH_TYPES, FUTURE_KINDS, MaskSource (+14 more)

### Community 52 - "probe.ts"
Cohesion: 0.18
Nodes (8): loadPdfjs(), localDocumentParams(), openDocument(), OpenedDocument, probe, Region, RenderOptions, withDocument()

### Community 54 - "transform.ts"
Cohesion: 0.13
Nodes (21): BoxPreview(), renderRegion(), ARTWORK_POLICY, asRotation(), basePoint(), BUDGETS, planRender(), PlanResult (+13 more)

### Community 55 - "model.test.ts"
Cohesion: 0.18
Nodes (15): EMPTY_MODEL, moveLayer(), PageRole, pruneScene(), removeSource(), sameRef(), serializeMaskSource(), setRole() (+7 more)

### Community 56 - "probe-relief.mjs"
Cohesion: 0.23
Nodes (12): choose(), click(), expected, FIXTURES, luminance(), q(), report, run (+4 more)

### Community 57 - "pngText.ts"
Cohesion: 0.40
Nodes (8): addPngText(), chunk(), crc32(), CRC_TABLE, latin1(), readPngText(), SIGNATURE, tinyPng()

### Community 59 - "webdriver.mjs"
Cohesion: 0.48
Nodes (6): call(), locate(), openApp(), PORT, sleep(), webview2Version()

### Community 61 - "parseProjectFile"
Cohesion: 0.53
Nodes (5): parseProjectFile(), fixture(), load(), refusal(), withValue()

### Community 62 - "smoke-project.mjs"
Cohesion: 0.48
Nodes (5): readPng(), asideRecovery(), crashRecoveryChecks(), projectChecks(), recoverySlot()

## Knowledge Gaps
- **283 isolated node(s):** `printWidth`, `endOfLine`, `{ version }`, `nextConfig`, `name` (+278 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `label()` connect `PageScene.tsx` to `probe-relief.mjs`?**
  _High betweenness centrality (0.050) - this node is a cross-community bridge._
- **Why does `ProjectStore` connect `ProjectStore` to `store.ts`, `.#begin`, `ProjectContext.tsx`, `store.test.ts`, `.save`?**
  _High betweenness centrality (0.024) - this node is a cross-community bridge._
- **Why does `openApp()` connect `webdriver.mjs` to `probe-pdf.mjs`, `smoke.mjs`, `probe-relief.mjs`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `makeDoc()` (e.g. with `.add()` and `.build()`) actually correct?**
  _`makeDoc()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `printWidth`, `endOfLine`, `{ version }` to the rest of the system?**
  _283 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `sync-plan-issues.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.09090909090909091 - nodes in this community are weakly interconnected._
- **Should `compilerOptions` be split into smaller, more focused modules?**
  _Cohesion score 0.058823529411764705 - nodes in this community are weakly interconnected._