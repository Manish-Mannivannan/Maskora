/**
 * Job diagnostics (architecture §13): what ran, on which source revision,
 * how long it took and how it ended, so an export can be traced back to the
 * finish jobs and source revisions it was made from.
 *
 * Only identifiers, numbers and stable codes are kept: source ids and
 * revisions, coverage digests, finish-job ids, sizes, durations, outcome
 * codes. Never a file name, a path, a message text, document content or a
 * password. Every value is checked on the way in, and anything that is not a
 * plain token is replaced by "[redacted]", so a mistake elsewhere cannot leak
 * into the log. The log lives in memory, holds the last 2,000 events, and is
 * readable from the Project panel.
 */

export type DiagnosticEvent =
  | {
      kind: "source";
      source: string;
      revision: number;
      pages: number;
      outcome: "added" | "failed" | "password";
      code?: string;
    }
  | {
      kind: "finish";
      job: string;
      surface: string;
      revisions: number[];
      digest: string;
      ms: number;
      outcome: "ready" | "failed";
      code?: string;
    }
  | {
      kind: "relief";
      face: string;
      digest: string;
      mode: "mesh" | "normals";
      ms: number;
      triangles: number;
      outcome: "built" | "fallback" | "failed";
    }
  | {
      kind: "export";
      export: number;
      digests: string[];
      revisions: number[];
      size: [number, number];
      outcome: string;
      code?: string;
    }
  | { kind: "file"; action: "save" | "open" | "recover" | "locate"; outcome: string; code?: string }
  | { kind: "graphics"; state: "lost" | "restored" };

export type LoggedEvent = DiagnosticEvent & { at: string };

const LIMIT = 2000;
const events: LoggedEvent[] = [];

/** A plain token: ids, digests and codes look like this; names, paths and sentences do not. */
const TOKEN = /^[A-Za-z0-9_.:x+-]{1,80}$/;

function clean(value: unknown): unknown {
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
  if (typeof value === "string") return TOKEN.test(value) ? value : "[redacted]";
  if (Array.isArray(value)) return value.slice(0, 20).map(clean);
  return "[redacted]";
}

export function record(event: DiagnosticEvent) {
  const entry: Record<string, unknown> = { at: new Date().toISOString() };
  for (const [key, value] of Object.entries(event)) entry[key] = key === "kind" ? value : clean(value);
  events.push(entry as LoggedEvent);
  if (events.length > LIMIT) events.splice(0, events.length - LIMIT);
}

/** The events, oldest first. */
export function diagnostics(): LoggedEvent[] {
  return events.slice();
}

export function clearDiagnostics() {
  events.length = 0;
}

/** A short, stable id for a job key (FNV-1a), so a key that may hold settings is never logged itself. */
export function jobId(key: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `fj-${(h >>> 0).toString(16).padStart(8, "0")}`;
}
