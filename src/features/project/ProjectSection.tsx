"use client";

/**
 * The project file (architecture §9.4, §11.2): new, open, save and save as,
 * whether there are unsaved changes, how the last file action ended, and the
 * state of each source a reopened project could not simply bring back. A
 * source is reopened silently only when this installation recorded the user
 * choosing that file and its content still matches; otherwise the user
 * locates or approves it here. Content that changed since the project was
 * saved is held until the user keeps it or chooses another file.
 */
import { useEffect, useState } from "react";
import { ReconcilePanel } from "./ReconcilePanel";
import { diagnostics } from "@/diagnostics/log";

/** The log as text, read when the panel is opened and refreshed on request. */
function DiagnosticsText() {
  const [text, setText] = useState("");
  const refresh = () =>
    setText(
      diagnostics()
        .map((e) => JSON.stringify(e))
        .join("\n"),
    );
  return (
    <>
      <button type="button" data-testid="diagnostics-refresh" onClick={refresh}>
        Show recent events
      </button>
      {text ? <textarea className="diagnostics-text" readOnly rows={8} value={text} /> : null}
    </>
  );
}
import { useProject } from "@/project/ProjectContext";
import type { FileState, Relink } from "@/project/store";

const WHAT = { save: "Save", open: "Open", locate: "Locate" } as const;

function lastText(last: FileState["last"]): string {
  switch (last.kind) {
    case "idle":
      return "";
    case "saving":
      return "Saving…";
    case "opening":
      return "Opening…";
    case "saved":
      return `${last.overwritten ? `Saved over ${last.name}.` : `Saved as ${last.name}.`}${last.backup ? ` The file was in an older format; the original is kept as ${last.backup}.` : ""}`;
    case "opened":
      return last.migratedFrom !== null
        ? `Opened ${last.name}, written in an older format (schema ${last.migratedFrom}). Saving upgrades it and keeps the original beside it.`
        : `Opened ${last.name}.`;
    case "recovered":
      return `Recovered unsaved work${last.name ? ` on ${last.name}` : ""}. It stays unsaved until you save it.`;
    case "cancelled":
      return `${WHAT[last.what]} cancelled; nothing changed.`;
    case "failed":
      return `${WHAT[last.what]} failed (${last.code}): ${last.message}${last.what === "save" ? " The project still has unsaved changes." : ""}`;
  }
}

function relinkText(r: Relink): string {
  switch (r.status) {
    case "loading":
      return "Loading…";
    case "missing":
      return "Not found where the project expects it.";
    case "needsApproval":
      return r.reason === "contentChanged"
        ? "This file differs from the one approved here. Choose it again to approve it."
        : "Not yet opened in Maskora on this computer. Choose it to approve it.";
    case "failed":
      return `Could not be opened: ${r.message ?? "unknown error"}`;
    case "changed":
      return "Its content changed since the project was saved. What the project assigns to its pages is held until you keep it, reconcile it page by page, or choose another file.";
    case "ok":
      return r.note === "moved"
        ? "Found at a new location."
        : r.note === "approved"
          ? "Approved."
          : r.note === "kept"
            ? "Kept with its new content."
            : r.note === "reconciled"
              ? "Reconciled page by page with its new content."
              : "Back.";
  }
}

export function ProjectSection() {
  const [state, store] = useProject();
  const { file, relink, lastRefusal } = state;
  // Both read the store's current state, which `state` above subscribes to.
  const dirty = store.isDirty();
  const [confirm, setConfirm] = useState<"new" | "open" | null>(null);
  const busy = file.last.kind === "saving" || file.last.kind === "opening";
  const saveProblem = store.saveProblem();
  const [reconciling, setReconciling] = useState<string | null>(null);

  // Ctrl+Z undoes and Ctrl+Y or Ctrl+Shift+Z redoes project edits, except while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (!(e.ctrlKey || e.metaKey) || t?.closest("input, textarea, select, [contenteditable]")) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) store.undo();
      else if (k === "y" || (k === "z" && e.shiftKey)) store.redo();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store]);

  const guarded = (action: "new" | "open") => {
    if (dirty && confirm !== action) {
      setConfirm(action);
      return;
    }
    setConfirm(null);
    if (action === "new") store.newProject();
    else void store.openProject();
  };

  const entries = Object.entries(relink);
  const offer = state.recoveryOffer;
  return (
    <>
      {offer ? (
        <div className="recovery" data-testid="recovery-offer" role="alert">
          <p>
            Unsaved work{offer.name ? ` on ${offer.name}` : ""} was left from{" "}
            {new Date(offer.savedUnix * 1000).toLocaleString()}, when Maskora last closed without saving.
          </p>
          <div className="row">
            <button type="button" data-testid="recovery-recover" onClick={() => void store.recover()}>
              Recover it
            </button>
            <button type="button" data-testid="recovery-discard" onClick={() => void store.discardRecovery()}>
              Discard it
            </button>
          </div>
        </div>
      ) : null}
      <p className="project-name" data-testid="project-name" data-dirty={dirty}>
        {file.name ?? "Unsaved project"}
        {dirty ? <span className="dirty"> · unsaved changes</span> : null}
      </p>
      <div className="row">
        <button type="button" data-testid="project-new" disabled={busy} onClick={() => guarded("new")}>
          New
        </button>
        <button type="button" data-testid="project-open" disabled={busy} onClick={() => guarded("open")}>
          Open…
        </button>
        <button
          type="button"
          data-testid="project-save"
          disabled={busy || !!saveProblem}
          title={saveProblem ?? undefined}
          onClick={() => void store.save(false)}
        >
          Save
        </button>
        <button
          type="button"
          data-testid="project-undo"
          disabled={!state.history.undo}
          title="Undo (Ctrl+Z)"
          onClick={() => store.undo()}
        >
          Undo
        </button>
        <button
          type="button"
          data-testid="project-redo"
          disabled={!state.history.redo}
          title="Redo (Ctrl+Y)"
          onClick={() => store.redo()}
        >
          Redo
        </button>
        <button
          type="button"
          data-testid="project-save-as"
          disabled={busy || !!saveProblem}
          title={saveProblem ?? undefined}
          onClick={() => void store.save(true)}
        >
          Save as…
        </button>
      </div>
      {confirm ? (
        <p className="warning" data-testid="project-confirm">
          Unsaved changes will be lost. Press {confirm === "new" ? "New" : "Open…"} again to continue, or{" "}
          <button type="button" className="link" onClick={() => setConfirm(null)}>
            keep working
          </button>
          .
        </p>
      ) : null}
      <p className="status" data-testid="project-status" data-kind={file.last.kind} role="status">
        {lastText(file.last)}
      </p>
      {entries.length ? (
        <ul className="relink" data-testid="relink-list">
          {entries.map(([id, r]) => (
            <li
              key={id}
              data-testid="relink"
              data-source={id}
              data-status={r.status}
              data-note={r.note ?? ""}
            >
              <strong>{r.saved.name}</strong>
              <span className="hint">{relinkText(r)}</span>
              <div className="row">
                {r.status === "missing" || r.status === "failed" ? (
                  <button
                    type="button"
                    data-testid="relink-locate"
                    onClick={() => void store.locateSource(id)}
                  >
                    Locate…
                  </button>
                ) : null}
                {r.status === "needsApproval" ? (
                  <button
                    type="button"
                    data-testid="relink-approve"
                    onClick={() => void store.locateSource(id)}
                  >
                    Approve…
                  </button>
                ) : null}
                {r.status === "changed" ? (
                  <>
                    <button type="button" data-testid="relink-keep" onClick={() => store.keepChanged(id)}>
                      Keep assignments
                    </button>
                    <button type="button" data-testid="relink-reconcile" onClick={() => setReconciling(id)}>
                      Reconcile pages…
                    </button>
                    <button
                      type="button"
                      data-testid="relink-other"
                      onClick={() => void store.locateSource(id)}
                    >
                      Choose another file…
                    </button>
                  </>
                ) : null}
                {r.status !== "ok" && r.status !== "loading" ? (
                  <button type="button" data-testid="relink-remove" onClick={() => store.removeSource(id)}>
                    Remove
                  </button>
                ) : null}
              </div>
              {reconciling === id && r.status === "changed" ? (
                <ReconcilePanel id={id} onDone={() => setReconciling(null)} />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {lastRefusal && ["pagesMissing", "pageOutOfRange", "pageTaken"].includes(lastRefusal.code) ? (
        <p className="warning" data-testid="relink-refusal">
          {lastRefusal.message}
        </p>
      ) : null}
      <details className="details" data-testid="diagnostics-panel">
        <summary>Diagnostics</summary>
        <p className="hint">
          What ran and how it ended, by source id, revision and coverage digest: no file names, paths or
          document content. Select and copy it to report a problem.
        </p>
        <DiagnosticsText />
      </details>
      <p className="hint">
        The project file records sources by name, location and content digest, never their content. Sources
        you chose on this computer reopen without asking while they are unchanged.
      </p>
    </>
  );
}
