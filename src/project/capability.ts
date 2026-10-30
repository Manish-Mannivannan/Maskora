/**
 * Inspection capability states (architecture §7.3, §4.2).
 *
 * Every extracted fact is one of these, never a bare value: "not requested"
 * (nobody asked yet), "running", "available" (with provenance), "absent" (the
 * file does not contain it), "unsupported" (it may exist, but this version
 * cannot read it) and "failed" (reading it went wrong). Unknown never becomes
 * zero or "nothing found".
 */
export interface Provenance {
  engine: string;
  /** The source revision the fact was read from (architecture §4.5). */
  sourceRevision: number;
}

export type Capability<T> =
  | { status: "notRequested" }
  | { status: "running" }
  | { status: "available"; value: T; provenance: Provenance }
  | { status: "absent"; provenance: Provenance }
  | { status: "unsupported"; reason: string }
  | { status: "failed"; code: string; message: string };

export const notRequested = { status: "notRequested" } as const;
export const running = { status: "running" } as const;

export const available = <T>(value: T, provenance: Provenance): Capability<T> => ({
  status: "available",
  value,
  provenance,
});

export const failed = (error: unknown, fallbackCode = "inspectionFailed"): Capability<never> => {
  const e = error as { code?: unknown; message?: unknown };
  return {
    status: "failed",
    code: typeof e?.code === "string" ? e.code : fallbackCode,
    message: typeof e?.message === "string" ? e.message : "The inspection did not complete.",
  };
};

export const valueOf = <T>(cap: Capability<T>): T | undefined =>
  cap.status === "available" ? cap.value : undefined;
