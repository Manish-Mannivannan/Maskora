/**
 * Shared finish jobs (architecture §4.5, §7.4).
 *
 * The registration overlay and the 3D material ask for a surface's finish
 * maps through here. One key, built from everything the result depends on,
 * names one job, so both views receive the very same result object, at the
 * same resolution, and cannot disagree about coverage. A consumer applies
 * only its latest request; a slower, older job finishing later is ignored.
 */
import type { RegistrationResult } from "./pipeline";

/** Longest side of the shared finish raster: one resolution for overlay and material. */
export const FINISH_RESOLUTION = 2048;

/** Few entries: each holds an artwork canvas and two coverage planes. */
const CAPACITY = 3;
const cache = new Map<string, Promise<RegistrationResult>>();

/** The job for `key`, started with `run` only if no equal job exists. */
export function finishJob(key: string, run: () => Promise<RegistrationResult>): Promise<RegistrationResult> {
  const existing = cache.get(key);
  if (existing) {
    // Most recently used goes last.
    cache.delete(key);
    cache.set(key, existing);
    return existing;
  }
  const job = run();
  cache.set(key, job);
  job.catch(() => cache.delete(key));
  while (cache.size > CAPACITY) cache.delete(cache.keys().next().value!);
  return job;
}

export function clearFinishJobs() {
  cache.clear();
}

/**
 * Wrap requests so only the most recent one counts: an earlier request that
 * settles after a later one resolves as `{ current: false }`.
 */
export function latestOnly<T>() {
  let latest = 0;
  return (request: Promise<T>): Promise<{ current: true; value: T } | { current: false }> => {
    const mine = ++latest;
    return request.then(
      (value) => (mine === latest ? { current: true as const, value } : { current: false as const }),
      (error) => {
        if (mine === latest) throw error;
        return { current: false as const };
      },
    );
  };
}
