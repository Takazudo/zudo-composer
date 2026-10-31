// The Node-only Content-AI providers a host selects. The CLI rows spawn the
// repository's fake CLI executables through the real restricted launcher:
// process-protocol evidence, never model inference.
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EditorialError } from "../../../src/content/editorial/types";
import { ProviderError, type ModelProvider } from "../../assistant/provider";
import { createContentAiProvider } from "../hosted-node";
import { createModelContentAiProposer } from "../model-proposer";
import { contentAiInference } from "../provider";

const fixtures = resolve("scripts/fixtures/assistant");
const fields = [{ key: "title", label: "Title", kind: "text", value: "Article B" }, { key: "body", label: "Body", kind: "markdown", value: "Body B" }];
const propose = (provider: Awaited<ReturnType<typeof createContentAiProvider>>) => provider.proposer.propose({ instruction: "shorter", fields, signal: new AbortController().signal });

describe("Content-AI providers for hosts", () => {
  it("selects the offline fake explicitly and reports it as ready without a model", async () => {
    const provider = await createContentAiProvider({ provider: "fake" });
    expect(provider.kind).toBe("fake");
    expect((await provider.inference()).state).toBe("ready");
    expect((await propose(provider)).kind).toBe("proposal");
  });

  it("refuses an unknown provider, extra fake settings and a command line as executable", async () => {
    await expect(createContentAiProvider({ provider: "anthropic" } as never)).rejects.toThrow(/must be/);
    await expect(createContentAiProvider({ provider: "fake", executable: "x" } as never)).rejects.toThrow(/no other settings/);
    await expect(createContentAiProvider({ provider: "claude-cli", executable: "claude --dangerously" })).rejects.toThrow(/executable/);
    await expect(createContentAiProvider({ provider: "codex-cli", timeoutMs: 1 })).rejects.toThrow(/timeoutMs/);
  });

  it.each([
    ["claude-cli", "fake-claude-cli.mjs"],
    ["codex-cli", "fake-codex-cli.mjs"],
  ] as const)("runs %s through the restricted CLI launcher and returns a title-only proposal", async (kind, file) => {
    const provider = await createContentAiProvider({ provider: kind, executable: join(fixtures, file), timeoutMs: 20_000 });
    const inference = await provider.inference();
    expect(inference.state).toBe("ready");
    expect(await propose(provider)).toEqual({ kind: "proposal", values: { title: "Article B (revised)" }, summary: "Fake CLI policy: appended (revised) to the title only." });
  }, 30_000);

  it("reports a missing CLI as unavailable and refuses to prepare, without a fallback", async () => {
    const provider = await createContentAiProvider({ provider: "claude-cli", executable: "/nonexistent/claude-for-content-ai" });
    expect(await provider.inference()).toMatchObject({ state: "unavailable", code: "not-installed" });
    const error = await propose(provider).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(EditorialError);
    expect((error as EditorialError).code).toBe("unavailable");
  });
});

describe("Content-AI inference status", () => {
  const identity = { provider: "claude-cli" as const, label: "Claude Code CLI", model: null, version: "2.1.310" };
  it("separates a passed local check, an unavailable provider and an undeterminable one", () => {
    expect(contentAiInference({ ok: true, ...identity })).toMatchObject({ state: "ready" });
    expect(contentAiInference({ ok: false, code: "not-logged-in", message: "Not signed in.", ...identity })).toEqual({ state: "unavailable", code: "not-logged-in", message: "Not signed in." });
    expect(contentAiInference({ ok: false, code: "probe-failed", message: "Could not check.", ...identity })).toEqual({ state: "unknown", message: "Could not check." });
  });
  it("never shows the local home directory", () => {
    expect(contentAiInference({ ok: false, code: "probe-failed", message: `Run ${homedir()}/bin/claude --version`, ...identity })).toEqual({ state: "unknown", message: "Run ~/bin/claude --version" });
  });
  it("turns a provider failure into an unavailable refusal without the home directory", async () => {
    const failing: ModelProvider = { status: () => ({ ok: true, ...identity }), turn: async () => { throw new ProviderError("timeout", `Timed out in ${homedir()}/work`, true); } };
    const error = await createModelContentAiProposer(failing, "Claude Code CLI").propose({ instruction: "x", fields, signal: new AbortController().signal }).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(EditorialError);
    expect((error as EditorialError).code).toBe("unavailable");
    expect((error as EditorialError).message).toContain("(timeout)");
    expect((error as EditorialError).message).not.toContain(homedir());
  });
});
