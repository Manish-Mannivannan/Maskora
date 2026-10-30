"use client";

/**
 * Page thumbnails of every source, grouped by file and rendered
 * progressively: only when scrolled into view, at most a few at a time, and
 * cancelled when their source leaves the project. Each shows its label,
 * index, role, physical trim size and rotation.
 */
import { useEffect, useRef, useState } from "react";
import { ARTWORK_POLICY } from "@/pdf/transform";
import type { PageSummary } from "@/project/facts";
import { pageKey, roleOf, type PageRole } from "@/project/model";
import type { SourceView } from "@/project/store";
import { useProject } from "@/project/ProjectContext";
import { noSizeText, sizeText } from "./format";
import { usePageSummaries } from "./usePages";

type ThumbState = "waiting" | "rendering" | "rendered" | "failed";

const ROLE_BADGE: Record<PageRole, string> = {
  unassigned: "",
  print: "Print",
  mask: "Mask",
  ignore: "Ignore",
};

function Thumbnail({
  page,
  root,
  source,
  noSize,
}: {
  page: PageSummary;
  root: Element | null;
  source: SourceView;
  noSize: string;
}) {
  const [{ selected: sel, model }, store] = useProject();
  const { revision, pageCount: count } = source;
  const ref = { sourceId: source.id, page: page.index };
  const role = roleOf(model, ref);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [state, setState] = useState<ThumbState>("waiting");
  const rotation = page.rotation.displayed;
  const done = useRef("");

  useEffect(() => {
    const el = canvas.current?.parentElement;
    if (!el || !root) return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      root,
      rootMargin: "120px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [root]);

  useEffect(() => {
    const session = store.session(source.id, revision);
    const key = `${revision}:${rotation}`;
    if (!visible || !session || !canvas.current || done.current === key) return;
    const abort = new AbortController();
    setState("rendering");
    session
      .render(page.index, { rotation, purpose: "thumbnail", policy: ARTWORK_POLICY }, canvas.current, {
        signal: abort.signal,
      })
      .then(
        () => {
          if (abort.signal.aborted) return;
          done.current = key;
          setState("rendered");
        },
        () => !abort.signal.aborted && setState("failed"),
      );
    return () => abort.abort();
    // Rendered once per revision and rotation; scrolling away cancels unfinished work.
  }, [visible, revision, rotation, page.index, store, source.id]);

  const selected = sel?.sourceId === source.id && sel.page === page.index;
  return (
    <li>
      <button
        type="button"
        className="thumb"
        data-testid="thumb"
        data-index={page.index}
        data-source={source.name}
        data-state={state}
        data-role={role}
        aria-pressed={selected}
        onClick={() => store.selectPage(ref)}
      >
        <span className="thumb-frame">
          <canvas ref={canvas} aria-hidden="true" />
          {role !== "unassigned" ? (
            <span className="role-badge" data-role={role}>
              {ROLE_BADGE[role]}
            </span>
          ) : null}
        </span>
        <span className="thumb-label" data-testid="thumb-label">
          {page.label ?? "—"}{" "}
          <span className="muted">
            · p. {page.index + 1}/{count}
          </span>
        </span>
        <span className="thumb-size muted">
          {page.trimMm ? sizeText(page.trimMm) : noSize}
          {page.rotation.invalid ? " · rotation invalid" : rotation ? ` · ${rotation}°` : ""}
        </span>
      </button>
    </li>
  );
}

function SourcePages({ source, summaries }: { source: SourceView; summaries: Map<string, PageSummary> }) {
  const [root, setRoot] = useState<HTMLUListElement | null>(null);
  const pages = Array.from({ length: source.pageCount }, (_, i) =>
    summaries.get(pageKey({ sourceId: source.id, page: i }))!,
  );
  return (
    <div className="source-pages" data-testid="source-pages" data-name={source.name}>
      <p className="hint">
        <strong>{source.name}</strong> · labels:{" "}
        {source.labels.status === "available"
          ? "from the file"
          : source.labels.status === "absent"
            ? "none in the file"
            : "reading…"}
      </p>
      <ul className="thumbs" ref={setRoot} data-testid="thumbs" key={source.revision}>
        {pages.map((page) => (
          <Thumbnail
            key={page.index}
            page={page}
            root={root}
            source={source}
            noSize={noSizeText(source.geometry)}
          />
        ))}
      </ul>
    </div>
  );
}

export function PagesSection() {
  const [{ sources }] = useProject();
  const summaries = usePageSummaries();
  if (!sources.length) return <p className="hint">Add a PDF to see its pages.</p>;
  return (
    <>
      <p className="hint">Size is the trim size. Select a page to give it a role.</p>
      {sources.map((source) => (
        <SourcePages key={source.id} source={source} summaries={summaries} />
      ))}
    </>
  );
}
