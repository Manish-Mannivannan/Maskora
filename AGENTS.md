# AGENTS.md — Instructions for coding agents

## Read canonical project documents first

Architecture and planning live in the maintainer's Obsidian vault: `Obsidian/Projects/Maskora/`.

Read `Maskora Architecture.md`, the current step in `Maskora Implementation Plan.md`, and the working method in
`Obsidian/Projects/Coding project template/General Rules and Methods.md` before significant work. Do not create
repository copies of them.

## Keep architecture, plan, and code synchronized

Flag consequential choices for an ADR. Update the architecture for clarifications or extensions. Do not resolve
an open question (architecture §17) accidentally by adding a dependency, config file or stub.

## Project invariants

- **Source PDFs are read-only and stay local.** Opening, previewing, saving and exporting never rewrite a
  source, and the app never uploads a document or fetches a remote asset (§4.1, §11.1). Fonts, the PDF.js
  worker and its resources, and lighting environments are bundled.
- **Source facts, defaults, suggestions and overrides stay distinct.** Every extracted value carries its
  source revision, engine/version and origin; missing, unsupported, failed and not-yet-inspected are
  different states, and unknown never becomes zero or "no issues" (§4.2, §7.3).
- **One geometry model.** Source geometry stays in PDF user space with origin, rotation and UserUnit;
  physical controls use millimetres (`mm = pt × UserUnit × 25.4 / 72`); screen pixels are never
  authoritative alignment units (§4.3).
- **Finishes change material, not artwork.** Ordinary UV never recolours the artwork; selection and
  registration colours never reach a material or an export; every finish says whether it is implemented,
  approximate or unavailable (§4.4).
- **Async results belong to a revision.** A result for an older source or setting never replaces the current
  one (§4.5).
- **Native access is narrow.** Rust commands accept opaque source handles, never arbitrary paths; a file is
  readable only after the user selected it, and every command validates its input itself (§7.1, §11.2).
- **Next.js is a static export.** Nothing server-side of Next.js is used (route handlers, server actions,
  proxy, image optimisation). Code that needs `window`, WebGL, the PDF.js worker or the Tauri API runs only
  in client components, never during build-time prerender (§14.1).

## Do not cite vault ADR numbers in the repository

State the decision itself in code and comments; vault numbering must not become a code dependency. Stable
architecture section references (§4.3) are fine. `npm run check:conventions` enforces this.

## Commits belong to the maintainer

Do not commit or push unless explicitly asked. Stage the work and report.

## Work only the current plan step

Do not fill placeholder directories or build future capabilities ahead of the plan. Move genuine deferrals to
a named destination with links at both ends.

## Verification

Run `npm run check`. Every behaviour change ships a regression check. Static checks do not prove the desktop
app starts or renders: exercise the native window (`npm run smoke`, once it exists) and read its screenshots.

## Graphify

Query `graphify-out/` before broad source browsing (`graphify query "<question>"`). Run `graphify update .`
after changing code; `graphify-out/` is committed with the code.

## Next.js version

Next changes between majors. Read the installed docs in `node_modules/next/dist/docs/` before using an API.

## Repository-specific commands

- Setup: `npm run setup`
- Run: `npm run tauri dev`
- Check: `npm run check`
