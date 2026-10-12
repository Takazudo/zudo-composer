import { describe, expect, it } from "vitest";
import { CONTENT_EXPORT_STATES, createFakeContentExportAdapter, validateContentExportSubmission } from "../export";

const submission = {
  snapshotId: "a".repeat(64),
  projectRevision: "b".repeat(64),
  baselineRevision: "0123abcd",
  packageIdentity: { packId: "@pinsel/ui", packVersion: "1.0.0", contractVersion: 2 },
  idempotencyKey: "submit-1",
};

describe("validateContentExportSubmission", () => {
  it("accepts the exact submission shape", () => {
    expect(validateContentExportSubmission(submission)).toEqual({ ok: true, value: submission });
  });

  it.each([
    ["a repository name", { repository: "Takazudo/yuko-site" }],
    ["a branch", { branch: "main" }],
    ["a path", { path: "content/entries/faq.json" }],
    ["a URL", { url: "https://github.com/x/y" }],
    ["a command", { command: "git push --force" }],
  ])("refuses a submission carrying %s", (_label, extra) => {
    expect(validateContentExportSubmission({ ...submission, ...extra }).ok).toBe(false);
  });

  it("refuses a submission missing a key", () => {
    const { idempotencyKey: _dropped, ...incomplete } = submission;
    void _dropped;
    expect(validateContentExportSubmission(incomplete).ok).toBe(false);
  });

  it.each([
    ["snapshotId", "not-a-digest"],
    ["projectRevision", "https://example.com"],
    ["baselineRevision", "refs/heads/main"],
    ["baselineRevision", "../../etc"],
    ["idempotencyKey", "a b"],
    ["packageIdentity", { packId: "../x", packVersion: "1", contractVersion: 2 }],
    ["packageIdentity", { packId: "@pinsel/ui", packVersion: "1.0.0", contractVersion: 0 }],
    ["packageIdentity", { packId: "@pinsel/ui", packVersion: "1.0.0", contractVersion: 2, repo: "x" }],
  ])("refuses an unsafe %s", (key, value) => {
    const result = validateContentExportSubmission({ ...submission, [key]: value });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.path?.startsWith(key)).toBe(true);
  });
});

describe("createFakeContentExportAdapter", () => {
  it("is deterministic, idempotent and never advances on its own", async () => {
    const clock = { value: 0 };
    const fake = createFakeContentExportAdapter({ now: () => `2026-10-12T00:00:0${clock.value++}.000Z` });
    const first = await fake.submit(submission);
    expect(first).toEqual({ status: "ok", value: { operationId: "export-0001", replayed: false } });
    expect(await fake.submit(submission)).toEqual({ status: "ok", value: { operationId: "export-0001", replayed: true } });
    expect(await fake.submit({ ...submission, snapshotId: "c".repeat(64) })).toEqual({ status: "conflict", operationId: "export-0001" });
    expect(await fake.submit({ ...submission, idempotencyKey: "submit-2" })).toEqual({ status: "ok", value: { operationId: "export-0002", replayed: false } });
    expect(fake.submissions.map(({ operationId }) => operationId)).toEqual(["export-0001", "export-0002"]);
    for (let index = 0; index < 5; index += 1) {
      expect(await fake.status("export-0001")).toMatchObject({ status: "ok", value: { state: "submitted", snapshotId: submission.snapshotId, baselineRevision: submission.baselineRevision } });
    }
    expect(await fake.status("export-9999")).toEqual({ status: "not-found" });
  });

  it("reports only the states and evidence a test attaches", async () => {
    const fake = createFakeContentExportAdapter({ now: () => "2026-10-12T00:00:00.000Z" });
    const submitted = await fake.submit(submission);
    if (submitted.status !== "ok") throw new Error("submit");
    const id = submitted.value.operationId;
    for (const state of ["building", "verified", "integrated"] as const) {
      fake.advance(id, state, state === "integrated" ? { evidence: { commit: "f".repeat(40), pr: "42", checks: [{ name: "build", status: "passed" }] } } : undefined);
      expect(await fake.status(id)).toMatchObject({ status: "ok", value: { state } });
    }
    const integrated = await fake.status(id);
    expect(integrated.status === "ok" && integrated.value.evidence?.commit).toBe("f".repeat(40));
    fake.advance(id, "failed", { message: "checks failed" });
    expect(await fake.status(id)).toMatchObject({ status: "ok", value: { state: "failed", message: "checks failed" } });
    expect(() => fake.advance("nope", "deployed")).toThrow(/Unknown export operation/);
    expect(CONTENT_EXPORT_STATES).toContain("deployed");
  });

  it("rejects an invalid submission without recording it", async () => {
    const fake = createFakeContentExportAdapter();
    expect(await fake.submit({ ...submission, baselineRevision: "https://x" })).toMatchObject({ status: "rejected", path: "baselineRevision" });
    expect(fake.submissions).toEqual([]);
  });
});
