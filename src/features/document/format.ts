/** Display wording for document facts. Provenance words are fixed so every view says the same thing. */
import type { Capability } from "@/project/capability";
import type { BoxRow } from "@/project/facts";

export const ORIGIN_TEXT: Record<BoxRow["origin"], string> = {
  explicit: "stated on the page",
  inherited: "inherited from the page tree",
  default: "format default",
  invalid: "invalid in the file; default used",
  override: "manual override",
  unknown: "not read yet",
};

/** Size text when no trim size is known: pending while boxes are read, unknown once reading failed. */
export const noSizeText = (geometry: Capability<unknown>) =>
  geometry.status === "failed" ? "size unknown (page boxes not read)" : "size: reading…";

export const mm = (v: number) => `${v.toFixed(1)}`;

export const sizeText = ([w, h]: [number, number]) => `${mm(w)} × ${mm(h)} mm`;

export function bytesText(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
