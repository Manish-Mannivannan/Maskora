import { describe, expect, it } from "vitest";
import { clearFinishJobs, finishJob, latestOnly } from "./jobs";
import type { RegistrationResult } from "./pipeline";

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
const result = (digest: string) => ({ digest }) as RegistrationResult;

describe("shared finish jobs", () => {
  it("gives every view asking for one key the same result object, and runs the job once", async () => {
    clearFinishJobs();
    let runs = 0;
    const run = async () => {
      runs += 1;
      return result("a");
    };
    const [overlay, material] = await Promise.all([finishJob("k", run), finishJob("k", run)]);
    expect(overlay).toBe(material);
    expect(runs).toBe(1);
  });

  it("keeps only a few results and forgets failed ones", async () => {
    clearFinishJobs();
    for (const k of ["a", "b", "c", "d"]) await finishJob(k, async () => result(k));
    let reran = false;
    await finishJob("a", async () => {
      reran = true;
      return result("a");
    });
    expect(reran).toBe(true);
    await finishJob("bad", () => Promise.reject(new Error("render failed"))).catch(() => undefined);
    let retried = false;
    await finishJob("bad", async () => {
      retried = true;
      return result("ok");
    });
    expect(retried).toBe(true);
  });

  it("a slow, older texture job settling after a newer one is never applied (delayed texture-job regression)", async () => {
    const latest = latestOnly<RegistrationResult>();
    const old = deferred<RegistrationResult>();
    const fresh = deferred<RegistrationResult>();
    const applied: string[] = [];
    const first = latest(old.promise).then((r) => r.current && applied.push(r.value.digest));
    const second = latest(fresh.promise).then((r) => r.current && applied.push(r.value.digest));
    fresh.resolve(result("new settings"));
    await second;
    old.resolve(result("old settings"));
    await first;
    expect(applied).toEqual(["new settings"]);
  });
});
