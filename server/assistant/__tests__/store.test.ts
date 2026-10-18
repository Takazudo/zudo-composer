import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAssistantStore } from "../store";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "assistant-store-")); roots.push(root);
  return { root, store: await openAssistantStore(root) };
}
const site = { host: "/hosts/a", workspaceId: "workspace-1" };

describe("Assistant store", () => {
  it("keeps one editable Memory with CAS, history, clear and restore as new revisions", async () => {
    const { store } = await setup();
    expect((await store.recall(site)).used).toEqual({ status: "empty", revision: 0, mode: "read-only", characters: 0 });
    const saved = await store.saveMemory(site, { body: "Audience: experts.", expectedRevision: 0 });
    expect(saved.revision).toBe(1);
    await expect(store.saveMemory(site, { body: "stale writer", expectedRevision: 0 })).rejects.toMatchObject({ code: "memory-conflict" });
    await store.saveMemory(site, { body: "Audience: beginners.", expectedRevision: 1 });
    const recalled = await store.recall(site);
    expect(recalled.body).toBe("Audience: beginners.");
    expect(recalled.used).toMatchObject({ status: "used", revision: 2 });
    const cleared = await store.clearMemory(site, { expectedRevision: 2 });
    expect(cleared).toMatchObject({ revision: 3, body: "", clearGeneration: 1 });
    const restored = await store.restoreMemory(site, { revision: 1, expectedRevision: 3 });
    expect(restored).toMatchObject({ revision: 4, body: "Audience: experts.", clearGeneration: 2 });
    expect(restored.history.map(entry => entry.kind)).toEqual(["save", "save", "clear", "restore"]);
    await expect(store.saveMemory(site, { body: "x".repeat(20_001), expectedRevision: 4 })).rejects.toMatchObject({ code: "memory-oversized" });
    expect((await store.recall(site)).body).toBe("Audience: experts.");
  });

  it("Off disables recall but not human editing; modes are independent revisions", async () => {
    const { store } = await setup();
    await store.saveMemory(site, { body: "Tone: warm.", expectedRevision: 0 });
    await store.setMemoryMode(site, { mode: "off", expectedModeRevision: 0 });
    expect((await store.recall(site)).used).toEqual({ status: "off", revision: null, mode: "off", characters: 0 });
    expect((await store.saveMemory(site, { body: "Tone: playful.", expectedRevision: 1 })).body).toBe("Tone: playful.");
    await expect(store.setMemoryMode(site, { mode: "auto", expectedModeRevision: 0 })).rejects.toMatchObject({ code: "memory-conflict" });
  });

  it("fences automatic updates by mode, mode revision, clear generation, revision and run activity; retries are idempotent", async () => {
    const { store } = await setup();
    await store.setMemoryMode(site, { mode: "auto", expectedModeRevision: 0 });
    let fence = (await store.recall(site)).fence;
    const change = { kind: "append" as const, text: "The site serves beginners." };
    const first = await store.autoRemember(site, { runId: "r1", turnId: "t1", key: "r1:u1", change, fence, active: () => true });
    expect(first).toEqual({ revision: 1, duplicate: false });
    expect(await store.autoRemember(site, { runId: "r1", turnId: "t1", key: "r1:u1", change, fence, active: () => true })).toEqual({ revision: 1, duplicate: true });
    // A late run that recalled before the human Clear cannot restore old facts.
    fence = (await store.recall(site)).fence;
    await store.clearMemory(site, { expectedRevision: 1 });
    await expect(store.autoRemember(site, { runId: "r2", turnId: "t2", key: "r2:u1", change, fence, active: () => true })).rejects.toMatchObject({ code: "memory-fenced" });
    fence = (await store.recall(site)).fence;
    await expect(store.autoRemember(site, { runId: "r3", turnId: "t3", key: "r3:u1", change, fence, active: () => false })).rejects.toMatchObject({ code: "run-inactive" });
    await store.setMemoryMode(site, { mode: "read-only", expectedModeRevision: 1 });
    await expect(store.autoRemember(site, { runId: "r4", turnId: "t4", key: "r4:u1", change, fence, active: () => true })).rejects.toMatchObject({ code: "memory-fenced" });
    await expect(store.autoRemember(site, { runId: "r5", turnId: "t5", key: "r5:u1", change: { kind: "append", text: "x".repeat(501) }, fence, active: () => true })).rejects.toMatchObject({ code: "memory-change-invalid" });
    expect((await store.recall(site)).body).toBe("");
  });

  it("isolates sites with the same workspace id on different hosts and refuses copied records", async () => {
    const { store, root } = await setup();
    const other = { host: "/hosts/b", workspaceId: "workspace-1" };
    await store.saveMemory(site, { body: "Host A policy", expectedRevision: 0 });
    const conversation = await store.createConversation(site);
    expect((await store.recall(other)).body).toBe("");
    expect(await store.conversations(other)).toEqual([]);
    await expect(store.conversation(other, conversation.id)).rejects.toMatchObject({ code: "not-found" });
    // Even a record file copied under the other scope's name answers only for its own scope.
    const keyOf = (scope: { host: string; workspaceId: string }) => createHash("sha256").update(`${scope.host}\0${scope.workspaceId}`).digest("hex").slice(0, 40);
    const name = (scope: typeof site) => `site-${keyOf(scope)}.${conversation.id}.json`;
    await writeFile(join(root, "assistant", name(other)), await readFile(join(root, "assistant", name(site))));
    await expect(store.conversation(other, conversation.id)).rejects.toMatchObject({ code: "not-found" });
  });

  it("persists conversations with idempotent message ids and reports unknown schema honestly", async () => {
    const { store, root } = await setup();
    const conversation = await store.createConversation(site);
    const message = { id: "user-1", role: "user" as const, text: "Make the hero friendlier", createdAt: new Date().toISOString(), turnId: "1" };
    await store.appendMessage(site, conversation.id, message);
    await store.appendMessage(site, conversation.id, message);
    const reopened = await openAssistantStore(root);
    expect((await reopened.conversation(site, conversation.id)).messages).toHaveLength(1);
    expect((await reopened.conversations(site))[0]).toMatchObject({ title: "Make the hero friendlier", messages: 1 });
    const siteFile = (await readdir(join(root, "assistant"))).find(name => name.endsWith(".site.json"))!;
    await writeFile(join(root, "assistant", siteFile), JSON.stringify({ schemaVersion: 99 }));
    await expect(reopened.settings(site)).rejects.toMatchObject({ code: "store-corrupt" });
    expect((await reopened.recall(site)).used.status).toBe("unavailable");
  });
});
