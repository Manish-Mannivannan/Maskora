/**
 * The main thread's side of the relief worker: one worker for the window,
 * requests answered in order. A caller that has moved on simply ignores an
 * older answer (see `latestOnly`); the worker finishes it regardless.
 *
 * If the worker fails (it throws outside a request, or cannot start), every
 * pending request is rejected with that reason and the next request starts a
 * fresh worker, so one failure never leaves later builds waiting forever.
 */
import type { BoundedRelief, ReliefProfile } from "./reliefMesh";
import type { ReliefRequest } from "./relief.worker";

type Answer = { result?: BoundedRelief; data?: Uint8Array; ms: number };

let worker: Worker | null = null;
let next = 1;
const pending = new Map<number, { resolve: (v: Answer) => void; reject: (e: Error) => void }>();

/** How the worker is made; tests replace it. */
let create: () => Worker = () =>
  new Worker(new URL("./relief.worker.ts", import.meta.url), { type: "module" });

export function setReliefWorkerFactory(factory: () => Worker) {
  worker?.terminate();
  worker = null;
  create = factory;
}

function fail(message: string) {
  for (const job of pending.values()) job.reject(new Error(message));
  pending.clear();
  worker?.terminate();
  worker = null;
}

function instance(): Worker {
  if (!worker) {
    worker = create();
    worker.onmessage = (event) => {
      const { id, ok } = event.data as { id: number; ok: boolean };
      const job = pending.get(id);
      if (!job) return;
      pending.delete(id);
      if (ok) job.resolve(event.data as Answer);
      else job.reject(new Error((event.data as { message: string }).message));
    };
    worker.onerror = (event) => fail(event.message || "The relief worker failed.");
  }
  return worker;
}

function ask(
  kind: ReliefRequest["kind"],
  coverage: Uint8Array,
  width: number,
  height: number,
  pxPerMm: number,
  profile: ReliefProfile,
) {
  const id = next++;
  const copy = coverage.slice();
  return new Promise<Answer>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const request: ReliefRequest = { id, kind, coverage: copy, width, height, pxPerMm, profile };
    try {
      instance().postMessage(request, [copy.buffer]);
    } catch (error) {
      fail(String((error as Error)?.message ?? error));
    }
  });
}

/** Build a bounded coating mesh in the worker. `coverage` is copied, so the caller's map stays intact. */
export async function buildReliefOffThread(
  coverage: Uint8Array,
  width: number,
  height: number,
  pxPerMm: number,
  profile: ReliefProfile,
): Promise<{ result: BoundedRelief; ms: number }> {
  const a = await ask("mesh", coverage, width, height, pxPerMm, profile);
  return { result: a.result!, ms: a.ms };
}

/** Build the RGBA normal map of the same profile in the worker. */
export async function buildNormalsOffThread(
  coverage: Uint8Array,
  width: number,
  height: number,
  pxPerMm: number,
  profile: ReliefProfile,
): Promise<{ data: Uint8Array; ms: number }> {
  const a = await ask("normals", coverage, width, height, pxPerMm, profile);
  return { data: a.data!, ms: a.ms };
}
