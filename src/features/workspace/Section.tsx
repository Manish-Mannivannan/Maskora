"use client";

/**
 * A collapsible panel section. Its header stays visible while the section
 * scrolls past, and whether it is open is remembered on this machine. When
 * storage is unavailable the choice lasts for the session only.
 */
import { useSyncExternalStore, type ReactNode } from "react";

const key = (id: string) => `maskora.section.${id}`;
const memory = new Map<string, string>();
const listeners = new Set<() => void>();

function read(id: string): string | null {
  try {
    return localStorage.getItem(key(id)) ?? memory.get(id) ?? null;
  } catch {
    return memory.get(id) ?? null;
  }
}

function write(id: string, value: string) {
  memory.set(id, value);
  try {
    localStorage.setItem(key(id), value);
  } catch {
    /* kept in memory only */
  }
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function Section({
  id,
  title,
  summary,
  children,
}: {
  id: string;
  title: string;
  summary?: ReactNode;
  children: ReactNode;
}) {
  // The static export renders every section open; the remembered state applies on hydration.
  const saved = useSyncExternalStore(
    subscribe,
    () => read(id),
    () => null,
  );
  const open = saved !== "closed";

  return (
    <section className="panel-section" data-section={id} data-open={open}>
      <h2 className="section-header">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-body`}
          data-testid={`section-${id}`}
          onClick={() => write(id, open ? "closed" : "open")}
        >
          <span className="chevron" aria-hidden="true" />
          {title}
          {summary ? <span className="section-summary">{summary}</span> : null}
        </button>
      </h2>
      <div id={`${id}-body`} className="section-body" hidden={!open}>
        {children}
      </div>
    </section>
  );
}
