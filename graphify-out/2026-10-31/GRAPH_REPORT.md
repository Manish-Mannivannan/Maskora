# Graph Report - Maskora  (2026-10-31)

## Corpus Check
- 140 files · ~102,598 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1271 nodes · 3028 edges · 68 communities (60 shown, 8 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 102 edges (avg confidence: 0.83)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `8d6f0d41`
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
- recovery.rs
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
- log.ts
- facts.ts
- Section.tsx
- probe-pdf.mjs
- reliefMesh.ts
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
- scene.tsx
- PageScene.tsx
- transform.ts
- useProject
- probe-relief.mjs
- pngText.ts
- Workspace.tsx
- webdriver.mjs
- finishMaterial.ts
- reliefWorker.test.ts
- smoke-project.mjs
- PageInspector.tsx
- reliefWorker.ts
- jobs.ts
- mmPerUnit
- SceneProbeApi

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
- `write_snapshot()` --calls--> `write_atomically()`  [INFERRED]
  src-tauri/src/recovery.rs → src-tauri/src/project.rs
- `recover()` --calls--> `validate_project()`  [INFERRED]
  src-tauri/src/recovery.rs → src-tauri/src/project.rs
- `write_snapshot()` --calls--> `validate_project()`  [INFERRED]
  src-tauri/src/recovery.rs → src-tauri/src/project.rs
- `classify_one()` --calls--> `hash_file()`  [INFERRED]
  src-tauri/src/project.rs → src-tauri/src/trust.rs
- `recover()` --calls--> `classify_one()`  [INFERRED]
  src-tauri/src/recovery.rs → src-tauri/src/project.rs

## Import Cycles
- None detected.

## Communities (68 total, 8 thin omitted)

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

### Community 8 - "recovery.rs"
Cohesion: 0.10
Nodes (43): SourceOnOpen, a_corrupt_snapshot_offers_nothing(), a_snapshot_round_trips_and_its_sources_are_judged_by_the_trust_record(), discard_recovery(), err(), peek_recovery(), Pending, project_json() (+35 more)

### Community 10 - "Maskora"
Cohesion: 0.09
Nodes (20): Build, Check, Codebase map, Fixtures, Maskora, Plan mirror, Prerequisites, Run (+12 more)

### Community 15 - "check-versions.mjs"
Cohesion: 0.18
Nodes (7): cargoLock, declared, npmRows, pkg, problems, root, versionsMd

### Community 16 - "smoke.mjs"
Cohesion: 0.11
Nodes (25): boxOrigins(), choose(), clearSources(), diagnostics(), dialog(), drag(), expect(), faces3d() (+17 more)

### Community 17 - "ProjectStore"
Cohesion: 0.10
Nodes (4): buildProject(), peek(), ProjectStore, roundPose()

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
Cohesion: 0.11
Nodes (34): BACKGROUNDS, ExportSection(), noSubscription(), Progress, STEP_TEXT, viewportAspect(), Capture(), EXPORT_MAX (+26 more)

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
Cohesion: 0.11
Nodes (28): alphaVaries(), boxBlur(), compose(), coverageFromPixels(), coveredOutside(), FinishMaps, LayerCoverage, luma() (+20 more)

### Community 36 - "adapter.ts"
Cohesion: 0.09
Nodes (25): classifyOpenError(), createLimiter(), INFO_FIELDS, MetadataField, openSession(), parsePdfDate(), PdfOpenError, PdfOpenErrorCode (+17 more)

### Community 37 - "log.ts"
Cohesion: 0.20
Nodes (13): clean(), clearDiagnostics(), DiagnosticEvent, diagnostics(), events, jobId(), record(), DiagnosticsText() (+5 more)

### Community 38 - "facts.ts"
Cohesion: 0.15
Nodes (17): PageInput, BoxFact, FactOrigin, asRotation(), Rotation, BOX_NAMES, boxFact(), BoxName (+9 more)

### Community 39 - "Section.tsx"
Cohesion: 0.43
Nodes (7): key(), listeners, memory, read(), Section(), subscribe(), write()

### Community 40 - "probe-pdf.mjs"
Cohesion: 0.14
Nodes (6): FIXTURES, known(), OUT, report, run, same()

### Community 41 - "reliefMesh.ts"
Cohesion: 0.18
Nodes (17): blurField(), buildBoundedReliefMesh(), buildReliefMesh(), distanceField(), downsample(), edt1d(), estimateTriangles(), label() (+9 more)

### Community 42 - "store.ts"
Cohesion: 0.10
Nodes (24): bytesText(), CapabilityText(), PasswordForm(), SourceCard(), SourcesSection(), statusText(), DocMetadata, OptionalContentSummary (+16 more)

### Community 43 - "dependencies"
Cohesion: 0.12
Nodes (17): next, dependencies, next, pdfjs-dist, react, react-dom, @react-three/drei, @react-three/fiber (+9 more)

### Community 44 - ".#begin"
Cohesion: 0.19
Nodes (3): codeOf(), locate(), safeJson()

### Community 45 - "ProjectContext.tsx"
Cohesion: 0.09
Nodes (34): discardRecovery(), Exported, Located, locateSource(), Opened, openProject(), peekRecovery(), Recovered (+26 more)

### Community 46 - "store.test.ts"
Cohesion: 0.16
Nodes (7): PdfSession, add(), deferred(), flush(), info(), scriptedDeps(), session()

### Community 47 - ".save"
Cohesion: 0.26
Nodes (5): valueOf(), toJson(), contentKey(), discard(), savedPages()

### Community 48 - "package.json"
Cohesion: 0.29
Nodes (6): engines, node, name, private, type, version

### Community 49 - "project.rs"
Cohesion: 0.12
Nodes (53): Error, Located, Request, SourceInfo, a_file_held_open_elsewhere_is_reported_and_kept(), an_interrupted_write_leaves_nothing_behind_on_the_next(), atomic_writes_replace_whole_files_and_leave_nothing_behind_on_failure(), check_png() (+45 more)

### Community 50 - "projectFile.ts"
Cohesion: 0.09
Nodes (29): FINISH_TYPES, RECIPE_LIMITS, SceneAssignment, STOCK_LIMITS, SurfaceBox, arr(), BOXES, DEFAULT_LIGHTING (+21 more)

### Community 51 - "model.ts"
Cohesion: 0.10
Nodes (35): close(), fmt(), ReconcilePanel(), assignTarget(), EMPTY_MODEL, FUTURE_KINDS, MaskSource, moveLayer() (+27 more)

### Community 52 - "scene.tsx"
Cohesion: 0.14
Nodes (25): Viewport, FINISH_NAMES, PrintSurface, surfaceFor(), fitDistance(), leafPlacements(), sizesDiffer(), spreadPlacements() (+17 more)

### Community 53 - "PageScene.tsx"
Cohesion: 0.16
Nodes (20): LoggedEvent, latestOnly(), ReliefShape, toDevice(), artworkTexture(), faceGeometry, localFromUv(), Placement (+12 more)

### Community 54 - "transform.ts"
Cohesion: 0.18
Nodes (14): PageFrame, ARTWORK_POLICY, basePoint(), BUDGETS, planRender(), PlanResult, Purpose, Rect (+6 more)

### Community 55 - "useProject"
Cohesion: 0.19
Nodes (26): PageRoleControls(), PagesSection(), ROLE_BADGE, SourcePages(), Thumbnail(), ThumbState, pageName(), usePageSummaries() (+18 more)

### Community 56 - "probe-relief.mjs"
Cohesion: 0.23
Nodes (12): choose(), click(), expected, FIXTURES, luminance(), q(), report, run (+4 more)

### Community 57 - "pngText.ts"
Cohesion: 0.40
Nodes (8): addPngText(), chunk(), crc32(), CRC_TABLE, latin1(), readPngText(), SIGNATURE, tinyPng()

### Community 58 - "Workspace.tsx"
Cohesion: 0.15
Nodes (15): clampPanelWidth(), PANEL_DEFAULT, PANEL_KEY_STEP, PANEL_MAX, PANEL_MIN, MainView(), PagesSummary(), Shell() (+7 more)

### Community 59 - "webdriver.mjs"
Cohesion: 0.48
Nodes (6): call(), locate(), openApp(), PORT, sleep(), webview2Version()

### Community 60 - "finishMaterial.ts"
Cohesion: 0.16
Nodes (13): Captured, DEFAULT_RECIPES, FinishRecipe, Stock, STOCK_PRESETS, coatDigest(), coatTexture(), dataTexture() (+5 more)

### Community 61 - "reliefWorker.test.ts"
Cohesion: 0.21
Nodes (10): heightProfile(), normalMap(), ReliefRequest, NearestRim, profileHeight(), ReliefProfile, setReliefWorkerFactory(), FakeWorker (+2 more)

### Community 62 - "smoke-project.mjs"
Cohesion: 0.48
Nodes (5): readPng(), asideRecovery(), crashRecoveryChecks(), projectChecks(), recoverySlot()

### Community 63 - "PageInspector.tsx"
Cohesion: 0.24
Nodes (13): mm(), noSizeText(), ORIGIN_TEXT, sizeText(), BoxPreview(), BoxTable(), OUTLINE, Overrides() (+5 more)

### Community 64 - "reliefWorker.ts"
Cohesion: 0.33
Nodes (9): BoundedRelief, Answer, ask(), buildNormalsOffThread(), buildReliefOffThread(), create(), fail(), instance() (+1 more)

### Community 65 - "jobs.ts"
Cohesion: 0.32
Nodes (4): cache, clearFinishJobs(), FINISH_RESOLUTION, finishJob()

### Community 66 - "mmPerUnit"
Cohesion: 0.67
Nodes (5): maskRegion(), mm1(), registrationWarnings(), mmPerUnit(), sizeMm()

## Knowledge Gaps
- **286 isolated node(s):** `printWidth`, `endOfLine`, `{ version }`, `nextConfig`, `name` (+281 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `label()` connect `reliefMesh.ts` to `probe-relief.mjs`?**
  _High betweenness centrality (0.052) - this node is a cross-community bridge._
- **Why does `ProjectStore` connect `ProjectStore` to `store.ts`, `.#begin`, `ProjectContext.tsx`, `store.test.ts`, `.save`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **Why does `openApp()` connect `webdriver.mjs` to `probe-pdf.mjs`, `smoke.mjs`, `probe-relief.mjs`?**
  _High betweenness centrality (0.013) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `makeDoc()` (e.g. with `.add()` and `.build()`) actually correct?**
  _`makeDoc()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `printWidth`, `endOfLine`, `{ version }` to the rest of the system?**
  _286 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `sync-plan-issues.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.09090909090909091 - nodes in this community are weakly interconnected._
- **Should `compilerOptions` be split into smaller, more focused modules?**
  _Cohesion score 0.058823529411764705 - nodes in this community are weakly interconnected._