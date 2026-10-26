// Shared editing contract for every provider path. The same deterministic
// policy (fake-decide.mjs) answers in-process (provider "fake") and through
// fake CLI executables that are really spawned (providers "claude-cli" and
// "codex-cli"). This is fake-provider and process-protocol evidence, never
// model inference.
import { afterEach, describe, expect, it } from "vitest";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadHostContext } from "../../host-context.mjs";
import { initializeAuthoringWorkspace } from "../../edit/initialize-workspace";
import { createEditingService } from "../../edit/service";
import { captureHost } from "../../edit/inspect";
import { defineSite, node } from "../../../src/site-project/authoring";
import { createFilesystemAssetStore } from "../../../src/assets/storage/filesystem/store";
import { openAssistantStore } from "../store";
import { createAssistantRunner } from "../runner";
import { parseAssistant, type AssistantConfig } from "../../config/assistant";
import { createModelProvider } from "../provider-factory";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

const fixtures = resolve("scripts/fixtures/assistant");
const providers: { name: string; config: Record<string, unknown> }[] = [
  { name: "fake (in-process)", config: { provider: "fake" } },
  { name: "claude-cli (fake executable)", config: { provider: "claude-cli", executable: join(fixtures, "fake-claude-cli.mjs"), timeoutMs: 20_000 } },
  { name: "codex-cli (fake executable)", config: { provider: "codex-cli", executable: join(fixtures, "fake-codex-cli.mjs"), timeoutMs: 20_000 } },
];

async function host(assistant: AssistantConfig) {
  const root = await mkdtemp(join(tmpdir(), "assistant-contract-")); roots.push(root);
  await cp(resolve("fixtures/edit-host"), root, { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "native-edit-host", version: "1.0.0", type: "module", exports: { "./components": "./components/pack.mjs" }, dependencies: { preact: "10.27.2", "@zudo-composer/component-contract": "workspace:*" } }));
  await mkdir(join(root, "node_modules/@zudo-composer"), { recursive: true });
  await symlink(resolve("."), join(root, "node_modules/zudo-composer"), "dir");
  await symlink(resolve("node_modules/preact"), join(root, "node_modules/preact"), "dir");
  await symlink(resolve("node_modules/@zudo-composer/component-contract"), join(root, "node_modules/@zudo-composer/component-contract"), "dir");
  const context = await loadHostContext({ workspaceRoot: root });
  const options = { config: context.composerConfig, pack: context.pack, packIdentity: context.packIdentity };
  const site = defineSite({ id: "contract-proof", name: "Contract Proof", componentPack: context.pack });
  const home = site.page({ id: "home", name: "Home", root: [node("native.paragraph", { text: "Welcome to the Old shop." }, {}, "paragraph"), node("native.list", { items: ["Old one", "Two"] }, {}, "list")] });
  const other = site.page({ id: "other", name: "Other", root: [node("native.paragraph", { text: "Old news here." }, {}, "paragraph")] });
  site.sitemap({ id: "main", name: "Main", root: { id: "home", title: "Home", page: home, children: [{ id: "other", title: "Other", page: other }] } });
  await initializeAuthoringWorkspace({ composerConfig: context.composerConfig, pack: context.pack, project: site.toSiteProject(), workspaceId: "proof" });
  await createFilesystemAssetStore({ assetsStoreRoot: context.composerConfig.paths.assets });
  const open = async () => {
    const service = createEditingService(options);
    const store = await openAssistantStore(context.composerConfig.paths.data);
    const runner = createAssistantRunner({ store, service, provider: createModelProvider(assistant), config: assistant, lease: { execute: action => action() }, capture: () => captureHost(options), siteName: capture => capture.workspace.metadata.name });
    return { service, store, runner };
  };
  const composition = (id: string) => join(context.composerConfig.paths.compositions, "workspace-v1-proof", `composition-${id}.composition.json`);
  const props = async (id: string) => Object.fromEntries((JSON.parse(await readFile(composition(id), "utf8")).document.root as { id: string; props: Record<string, unknown> }[]).map(entry => [entry.id, entry.props]));
  return { open, props, scope: { host: await realpath(root), workspaceId: "proof" } };
}

const pageContext = { page: { sitemapId: "main", pageId: "home", title: "Home" }, selection: null, payloadIds: [] };
async function ask(runner: ReturnType<typeof createAssistantRunner>, conversationId: string, text: string) {
  const started = await runner.start("proof", { conversationId, clientTurnId: crypto.randomUUID(), text, context: pageContext });
  await runner.settled(started.runId);
  return runner.run("proof", started.runId);
}

describe.each(providers)("editing contract via $name", ({ config }) => {
  it("proposes multi-page edits, applies them with a receipt, retries idempotently and undoes, leaving everything else unchanged", async () => {
    const assistant = parseAssistant(config)!;
    const site = await host(assistant);
    const { service, store, runner } = await site.open();
    expect(await createModelProvider(assistant).status()).toMatchObject({ ok: true, provider: assistant.provider });
    const before = { home: await site.props("home"), other: await site.props("other") };
    const conversation = await store.createConversation(site.scope);

    const run = await ask(runner, conversation.id, 'replace "Old" with "New" on all pages');
    expect(run).toMatchObject({ status: "completed", provider: { provider: assistant.provider } });
    const view = await service.drafts.draft({ workspaceId: "proof" });
    expect(view.draft?.changes.map(change => [change.page.pageId, change.nodeId, change.prop, change.after])).toEqual(expect.arrayContaining([
      ["home", "paragraph", "text", "Welcome to the New shop."], ["other", "paragraph", "text", "New news here."],
    ]));
    // Only string fields the policy matched; the list (an array field) and other blocks are untouched.
    expect(view.draft?.changes).toHaveLength(2);
    expect({ home: await site.props("home"), other: await site.props("other") }).toEqual(before);
    const reply = (await store.conversation(site.scope, conversation.id)).messages.at(-1)!;
    expect(reply.text).toMatch(/ready for your review/);
    expect(reply.draft?.operationIds).toHaveLength(view.draft!.operations.length);

    const approve = view.draft!.candidateDigest!;
    const receipt = await service.drafts.apply({ workspaceId: "proof", draftId: view.draft!.id, revision: view.draft!.revision, approve });
    expect(receipt.pages.map(page => page.identity.pageId).sort()).toEqual(["home", "other"]);
    expect(await service.drafts.apply({ workspaceId: "proof", draftId: view.draft!.id, revision: view.draft!.revision, approve })).toEqual(receipt);
    expect((await site.props("home")).paragraph).toEqual({ text: "Welcome to the New shop." });
    expect((await site.props("home")).list).toEqual(before.home.list);
    await service.drafts.undo({ workspaceId: "proof", draftId: view.draft!.id, approve });
    expect({ home: await site.props("home"), other: await site.props("other") }).toEqual(before);

    // A restarted server (new store, service and runner on the same files) keeps the conversation.
    const restarted = await site.open();
    expect((await restarted.store.conversation(site.scope, conversation.id)).messages.map(message => message.role)).toEqual(["user", "assistant"]);
  }, 60_000);

  it("keeps Memory, refuses out-of-scope requests and stops on request", async () => {
    const assistant = parseAssistant(config)!;
    const site = await host(assistant);
    const { service, store, runner } = await site.open();
    const conversation = await store.createConversation(site.scope);
    const mode = (await store.settings(site.scope)).memory;
    await store.setMemoryMode(site.scope, { mode: "auto", expectedModeRevision: mode.modeRevision });
    const remembered = await ask(runner, conversation.id, "remember: Our readers are beginners.");
    expect(remembered.status).toBe("completed");
    expect((await store.settings(site.scope)).memory.body).toContain("Our readers are beginners.");

    const refused = await ask(runner, conversation.id, "write custom CSS for the header");
    expect(refused.status).toBe("completed");
    expect((await service.drafts.draft({ workspaceId: "proof" })).draft?.changes ?? []).toEqual([]);

    const other = await store.createConversation(site.scope);
    const unknownTool = await ask(runner, other.id, "try to apply");
    expect(unknownTool).toMatchObject({ status: "failed", error: { code: "malformed-output" } });

    const waiting = await runner.start("proof", { conversationId: other.id, clientTurnId: crypto.randomUUID(), text: "wait", context: pageContext });
    await new Promise(resolveWait => setTimeout(resolveWait, 300));
    expect(await runner.stop("proof", waiting.runId)).toEqual({ status: "stopped" });
    expect((await runner.run("proof", waiting.runId)).status).toBe("stopped");
    expect((await service.drafts.draft({ workspaceId: "proof" })).draft?.changes ?? []).toEqual([]);
  }, 60_000);
});
