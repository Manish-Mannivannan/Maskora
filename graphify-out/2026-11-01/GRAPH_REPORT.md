# Graph Report - Maskora  (2026-11-01)

## Corpus Check
- 148 files · ~110,217 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1379 nodes · 3230 edges · 71 communities (62 shown, 9 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 107 edges (avg confidence: 0.83)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `0bd1b381`
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
- model.ts
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
- offline-check.mjs
- sources.rs
- csp
- copy-pdfjs.mjs
- pipeline.ts
- adapter.ts
- ProjectSection.tsx
- facts.ts
- Section.tsx
- licenses.mjs
- reliefMesh.ts
- store.ts
- dependencies
- probe-production.mjs
- store.files.test.ts
- store.test.ts
- ExportStage.tsx
- package.json
- project.rs
- TrustStore
- projectFile.ts
- probe.ts
- PageScene.tsx
- transform.ts
- Workspace.tsx
- PdfSession
- pngText.ts
- probe-pdf.mjs
- parseProjectFile
- ProjectContext.tsx
- probe-relief.mjs
- smoke-project.mjs
- PageInspector.tsx
- finish.test.ts
- RegistrationResult
- finishMaterial.test.ts
- SceneProbeApi
- scene.tsx
- SourcesSection.tsx
- SourceInfo

## God Nodes (most connected - your core abstractions)
1. `ProjectStore` - 67 edges
2. `useProject()` - 42 edges
3. `makeDoc()` - 35 edges
4. `usePageSummaries()` - 27 edges
5. `TrustStore` - 26 edges
6. `pageKey()` - 25 edges
7. `scripts` - 23 edges
8. `SourceRegistry` - 22 edges
9. `Rect` - 20 edges
10. `ProjectError` - 19 edges

## Surprising Connections (you probably didn't know these)
- `classify_one()` --calls--> `hash_file()`  [INFERRED]
  src-tauri/src/project.rs → src-tauri/src/trust.rs
- `reopening_authorizes_only_what_the_trust_record_allows()` --calls--> `hash_file()`  [INFERRED]
  src-tauri/src/project.rs → src-tauri/src/trust.rs
- `DiagnosticsText()` --calls--> `diagnostics()`  [EXTRACTED]
  src/features/project/ProjectSection.tsx → src/diagnostics/log.ts
- `PasswordForm()` --calls--> `useProject()`  [EXTRACTED]
  src/features/document/SourcesSection.tsx → src/project/ProjectContext.tsx
- `dialog_turn()` --references--> `Turn`  [EXTRACTED]
  src-tauri/src/project.rs → src-tauri/src/dialog_turn.rs

## Import Cycles
- None detected.

## Communities (71 total, 9 thin omitted)

### Community 0 - "sync-plan-issues.mjs"
Cohesion: 0.09
Nodes (32): args, bodyFor(), dryIndex, existing, gh(), ghLines(), haveLabels, headingOf() (+24 more)

### Community 1 - "compilerOptions"
Cohesion: 0.06
Nodes (33): dom, dom.iterable, ES2023, .next/dev/types/**/*.ts, next-env.d.ts, .next/types/**/*.ts, node_modules, out (+25 more)

### Community 2 - "scripts"
Cohesion: 0.09
Nodes (23): scripts, build, check, check:conventions, check:rust, dev, format, format:check (+15 more)

### Community 3 - "geometry.rs"
Cohesion: 0.11
Nodes (46): Dictionary, Document, Object, ObjectId, a_damaged_page_tree_is_named_not_reported_as_empty(), BoxFact, check(), close() (+38 more)

### Community 4 - "devDependencies"
Cohesion: 0.10
Nodes (21): eslint, eslint-config-next, devDependencies, eslint, eslint-config-next, prettier, @tauri-apps/cli, @types/node (+13 more)

### Community 5 - "permissions"
Cohesion: 0.10
Nodes (20): allow-discard-recovery, allow-export-png, allow-forget-all-approvals, allow-forget-approval, allow-inspect-geometry, allow-list-approvals, allow-locate-source, allow-open-project (+12 more)

### Community 6 - "corpus.mjs"
Cohesion: 0.07
Nodes (69): A1(), artworkPage(), baseline(), box(), C1(), circle(), CORPUS, coverageLayout() (+61 more)

### Community 7 - "AGENTS.md — Instructions for coding agents"
Cohesion: 0.17
Nodes (11): AGENTS.md — Instructions for coding agents, Commits belong to the maintainer, Do not cite vault ADR numbers in the repository, Graphify, Keep architecture, plan, and code synchronized, Next.js version, Project invariants, Read canonical project documents first (+3 more)

### Community 8 - "model.ts"
Cohesion: 0.09
Nodes (39): close(), fmt(), ReconcilePanel(), BoxName, addLayer(), assignTarget(), DEFAULT_INTERPRETATION, EMPTY_MODEL (+31 more)

### Community 10 - "Maskora"
Cohesion: 0.07
Nodes (24): Build and install, Check, Codebase map, Data and limits, Fixtures, Licenses, Maskora, Native smoke (+16 more)

### Community 15 - "check-versions.mjs"
Cohesion: 0.18
Nodes (7): cargoLock, declared, npmRows, pkg, problems, root, versionsMd

### Community 16 - "smoke.mjs"
Cohesion: 0.11
Nodes (26): approvals, boxOrigins(), choose(), clearSources(), diagnostics(), dialog(), drag(), expect() (+18 more)

### Community 17 - "ProjectStore"
Cohesion: 0.07
Nodes (9): available(), failed(), valueOf(), toJson(), codeOf(), contentKey(), discard(), buildProject() (+1 more)

### Community 18 - "prefix-graphify-vault.mjs"
Cohesion: 0.25
Nodes (5): canvasPath, DEFAULT_DIR, dir, generated, unprefixed

### Community 19 - "check-secrets.mjs"
Cohesion: 0.33
Nodes (3): findings, repoRoot, TOKEN_PATTERNS

### Community 20 - "check-adr-references.mjs"
Cohesion: 0.40
Nodes (3): GENERATED, repoRoot, violations

### Community 27 - "offline-check.mjs"
Cohesion: 0.10
Nodes (18): after, approvals, before, c1, digests, FIXTURES, k1, network() (+10 more)

### Community 30 - "sources.rs"
Cohesion: 0.11
Nodes (33): Drop, Response, a_second_dialog_waits_for_the_first_to_close(), Option, take(), Turn, a_deleted_source_reports_missing_not_unauthorized(), a_file_over_the_source_limit_is_refused_as_too_large_before_it_is_read() (+25 more)

### Community 31 - "csp"
Cohesion: 0.04
Nodes (48): icons/128x128@2x.png, icons/128x128.png, icons/32x32.png, icons/icon.icns, icons/icon.ico, nsis, app, security (+40 more)

### Community 32 - "copy-pdfjs.mjs"
Cohesion: 0.40
Nodes (4): dest, root, src, { version }

### Community 35 - "pipeline.ts"
Cohesion: 0.21
Nodes (17): BoxPreview(), alphaVaries(), alphaCache, box(), deviceRect(), LayerInput, LayerResult, maskAlphaUsable() (+9 more)

### Community 36 - "adapter.ts"
Cohesion: 0.13
Nodes (19): classifyOpenError(), createLimiter(), INFO_FIELDS, MetadataField, openSession(), parsePdfDate(), PdfOpenError, PdfOpenErrorCode (+11 more)

### Community 37 - "ProjectSection.tsx"
Cohesion: 0.24
Nodes (11): Approvals(), DiagnosticsText(), lastText(), ProjectSection(), relinkText(), WHAT, Approval, forgetAllApprovals() (+3 more)

### Community 38 - "facts.ts"
Cohesion: 0.29
Nodes (11): BoxFact, FactOrigin, asRotation(), Rotation, boxFact(), BoxRow, DerivedRect, diagnose() (+3 more)

### Community 39 - "Section.tsx"
Cohesion: 0.43
Nodes (7): key(), listeners, memory, read(), Section(), subscribe(), write()

### Community 40 - "licenses.mjs"
Cohesion: 0.12
Nodes (16): ACCEPTED, assets, byId, counts, crates, flagged, meta, nodes (+8 more)

### Community 41 - "reliefMesh.ts"
Cohesion: 0.09
Nodes (35): heightProfile(), normalMap(), ReliefRequest, blurField(), BoundedRelief, buildBoundedReliefMesh(), buildReliefMesh(), distanceField() (+27 more)

### Community 42 - "store.ts"
Cohesion: 0.10
Nodes (22): DocMetadata, OptionalContentSummary, PdfPageFacts, Capability, notRequested, Provenance, running, Diagnostic (+14 more)

### Community 43 - "dependencies"
Cohesion: 0.12
Nodes (17): next, dependencies, next, pdfjs-dist, react, react-dom, @react-three/drei, @react-three/fiber (+9 more)

### Community 44 - "probe-production.mjs"
Cohesion: 0.15
Nodes (16): approvals, before, mapArg, measureFinishes(), name, out, recovery, report (+8 more)

### Community 45 - "store.files.test.ts"
Cohesion: 0.15
Nodes (14): Opened, Recovered, RecoveryRequest, Saved, SaveRequest, ART, deps(), Disk (+6 more)

### Community 46 - "store.test.ts"
Cohesion: 0.29
Nodes (7): GeometryReport, add(), deferred(), flush(), info(), scriptedDeps(), session()

### Community 47 - "ExportStage.tsx"
Cohesion: 0.20
Nodes (18): Capture(), ExportOptions, ExportSnapshot, frameCamera(), nextFrame(), raisedRepresentation(), reliefCurrent(), sameProfile() (+10 more)

### Community 48 - "package.json"
Cohesion: 0.29
Nodes (6): engines, node, name, private, type, version

### Community 49 - "project.rs"
Cohesion: 0.08
Nodes (84): Error, Located, Request, SourceInfo, SourceOnOpen, a_file_held_open_elsewhere_is_reported_and_kept(), a_reference_climbing_out_of_the_project_folder_grants_nothing(), an_interrupted_write_leaves_nothing_behind_on_the_next() (+76 more)

### Community 50 - "TrustStore"
Cohesion: 0.14
Nodes (26): Approval, Approval, approval_id(), approvals_are_listed_without_paths_and_can_be_forgotten(), crafted_and_oversized_records_trust_nothing_they_should_not(), forget_all_approvals(), forget_approval(), hash_file() (+18 more)

### Community 51 - "projectFile.ts"
Cohesion: 0.12
Nodes (22): FINISH_TYPES, RECIPE_LIMITS, SceneAssignment, STOCK_LIMITS, SurfaceBox, arr(), BOXES, DEFAULT_LIGHTING (+14 more)

### Community 52 - "probe.ts"
Cohesion: 0.16
Nodes (10): renderPlanned(), loadPdfjs(), localDocumentParams(), openDocument(), OpenedDocument, probe, Region, RenderOptions (+2 more)

### Community 53 - "PageScene.tsx"
Cohesion: 0.14
Nodes (25): LoggedEvent, Captured, ReliefShape, FinishRecipe, Stock, artworkTexture(), coatDigest(), coatTexture() (+17 more)

### Community 54 - "transform.ts"
Cohesion: 0.23
Nodes (10): ARTWORK_POLICY, basePoint(), BUDGETS, planRender(), PlanResult, Purpose, RenderPlan, RenderPolicy (+2 more)

### Community 55 - "Workspace.tsx"
Cohesion: 0.06
Nodes (73): clean(), clearDiagnostics(), DiagnosticEvent, diagnostics(), events, jobId(), record(), PageInspector() (+65 more)

### Community 57 - "pngText.ts"
Cohesion: 0.40
Nodes (8): addPngText(), chunk(), crc32(), CRC_TABLE, latin1(), readPngText(), SIGNATURE, tinyPng()

### Community 58 - "probe-pdf.mjs"
Cohesion: 0.14
Nodes (6): FIXTURES, known(), OUT, report, run, same()

### Community 59 - "parseProjectFile"
Cohesion: 0.53
Nodes (5): parseProjectFile(), fixture(), load(), refusal(), withValue()

### Community 60 - "ProjectContext.tsx"
Cohesion: 0.16
Nodes (16): discardRecovery(), Exported, locateSource(), openProject(), peekRecovery(), recoverProject(), saveProject(), saveRecovery() (+8 more)

### Community 61 - "probe-relief.mjs"
Cohesion: 0.23
Nodes (12): choose(), click(), expected, FIXTURES, luminance(), q(), report, run (+4 more)

### Community 62 - "smoke-project.mjs"
Cohesion: 0.33
Nodes (8): readPng(), appData(), asideAppData(), asideRecovery(), crashRecoveryChecks(), projectChecks(), recoverySlot(), resourceChecks()

### Community 63 - "PageInspector.tsx"
Cohesion: 0.18
Nodes (18): mm(), noSizeText(), ORIGIN_TEXT, sizeText(), BoxTable(), OUTLINE, Overrides(), ROLES (+10 more)

### Community 64 - "finish.test.ts"
Cohesion: 0.22
Nodes (9): boxBlur(), coverageFromPixels(), coveredOutside(), LayerCoverage, luma(), OVERLAY_COLORS, PageFrame, FinishType (+1 more)

### Community 65 - "RegistrationResult"
Cohesion: 0.19
Nodes (9): FinishMaps, Overlap, cache, clearFinishJobs(), FINISH_RESOLUTION, latestOnly(), RegistrationResult, Coating (+1 more)

### Community 66 - "finishMaterial.test.ts"
Cohesion: 0.32
Nodes (5): compose(), mapsDigest(), DEFAULT_RECIPES, STOCK_PRESETS, result()

### Community 68 - "scene.tsx"
Cohesion: 0.14
Nodes (20): FinishState, Rect, OverrideRect, PrintSurface, faceGeometry, fitDistance(), leafPlacements(), localFromUv() (+12 more)

### Community 69 - "SourcesSection.tsx"
Cohesion: 0.28
Nodes (7): bytesText(), CapabilityText(), PasswordForm(), SourceCard(), SourcesSection(), statusText(), LoadState

### Community 70 - "SourceInfo"
Cohesion: 0.40
Nodes (4): Located, SourceOnOpen, SourceInfo, LoadJob

## Knowledge Gaps
- **335 isolated node(s):** `printWidth`, `endOfLine`, `{ version }`, `nextConfig`, `name` (+330 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **9 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `label()` connect `reliefMesh.ts` to `probe-relief.mjs`?**
  _High betweenness centrality (0.092) - this node is a cross-community bridge._
- **Why does `ProjectStore` connect `ProjectStore` to `SourceInfo`, `store.ts`, `store.files.test.ts`, `store.test.ts`, `ProjectContext.tsx`?**
  _High betweenness centrality (0.035) - this node is a cross-community bridge._
- **Why does `ROOT` connect `probe-relief.mjs` to `licenses.mjs`, `probe-production.mjs`, `smoke.mjs`, `probe-pdf.mjs`, `offline-check.mjs`?**
  _High betweenness centrality (0.034) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `makeDoc()` (e.g. with `.add()` and `.build()`) actually correct?**
  _`makeDoc()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `printWidth`, `endOfLine`, `{ version }` to the rest of the system?**
  _335 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `sync-plan-issues.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.09090909090909091 - nodes in this community are weakly interconnected._
- **Should `compilerOptions` be split into smaller, more focused modules?**
  _Cohesion score 0.058823529411764705 - nodes in this community are weakly interconnected._