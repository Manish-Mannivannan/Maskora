/**
 * The main thread's side of the relief worker: one worker for the window,
 * requests answered in order. A caller that has moved on simply ignores an
 * older answer (see `latestOnly`); the worker finishes it regardless.
 */
import type { BoundedRelief, ReliefProfile } from "./reliefMesh";
import type { ReliefRequest } from "./relief.worker";

let worker: Worker | null = null;
let next = 1;
const pending = new Map<
  number,
  { resolve: (v: { result: BoundedRelief; ms: number }) => void; reject: (e: Error) => void }
>();

function instance(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./relief.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event) => {
      const { id, ok } = event.data as { id: number; ok: boolean };
      const job = pending.get(id);
      if (!job) return;
      pending.delete(id);
      if (ok) job.resolve(event.data as { result: BoundedRelief; ms: number });
      else job.reject(new Error((event.data as { message: string }).message));
    };
    worker.onerror = (event) => {
      for (const job of pending.values()) job.reject(new Error(event.message || "The relief worker failed."));
      pending.clear();
      worker = null;
    };
  }
  return worker;
}

/** Build a bounded coating mesh in the worker. `coverage` is copied, so the caller's map stays intact. */
export function buildReliefOffThread(
  coverage: Uint8Array,
  width: number,
  height: number,
  pxPerMm: number,
  profile: ReliefProfile,
): Promise<{ result: BoundedRelief; ms: number }> {
  const id = next++;
  const copy = coverage.slice();
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const request: ReliefRequest = { id, coverage: copy, width, height, pxPerMm, profile };
    instance().postMessage(request, [copy.buffer]);
  });
}
