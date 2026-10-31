/**
 * Typed access to the native project and export commands (architecture §7.1,
 * §9.4, §11.2).
 *
 * The frontend still never holds a path. A saved or opened project is named
 * by an opaque token; its sources come back as handles, already authorized
 * when this installation's own record of the user's earlier selection allows
 * it, and otherwise as a status asking the user to locate or approve them.
 * Every dialog is native and opened by Rust; `null` is a cancelled dialog.
 */
import { invoke } from "@tauri-apps/api/core";
import type { SourceInfo } from "./sources";

export interface SourceOnOpen {
  id: string;
  fileName: string;
  /** authorized: trusted and unchanged · changed: trusted, but not what the project saved · needsApproval · missing. */
  status: "authorized" | "changed" | "needsApproval" | "missing";
  /** needsApproval only: never selected here, or different from what was approved. */
  reason: "unfamiliar" | "contentChanged" | null;
  source: SourceInfo | null;
}

export interface Opened {
  token: string;
  name: string;
  json: string;
  sources: SourceOnOpen[];
}

export interface Saved {
  token: string;
  name: string;
  overwritten: boolean;
}

export interface Located {
  source: SourceInfo;
  sha256: string;
}

export interface Exported {
  name: string;
  overwritten: boolean;
  bytes: number;
}

export interface SaveRequest {
  json: string;
  sources: { id: string; handle: string }[];
  token: string | null;
  saveAs: boolean;
  suggestedName: string;
}

export function saveProject(request: SaveRequest): Promise<Saved | null> {
  return invoke<Saved | null>("save_project", { request });
}

/** Opens the native "Open project" dialog. */
export function openProject(): Promise<Opened | null> {
  return invoke<Opened | null>("open_project");
}

/** Asks the user to find (or confirm) one source, starting in the project's folder. */
export function locateSource(fileName: string, token: string | null): Promise<Located | null> {
  return invoke<Located | null>("locate_source", { fileName, token });
}

/** Sends the encoded PNG as the raw request body and asks where to save it. */
export function exportPng(png: Uint8Array, fileName: string): Promise<Exported | null> {
  // Header values must be ASCII; the dialog only uses the name as a suggestion.
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_");
  return invoke<Exported | null>("export_png", png, { headers: { "x-file-name": ascii } });
}
