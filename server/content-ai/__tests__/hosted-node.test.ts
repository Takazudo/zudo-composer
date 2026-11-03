// The Node-only Content-AI providers a host selects. The CLI rows spawn the
// repository's fake CLI executables through the real restricted launcher:
// process-protocol evidence, never model inference.
import { homedir, tmpdir } from "node:os";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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

  it("preserves explicitly selected Codex model, effort and service tier without importing user settings", async () => {
    const directory = await mkdtemp(join(tmpdir(), "content-ai-config-"));
    try {
      const record = join(directory, "argv.json");
      const provider = await createContentAiProvider({ provider: "codex-cli", executable: join(fixtures, "fake-codex-cli.mjs"), model: "gpt-6-astra", effort: "medium", serviceTier: "default" }, { env: { ...process.env, FAKE_CODEX_RECORD: record } });
      expect((await propose(provider)).kind).toBe("proposal");
      const { argv } = JSON.parse(await readFile(record, "utf8")) as { argv: string[] };
      expect(argv.slice(argv.indexOf("-m"), argv.indexOf("-m") + 2)).toEqual(["-m", "gpt-6-astra"]);
      expect(argv).toEqual(expect.arrayContaining(['model_reasoning_effort="medium"', 'service_tier="default"', "--ignore-user-config", "--strict-config", "--sandbox", "read-only"]));
      expect(argv.filter(value => value.startsWith("service_tier="))).toHaveLength(1);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("preserves explicitly selected Claude model and effort while retaining settings isolation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "content-ai-config-"));
    try {
      const record = join(directory, "argv.json");
      const provider = await createContentAiProvider({ provider: "claude-cli", executable: join(fixtures, "fake-claude-cli.mjs"), model: "opus", effort: "medium" }, { env: { ...process.env, FAKE_CLAUDE_RECORD: record } });
      expect((await propose(provider)).kind).toBe("proposal");
      const { argv } = JSON.parse(await readFile(record, "utf8")) as { argv: string[] };
      expect(argv.slice(argv.indexOf("--model"), argv.indexOf("--model") + 2)).toEqual(["--model", "opus"]);
      expect(argv.slice(argv.indexOf("--effort"), argv.indexOf("--effort") + 2)).toEqual(["--effort", "medium"]);
      expect(argv.slice(argv.indexOf("--setting-sources"), argv.indexOf("--setting-sources") + 2)).toEqual(["--setting-sources", ""]);
      expect(argv).toEqual(expect.arrayContaining(["--safe-mode", "--restricted", "--strict-mcp-config"]));
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("refuses tier overrides for Claude and malformed Codex tier tokens before spawning", async () => {
    await expect(createContentAiProvider({ provider: "claude-cli", serviceTier: "default" } as never)).rejects.toThrow(/serviceTier is not supported/);
    for (const serviceTier of ["", "fast\nmodel=other", 'default"', "x".repeat(65), 42]) {
      await expect(createContentAiProvider({ provider: "codex-cli", serviceTier } as never)).rejects.toThrow(/serviceTier/);
    }
  });

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
