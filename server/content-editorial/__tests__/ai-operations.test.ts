import { describe, expect, it, vi } from "vitest";
import type { ContentAiService } from "../../../src/content/editorial/ai";
import { runContentAiOperation, type ContentAiStatus } from "../../../src/content/editorial/ai-operations";
import { EditorialError } from "../../../src/content/editorial/types";

const entry = { providerId: "articles", modelId: "article", recordId: "welcome" };
function host(overrides: Partial<ContentAiService> = {}) {
  const service = {
    scope: vi.fn(async () => []), prepare: vi.fn(async () => ({ status: "refused" as const, message: "no" })),
    read: vi.fn(async () => { throw new EditorialError("not-found", "missing"); }),
    apply: vi.fn(async () => ({ receipt: { operationKey: "k", entry, revisionId: "r", expected: "e" }, recovered: true })),
    undo: vi.fn(), ...overrides,
  } as unknown as ContentAiService;
  const status: ContentAiStatus = { configured: true, provider: "Fake", canApply: true, inference: { state: "ready", detail: "ok" } };
  return { service, wire: { status: async () => status, service: async () => service } };
}

describe("Content-AI wire", () => {
  it("passes only the documented request fields to the service", async () => {
    const { service, wire } = host();
    expect(await runContentAiOperation(wire, "content-ai-prepare", { entry, instruction: "x" })).toEqual({ ok: true, value: { status: "refused", message: "no" } });
    expect(service.prepare).toHaveBeenCalledWith({ entry, instruction: "x" });
    expect(await runContentAiOperation(wire, "content-ai-apply", { proposalId: "p" })).toMatchObject({ ok: true, value: { recovered: true } });
    expect(service.apply).toHaveBeenCalledWith({ proposalId: "p" });
  });

  it("refuses an actor, a source, values, a path or a malformed Entry in the request", async () => {
    const { service, wire } = host();
    for (const payload of [
      { entry, instruction: "x", actor: { id: "admin" } },
      { entry, instruction: "x", values: { author: "y" } },
      { entry: { ...entry, path: "/etc/passwd" }, instruction: "x" },
      { entry: { ...entry, recordId: 3 }, instruction: "x" },
      { entry, instruction: 7 },
      null,
    ]) expect(await runContentAiOperation(wire, "content-ai-prepare", payload)).toMatchObject({ ok: false, error: { code: "invalid-request" } });
    expect(await runContentAiOperation(wire, "content-ai-apply", { proposalId: "p", source: "content-ai" })).toMatchObject({ ok: false, error: { code: "invalid-request" } });
    expect(await runContentAiOperation(wire, "content-ai-delete", {})).toMatchObject({ ok: false, error: { code: "invalid-request" } });
    expect(service.prepare).not.toHaveBeenCalled();
  });

  it("answers status without building a service and reports editorial refusals as wire errors", async () => {
    const { wire } = host();
    const built = vi.spyOn(wire, "service");
    expect(await runContentAiOperation(wire, "content-ai-status", {})).toMatchObject({ ok: true, value: { configured: true } });
    expect(built).not.toHaveBeenCalled();
    expect(await runContentAiOperation(wire, "content-ai-read", { proposalId: "p" })).toEqual({ ok: false, error: { code: "not-found", message: "missing", diagnostics: [] } });
  });

  it("rethrows a host fault instead of disguising it", async () => {
    const { wire } = host({ read: vi.fn(async () => { throw new Error("disk on fire"); }) } as never);
    await expect(runContentAiOperation(wire, "content-ai-read", { proposalId: "p" })).rejects.toThrow("disk on fire");
  });
});
