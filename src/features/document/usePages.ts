"use client";

import { useMemo } from "react";
import { valueOf } from "@/project/capability";
import { summarizePage, type PageSummary } from "@/project/facts";
import { useProject } from "@/project/ProjectContext";

/** Every page of the open source, with both engines' facts and overrides combined. */
export function usePageSummaries(): PageSummary[] {
  const [{ source, overrides }] = useProject();
  return useMemo(() => {
    if (!source) return [];
    const pdf = valueOf(source.pages);
    const native = valueOf(source.geometry);
    const labels = valueOf(source.labels);
    return Array.from({ length: source.pageCount }, (_, i) =>
      summarizePage(i, pdf?.[i], native?.pages[i], labels?.[i] ?? null, overrides[i]),
    );
  }, [source, overrides]);
}
