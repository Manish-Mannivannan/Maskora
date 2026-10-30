/**
 * Typed access to the native source commands (architecture §7.1, §10.1).
 *
 * The frontend never holds a path: `selectSource` asks Rust to open the
 * native dialog and returns an opaque handle, and `readSource` exchanges a
 * handle for bytes. A refusal arrives as a `SourceError` with a stable code.
 */
import { invoke } from "@tauri-apps/api/core";

export interface SourceInfo {
  handle: string;
  name: string;
  size: number;
}

export interface SourceError {
  code: string;
  message: string;
}

export function isSourceError(value: unknown): value is SourceError {
  return typeof value === "object" && value !== null && "code" in value && "message" in value;
}

/** Opens the native "Open PDF" dialog. Resolves `null` when the user cancels. */
export function selectSource(): Promise<SourceInfo | null> {
  return invoke<SourceInfo | null>("select_source");
}

/** The bytes of a source this session was handed by `selectSource`. */
export async function readSource(handle: string): Promise<Uint8Array> {
  const data = await invoke<ArrayBuffer>("read_source", { handle });
  return new Uint8Array(data);
}

export type FactOrigin = "explicit" | "inherited" | "default" | "invalid";

export interface BoxFact {
  raw: number[] | null;
  effective: [number, number, number, number];
  origin: FactOrigin;
  adjustments?: ("normalized" | "clipped")[];
}

export interface PageGeometry {
  index: number;
  rotate: { raw: number | null; effective: number | null; origin: FactOrigin };
  userUnit: number;
  boxes: [string, BoxFact][];
}

export interface GeometryReport {
  /** The native reader and its version. */
  engine: string;
  /** SHA-256 of the exact bytes the native reader parsed. */
  sha256: string;
  pages: PageGeometry[];
}

/**
 * The five page boxes of every page, with provenance, read natively from the
 * page dictionaries. The password is used for this call only.
 */
export function inspectGeometry(handle: string, password?: string): Promise<GeometryReport> {
  return invoke<GeometryReport>("inspect_geometry", { handle, password: password ?? null });
}
