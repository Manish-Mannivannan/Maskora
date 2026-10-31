import { afterEach, describe, expect, it } from "vitest";
import { heightProfile, normalMap } from "./height";
import { buildNormalsOffThread, buildReliefOffThread, setReliefWorkerFactory } from "./reliefWorker";
import type { ReliefRequest } from "./relief.worker";

const profile = { heightUm: 80, bevelMm: 0.3, crownUm: 0 };

/** A stand-in worker that answers like the real one, or fails on demand. */
class FakeWorker {
  static made = 0;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  terminated = false;
  constructor(private readonly behaviour: "answer" | "crash") {
    FakeWorker.made += 1;
  }
  postMessage(req: ReliefRequest) {
    queueMicrotask(() => {
      if (this.behaviour === "crash") {
        this.onerror?.({ message: "out of memory" } as ErrorEvent);
        return;
      }
      const data = normalMap(
        heightProfile(req.coverage, req.width, req.height, req.pxPerMm, req.profile),
        req.width,
        req.height,
        req.pxPerMm,
      );
      this.onmessage?.({ data: { id: req.id, ok: true, data, ms: 1 } } as MessageEvent);
    });
  }
  terminate() {
    this.terminated = true;
  }
}

const square = () => {
  const c = new Uint8Array(32 * 32);
  for (let y = 8; y < 24; y += 1) for (let x = 8; x < 24; x += 1) c[y * 32 + x] = 255;
  return c;
};

afterEach(() => setReliefWorkerFactory(() => new FakeWorker("answer") as unknown as Worker));

describe("relief worker client", () => {
  it("builds the same normal map off the main thread as on it, without touching the caller's coverage", async () => {
    setReliefWorkerFactory(() => new FakeWorker("answer") as unknown as Worker);
    const coverage = square();
    const { data } = await buildNormalsOffThread(coverage, 32, 32, 10, profile);
    expect(data).toEqual(normalMap(heightProfile(coverage, 32, 32, 10, profile), 32, 32, 10));
    expect(coverage[8 * 32 + 8]).toBe(255);
  });

  it("a failing worker rejects every waiting request with its reason, and the next request gets a new worker", async () => {
    let behaviour: "answer" | "crash" = "crash";
    FakeWorker.made = 0;
    setReliefWorkerFactory(() => new FakeWorker(behaviour) as unknown as Worker);
    const a = buildReliefOffThread(square(), 32, 32, 10, profile);
    const b = buildNormalsOffThread(square(), 32, 32, 10, profile);
    await expect(a).rejects.toThrow("out of memory");
    await expect(b).rejects.toThrow("out of memory");
    behaviour = "answer";
    await expect(buildNormalsOffThread(square(), 32, 32, 10, profile)).resolves.toMatchObject({ ms: 1 });
    expect(FakeWorker.made).toBe(2);
  });
});
