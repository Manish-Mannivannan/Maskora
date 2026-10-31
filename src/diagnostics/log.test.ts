import { beforeEach, describe, expect, it } from "vitest";
import { clearDiagnostics, diagnostics, jobId, record } from "./log";

beforeEach(() => clearDiagnostics());

describe("diagnostics log", () => {
  it("keeps ids, numbers and codes, and redacts anything that is not a plain token", () => {
    record({ kind: "source", source: "1f0c-ab", revision: 3, pages: 5, outcome: "added" });
    record({
      kind: "file",
      action: "save",
      outcome: "failed",
      // A path or a sentence must never survive, even if a caller passes one by mistake.
      code: "C:\\Users\\manis\\secret art.pdf",
    });
    record({
      kind: "source",
      source: "s1",
      revision: 1,
      pages: 0,
      outcome: "failed",
      code: "hunter2 is the password",
    });
    const text = JSON.stringify(diagnostics());
    expect(diagnostics()[0]).toMatchObject({ kind: "source", source: "1f0c-ab", revision: 3, pages: 5 });
    expect(text).not.toMatch(/Users|secret|\.pdf|hunter2|password/);
    expect((diagnostics()[1] as { code?: string }).code).toBe("[redacted]");
  });

  it("holds the last 2,000 events", () => {
    for (let i = 0; i < 2120; i += 1) record({ kind: "graphics", state: i % 2 ? "lost" : "restored" });
    expect(diagnostics()).toHaveLength(2000);
  });

  it("names a job by a short stable hash, never by its key", () => {
    const key = JSON.stringify({ surface: "s", art: ["a", 1] });
    expect(jobId(key)).toMatch(/^fj-[0-9a-f]{8}$/);
    expect(jobId(key)).toBe(jobId(key));
    expect(jobId(key)).not.toBe(jobId(`${key} `));
  });
});
