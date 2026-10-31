"use client";

/**
 * Page-by-page reconciliation of a source whose content changed since the
 * project was saved (architecture §9.4). Every page the project assigns
 * anything to is listed with what is on it and its trim size then; the user
 * picks its page in the new file or drops it, and decides per page whether a
 * manual box override carries over. Nothing is applied until the summary of
 * what will be dropped has been shown and confirmed.
 */
import { useState } from "react";
import { usePageSummaries } from "@/features/document/usePages";
import { sizeMm } from "@/pdf/transform";
import { remapSource, pageKey } from "@/project/model";
import { useProject } from "@/project/ProjectContext";

const fmt = (s: [number, number] | null) =>
  s ? `${s[0].toFixed(1)} × ${s[1].toFixed(1)} mm` : "size unknown";
const close = (a: [number, number] | null, b: [number, number] | null) =>
  !!a && !!b && Math.abs(a[0] - b[0]) < 0.1 && Math.abs(a[1] - b[1]) < 0.1;

export function ReconcilePanel({ id, onDone }: { id: string; onDone: () => void }) {
  const [state, store] = useProject();
  const summaries = usePageSummaries();
  // Read from the store's current state, which `state` above subscribes to.
  const rows = store.reconcilePlan(id) ?? [];
  const source = state.sources.find((s) => s.id === id);
  const newSize = (page: number): [number, number] | null => {
    const summary = summaries.get(pageKey({ sourceId: id, page }));
    const trim = summary?.boxes.find((b) => b.name === "TrimBox")?.effective;
    return summary && trim ? sizeMm(trim, summary.userUnit) : null;
  };
  const [mapping, setMapping] = useState<Record<number, number | null>>(() =>
    Object.fromEntries(rows.map((r) => [r.page, r.suggested])),
  );
  const [carry, setCarry] = useState<Set<number>>(
    () => new Set(rows.filter((r) => r.hasOverride && r.suggested !== null).map((r) => r.page)),
  );
  if (!source) return null;

  const preview = remapSource(state.model, id, (p) => mapping[p] ?? null, source.pageCount);
  const describe = (r: (typeof rows)[number]) =>
    [
      r.role !== "unassigned" ? (r.role === "print" ? "Print" : r.role === "mask" ? "Mask" : "Ignore") : null,
      r.layerIds.length ? `${r.layerIds.length} finish${r.layerIds.length > 1 ? "es" : ""}` : null,
      r.hasOverride ? "box override" : null,
    ]
      .filter(Boolean)
      .join(", ");

  return (
    <div className="reconcile" data-testid="reconcile">
      <p className="hint">
        {source.name} now has {source.pageCount} page{source.pageCount === 1 ? "" : "s"}. Choose where each
        page the project uses went. Pages are not matched by guesswork.
      </p>
      <ul className="reconcile-rows">
        {rows.map((r) => {
          const to = mapping[r.page] ?? null;
          const now = to === null ? null : newSize(to);
          const same = to !== null && close(r.savedSizeMm, now);
          return (
            <li key={r.page} data-testid="reconcile-row" data-page={r.page}>
              <span>
                <strong>Page {r.page + 1}</strong> · {describe(r) || "assigned"} · was {fmt(r.savedSizeMm)}
              </span>
              <label>
                Now
                <select
                  data-testid="reconcile-target"
                  value={to === null ? "" : String(to)}
                  onChange={(e) =>
                    setMapping((m) => ({
                      ...m,
                      [r.page]: e.target.value === "" ? null : Number(e.target.value),
                    }))
                  }
                >
                  <option value="">Drop what is on this page</option>
                  {Array.from({ length: source.pageCount }, (_, i) => (
                    <option key={i} value={i}>
                      Page {i + 1} ({fmt(newSize(i))})
                    </option>
                  ))}
                </select>
              </label>
              {to !== null && r.savedSizeMm && now && !same ? (
                <span className="warning" data-testid="reconcile-size">
                  Size changed: {fmt(r.savedSizeMm)} → {fmt(now)}
                </span>
              ) : null}
              {r.hasOverride && to !== null ? (
                <label className="check">
                  <input
                    type="checkbox"
                    data-testid="reconcile-carry"
                    checked={carry.has(r.page)}
                    onChange={(e) =>
                      setCarry((c) => {
                        const n = new Set(c);
                        if (e.target.checked) n.add(r.page);
                        else n.delete(r.page);
                        return n;
                      })
                    }
                  />
                  Carry the box override over (it was measured on the earlier page)
                </label>
              ) : null}
            </li>
          );
        })}
      </ul>
      {preview.ok ? (
        <p className="hint" data-testid="reconcile-effects">
          {preview.effects.droppedPages.length || preview.effects.removedLayers.length
            ? `Applying drops page${preview.effects.droppedPages.length === 1 ? "" : "s"} ${preview.effects.droppedPages.map((p) => p + 1).join(", ") || "none"}: ${preview.effects.droppedSurfaces.length} printed page${preview.effects.droppedSurfaces.length === 1 ? "" : "s"} and ${preview.effects.removedLayers.length} finish layer${preview.effects.removedLayers.length === 1 ? "" : "s"} go${preview.effects.untargetedLayers.length ? `, and ${preview.effects.untargetedLayers.length} layer${preview.effects.untargetedLayers.length === 1 ? " loses its" : "s lose their"} printed page` : ""}.`
            : "Every assignment moves to the page chosen; nothing is dropped."}
        </p>
      ) : (
        <p className="warning" data-testid="reconcile-problem">
          {preview.message}
        </p>
      )}
      <div className="row">
        <button
          type="button"
          data-testid="reconcile-apply"
          disabled={!preview.ok}
          onClick={() => {
            if (store.reconcile(id, mapping, [...carry])) onDone();
          }}
        >
          Apply
        </button>
        <button type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}
