"use client";

/**
 * Provides one project instance to the panel. The store is created per
 * provider, not as a module global, so a workspace could hold several
 * projects side by side (architecture §2.4).
 */
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { inspectGeometry, readSource, selectSource } from "@/native/sources";
import { openSession } from "@/pdf/adapter";
import { ProjectStore, type ProjectDeps } from "./store";

const nativeDeps: ProjectDeps = {
  selectSource,
  readSource,
  inspectGeometry,
  openPdf: openSession,
  async digest(bytes) {
    const hash = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
    return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
  },
};

const ProjectContext = createContext<ProjectStore | null>(null);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => new ProjectStore(nativeDeps));
  useEffect(() => () => store.dispose(), [store]);
  return <ProjectContext.Provider value={store}>{children}</ProjectContext.Provider>;
}

export function useProject() {
  const store = useContext(ProjectContext);
  if (!store) throw new Error("useProject outside ProjectProvider");
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  return [state, store] as const;
}
