"use client";

import { useMemo } from "react";
import { valueOf } from "@/project/capability";
import { summarizePage, type PageSummary } from "@/project/facts";
import { pageKey, type PageRef } from "@/project/model";
import { useProject } from "@/project/ProjectContext";
import type { SourceView } from "@/project/store";

/** Every page of every source, with both engines' facts and overrides combined, keyed by `pageKey`. */
export function usePageSummaries(): Map<string, PageSummary> {
  const [{ sources, overrides }] = useProject();
  return useMemo(() => {
    const out = new Map<string, PageSummary>();
    for (const source of sources) {
      const pdf = valueOf(source.pages);
      const native = valueOf(source.geometry);
      const labels = valueOf(source.labels);
      for (let i = 0; i < source.pageCount; i += 1) {
        const ref = { sourceId: source.id, page: i };
        out.set(
          pageKey(ref),
          summarizePage(i, pdf?.[i], native?.pages[i], labels?.[i] ?? null, overrides[pageKey(ref)]),
        );
      }
    }
    return out;
  }, [sources, overrides]);
}

/** "masks.pdf p. 2 (ii)": the file is always named, so assignments across files stay unambiguous. */
export function pageName(sources: SourceView[], summaries: Map<string, PageSummary>, ref: PageRef): string {
  const source = sources.find((s) => s.id === ref.sourceId);
  if (!source) return `missing file, p. ${ref.page + 1}`;
  const label = summaries.get(pageKey(ref))?.label;
  return `${source.name} p. ${ref.page + 1}${label && label !== String(ref.page + 1) ? ` (${label})` : ""}`;
}
