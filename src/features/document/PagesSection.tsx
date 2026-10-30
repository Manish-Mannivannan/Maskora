"use client";

/**
 * Page thumbnails, rendered progressively: only when scrolled into view, at
 * most a few at a time, and cancelled when their source is replaced. Each
 * shows its label, index, physical trim size and rotation.
 */
import { useEffect, useRef, useState } from "react";
import { ARTWORK_POLICY } from "@/pdf/transform";
import type { PageSummary } from "@/project/facts";
import { useProject } from "@/project/ProjectContext";
import { noSizeText, sizeText } from "./format";
import { usePageSummaries } from "./usePages";

type ThumbState = "waiting" | "rendering" | "rendered" | "failed";

function Thumbnail({
  page,
  root,
  revision,
  count,
  noSize,
}: {
  page: PageSummary;
  root: Element | null;
  revision: number;
  count: number;
  noSize: string;
}) {
  const [{ selectedPage }, store] = useProject();
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
    const session = store.session(revision);
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
  }, [visible, revision, rotation, page.index, store]);

  const selected = selectedPage === page.index;
  return (
    <li>
      <button
        type="button"
        className="thumb"
        data-testid="thumb"
        data-index={page.index}
        data-state={state}
        aria-pressed={selected}
        onClick={() => store.selectPage(page.index)}
      >
        <span className="thumb-frame">
          <canvas ref={canvas} aria-hidden="true" />
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

export function PagesSection() {
  const [{ source }] = useProject();
  const pages = usePageSummaries();
  const [root, setRoot] = useState<HTMLUListElement | null>(null);
  if (!source) return <p className="hint">Open a PDF to see its pages.</p>;
  return (
    <>
      <p className="hint">
        Labels:{" "}
        {source.labels.status === "available"
          ? "from the file"
          : source.labels.status === "absent"
            ? "none in the file"
            : "reading…"}
        . Size is the trim size.
      </p>
      <ul className="thumbs" ref={setRoot} data-testid="thumbs" key={source.revision}>
        {pages.map((page) => (
          <Thumbnail
            key={page.index}
            page={page}
            root={root}
            revision={source.revision}
            count={source.pageCount}
            noSize={noSizeText(source.geometry)}
          />
        ))}
      </ul>
    </>
  );
}
