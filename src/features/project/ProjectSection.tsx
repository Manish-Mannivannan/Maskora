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
import { useState } from "react";
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
      return last.overwritten ? `Saved over ${last.name}.` : `Saved as ${last.name}.`;
    case "opened":
      return `Opened ${last.name}.`;
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
      return "Its content changed since the project was saved. Its pages' assignments are held until you keep them or choose another file.";
    case "ok":
      return r.note === "moved"
        ? "Found at a new location."
        : r.note === "approved"
          ? "Approved."
          : r.note === "kept"
            ? "Kept with its new content."
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
  return (
    <>
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
            </li>
          ))}
        </ul>
      ) : null}
      {lastRefusal?.code === "pagesMissing" ? (
        <p className="warning" data-testid="relink-refusal">
          {lastRefusal.message}
        </p>
      ) : null}
      <p className="hint">
        The project file records sources by name, location and content digest, never their content. Sources
        you chose on this computer reopen without asking while they are unchanged.
      </p>
    </>
  );
}
