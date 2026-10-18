import { afterEach, describe, expect, it } from "vitest";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadHostContext } from "../../host-context.mjs";
import { initializeAuthoringWorkspace } from "../initialize-workspace";
import { createEditingService } from "../service";
import { captureHost } from "../inspect";
import { defineSite, node } from "../../../src/site-project/authoring";
import { createFilesystemAssetStore } from "../../../src/assets/storage/filesystem/store";
import type { ExactPayload } from "../draft-service";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture(config?: string) {
  const root = await mkdtemp(join(tmpdir(), "draft-service-")); roots.push(root);
  await cp(resolve("fixtures/edit-host"), root, { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "native-edit-host", version: "1.0.0", type: "module", exports: { "./components": "./components/pack.mjs" }, dependencies: { preact: "10.27.2", "@zudo-composer/component-contract": "workspace:*" } }));
  await mkdir(join(root, "node_modules/@zudo-composer"), { recursive: true });
  await symlink(resolve("."), join(root, "node_modules/zudo-composer"), "dir");
  await symlink(resolve("node_modules/preact"), join(root, "node_modules/preact"), "dir");
  await symlink(resolve("node_modules/@zudo-composer/component-contract"), join(root, "node_modules/@zudo-composer/component-contract"), "dir");
  if (config) await writeFile(join(root, "zudo-composer.config.ts"), config);
  const host = await loadHostContext({ workspaceRoot: root });
  const options = { config: host.composerConfig, pack: host.pack, packIdentity: host.packIdentity };
  const site = defineSite({ id: "draft-proof", name: "Proof", componentPack: host.pack });
  const home = site.page({ id: "home", name: "Home", root: [
    node("native.paragraph", { text: "Original welcome" }, {}, "paragraph"),
    node("native.list", { items: ["One", "Two"] }, {}, "list"),
    node("native.table", { columns: ["Name", "Value"], rows: [["Alpha", "Before"]] }, {}, "table"),
  ] });
  const other = site.page({ id: "other", name: "Other", root: [
    node("native.paragraph", { text: "Other page text" }, {}, "paragraph"),
    node("native.note", { text: "Note text" }, {}, "note"),
  ] });
  site.sitemap({ id: "main", name: "Main", root: { id: "home", title: "Home", page: home, children: [{ id: "other", slug: "other", title: "Other", page: other }] } });
  await initializeAuthoringWorkspace({ composerConfig: host.composerConfig, pack: host.pack, project: site.toSiteProject(), workspaceId: "proof" });
  const assets = await createFilesystemAssetStore({ assetsStoreRoot: host.composerConfig.paths.assets });
  const asset = await assets.upload({ fileName: "pixel.png", declaredMimeType: "image/png", bytes: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=", "base64") });
  const service = createEditingService(options);
  const composition = (id: string) => join(host.composerConfig.paths.compositions, "workspace-v1-proof", `composition-${id}`);
  const bytes = async () => Promise.all(["home", "other"].flatMap(id => [readFile(`${composition(id)}.composition.json`, "utf8"), readFile(`${composition(id)}.tsx`, "utf8")]));
  return { root, options, service, drafts: service.drafts, asset, bytes, composition };
}
const home = { sitemapId: "main", pageId: "home" }, other = { sitemapId: "main", pageId: "other" };
const assistant = { actor: "assistant" as const, conversationId: "c1", runId: "r1" };
const payloads = (values: Record<string, ExactPayload>) => async (id: string) => { if (!values[id]) throw new Error("missing payload"); return values[id]; };

describe("shared Assistant drafts", () => {
  it("accumulates multi-page field updates and insertions without touching canonical bytes, then applies all pages atomically", async () => {
    const { drafts, bytes, composition } = await fixture();
    const before = await bytes();
    const first = await drafts.propose({ workspaceId: "proof", expected: { generation: 0, draftId: null }, provenance: assistant, operations: [{ kind: "updateField", page: home, nodeId: "paragraph", prop: "text", value: "Welcome, beginners", reason: "Requested tone" }] });
    expect(first.draft?.changes).toHaveLength(1);
    expect(first.draft?.changes[0]).toMatchObject({ kind: "field", nodeId: "paragraph", prop: "text", before: "Original welcome", after: "Welcome, beginners" });
    const second = await drafts.propose({ workspaceId: "proof", expected: { generation: 0, draftId: first.draft!.id }, provenance: { ...assistant, conversationId: "c2" }, operations: [{ kind: "insertComponent", page: other, componentId: "native.note", at: { after: "paragraph" }, props: { text: "Added exactly" } }] }, payloads({}));
    expect(second.draft?.revision).toBe(2);
    expect(second.draft?.pages.filter(page => page.changed)).toHaveLength(2);
    expect(second.draft?.changes.map(change => change.kind).sort()).toEqual(["added", "field"]);
    expect(await bytes()).toEqual(before);
    const approve = second.draft!.candidateDigest!;
    const receipt = await drafts.apply({ workspaceId: "proof", draftId: second.draft!.id, revision: 2, approve });
    expect(receipt.pages.map(page => page.identity.pageId).sort()).toEqual(["home", "other"]);
    expect(JSON.parse(await readFile(`${composition("home")}.composition.json`, "utf8")).document.root[0].props.text).toBe("Welcome, beginners");
    expect(await readFile(`${composition("other")}.tsx`, "utf8")).toContain("Added exactly");
    // A lost response retries to the original receipt, never a second write.
    expect(await drafts.apply({ workspaceId: "proof", draftId: second.draft!.id, revision: 2, approve })).toEqual(receipt);
    expect((await drafts.draft({ workspaceId: "proof" })).draft?.status).toBe("applied");
    // A late run that observed the pre-Apply generation cannot append.
    await expect(drafts.propose({ workspaceId: "proof", expected: { generation: 0, draftId: second.draft!.id }, provenance: assistant, operations: [{ kind: "updateField", page: home, nodeId: "list", prop: "items", value: ["x"] }] })).rejects.toMatchObject({ code: "stale-draft" });
  });

  it("removes semantic zero-diff changes and withdraws a change with explicit dependent resolution", async () => {
    const { drafts } = await fixture();
    let view = await drafts.propose({ workspaceId: "proof", expected: { generation: 0, draftId: null }, provenance: assistant, operations: [{ kind: "updateField", page: home, nodeId: "paragraph", prop: "text", value: "Changed" }] });
    view = await drafts.propose({ workspaceId: "proof", expected: { generation: 0, draftId: view.draft!.id }, provenance: assistant, operations: [{ kind: "updateField", page: home, nodeId: "paragraph", prop: "text", value: "Original welcome" }] });
    expect(view.draft?.changes).toEqual([]);
    expect(view.draft?.candidateDigest).toBeTruthy();
    await expect(drafts.apply({ workspaceId: "proof", draftId: view.draft!.id, revision: view.draft!.revision, approve: view.draft!.candidateDigest! })).rejects.toMatchObject({ code: "empty-draft" });
    view = await drafts.propose({ workspaceId: "proof", expected: { generation: 0, draftId: view.draft!.id }, provenance: assistant, operations: [{ kind: "insertComponent", page: home, componentId: "native.paragraph", at: { after: "paragraph" }, props: { text: "First" } }] });
    const inserted = view.draft!.changes.find(change => change.kind === "added")!;
    view = await drafts.propose({ workspaceId: "proof", expected: { generation: 0, draftId: view.draft!.id }, provenance: assistant, operations: [{ kind: "insertComponent", page: home, componentId: "native.paragraph", at: { after: inserted.nodeId }, props: { text: "Second" } }] });
    expect(view.draft?.changes.filter(change => change.kind === "added")).toHaveLength(2);
    const cascade = await drafts.withdraw({ workspaceId: "proof", draftId: view.draft!.id, revision: view.draft!.revision, changeId: inserted.id });
    expect(cascade).toMatchObject({ requiresCascade: true, dependents: [expect.objectContaining({ kind: "insertNode" })] });
    const withdrawn = await drafts.withdraw({ workspaceId: "proof", draftId: view.draft!.id, revision: view.draft!.revision, changeId: inserted.id, cascade: true });
    expect("draft" in withdrawn && withdrawn.draft?.changes).toEqual([]);
  });

  it("rejects unknown components, undeclared props, invalid values, unrequested defaults, scope escapes and other workspaces", async () => {
    const { drafts, bytes } = await fixture();
    const before = await bytes();
    const propose = (operations: unknown[], extra: Record<string, unknown> = {}) => drafts.propose({ workspaceId: "proof", expected: { generation: 0, draftId: null }, provenance: assistant, operations, ...extra });
    await expect(propose([{ kind: "insertComponent", page: home, componentId: "native.missing", at: { after: "paragraph" }, props: {} }])).rejects.toMatchObject({ code: "component-invalid" });
    await expect(propose([{ kind: "updateField", page: home, nodeId: "paragraph", prop: "caption", value: "x" }])).rejects.toMatchObject({ code: "component-invalid" });
    await expect(propose([{ kind: "updateField", page: home, nodeId: "list", prop: "items", value: "not a list" }])).rejects.toMatchObject({ code: "component-invalid" });
    await expect(propose([{ kind: "updateField", page: home, nodeId: "absent", prop: "text", value: "x" }])).rejects.toMatchObject({ code: "unsupported-target" });
    await expect(propose([{ kind: "insertComponent", page: home, componentId: "native.paragraph", at: { after: "absent" }, props: { text: "x" } }])).rejects.toMatchObject({ code: "unsupported-target" });
    await expect(propose([{ kind: "updateField", page: other, nodeId: "note", prop: "text", value: "x" }], { allowedPages: [home] })).rejects.toMatchObject({ code: "unsupported-scope" });
    await expect(drafts.propose({ workspaceId: "someone-else", expected: { generation: 0, draftId: null }, provenance: assistant, operations: [{ kind: "updateField", page: home, nodeId: "paragraph", prop: "text", value: "x" }] })).rejects.toMatchObject({ code: "wrong-workspace" });
    await expect(propose([{ kind: "updateField", page: home, nodeId: "paragraph", prop: "text", value: "x", extra: true }])).rejects.toMatchObject({ code: "invalid-request" });
    // One invalid operation refuses the whole proposal; nothing is persisted.
    await expect(propose([{ kind: "updateField", page: home, nodeId: "paragraph", prop: "text", value: "ok" }, { kind: "updateField", page: home, nodeId: "paragraph", prop: "nope", value: "x" }])).rejects.toMatchObject({ code: "component-invalid" });
    expect((await drafts.draft({ workspaceId: "proof" })).draft).toBeNull();
    expect(await bytes()).toEqual(before);
  });

  it("copies a registered component and inserts exact text/table/image payloads through declared native components", async () => {
    const { drafts, asset } = await fixture();
    const view = await drafts.propose({ workspaceId: "proof", expected: { generation: 0, draftId: null }, provenance: assistant, operations: [
      { kind: "copyComponent", page: other, sourcePage: home, sourceNodeId: "list", at: { after: "note" } },
      { kind: "insertExact", page: home, at: { after: "paragraph" }, payloadId: "p-text" },
      { kind: "insertExact", page: home, at: { after: "list" }, payloadId: "p-table" },
      { kind: "insertExact", page: home, at: { after: "table" }, payloadId: "p-image" },
      { kind: "updateField", page: other, nodeId: "note", prop: "text", value: { $payload: "p-text" } },
    ] }, payloads({ "p-text": { kind: "text", text: "正確な日本語。\n改行も保持。" }, "p-table": { kind: "table", columns: ["項目", "値"], rows: [["数量", "3"]] }, "p-image": { kind: "image", assetId: asset.id, alt: "" } }));
    const added = view.draft!.changes.filter(change => change.kind === "added");
    expect(added.map(change => change.componentId).sort()).toEqual(["native.image", "native.list", "native.paragraph", "native.table"]);
    expect(added.find(change => change.componentId === "native.paragraph")?.props).toEqual({ text: "正確な日本語。\n改行も保持。" });
    expect(added.find(change => change.componentId === "native.table")?.props).toEqual({ columns: ["項目", "値"], rows: [["数量", "3"]] });
    expect(String(added.find(change => change.componentId === "native.image")?.props?.src)).toMatch(/^\/uploaded-assets\/sha256-[a-f0-9]{64}\.png$/);
    expect(added.find(change => change.componentId === "native.image")?.props?.alt).toBe("");
    expect(added.find(change => change.componentId === "native.list")?.props).toEqual({ items: ["One", "Two"] });
    expect(view.draft!.changes.find(change => change.kind === "field")).toMatchObject({ after: "正確な日本語。\n改行も保持。" });
    await expect(drafts.propose({ workspaceId: "proof", expected: { generation: 0, draftId: view.draft!.id }, provenance: assistant, operations: [{ kind: "insertExact", page: home, at: { after: "paragraph" }, payloadId: "bad" }] }, payloads({ bad: { kind: "table", columns: ["a", "b"], rows: [["only one"]] } }))).rejects.toMatchObject({ code: "invalid-table" });
  });

  it("reports staleness after a manual edit, refuses Apply, and rebases only through explicit revalidation", async () => {
    const { drafts, options } = await fixture();
    const view = await drafts.propose({ workspaceId: "proof", expected: { generation: 0, draftId: null }, provenance: assistant, operations: [{ kind: "updateField", page: home, nodeId: "list", prop: "items", value: ["One", "Two", "Three"] }] });
    const state = await captureHost(options);
    const record = state.records.compositions.find(candidate => candidate.id === "home")!;
    await state.stores.compositions.put({ ...record, document: { ...record.document, root: record.document.root.map(item => item.id === "paragraph" ? { ...item, props: { text: "Manual edit" } } : item) } }, "manual JSX");
    const stale = await drafts.draft({ workspaceId: "proof" });
    expect(stale.draft?.stale).toHaveLength(1);
    expect(stale.draft?.candidateDigest).toBeNull();
    await expect(drafts.apply({ workspaceId: "proof", draftId: view.draft!.id, revision: view.draft!.revision, approve: view.draft!.candidateDigest! })).rejects.toMatchObject({ code: "stale-draft" });
    const rebased = await drafts.revalidate({ workspaceId: "proof", draftId: view.draft!.id, revision: view.draft!.revision });
    expect(rebased.draft?.stale).toEqual([]);
    expect(rebased.draft?.revision).toBe(view.draft!.revision + 1);
    expect(rebased.draft?.pages[0]?.before.document.root[0]?.props.text).toBe("Manual edit");
    expect(rebased.draft?.changes).toHaveLength(1);
  });

  it("discards without canonical writes and fences late proposals; guarded Undo restores once and refuses after newer edits", async () => {
    const { drafts, bytes, options } = await fixture();
    const before = await bytes();
    const view = await drafts.propose({ workspaceId: "proof", expected: { generation: 0, draftId: null }, provenance: assistant, operations: [{ kind: "updateField", page: home, nodeId: "paragraph", prop: "text", value: "Discard me" }] });
    await expect(drafts.discard({ workspaceId: "proof", draftId: view.draft!.id, revision: 0 })).rejects.toMatchObject({ code: "stale-draft" });
    const discarded = await drafts.discard({ workspaceId: "proof", draftId: view.draft!.id, revision: view.draft!.revision });
    expect(discarded).toMatchObject({ draft: null, generation: 1 });
    expect(await bytes()).toEqual(before);
    await expect(drafts.propose({ workspaceId: "proof", expected: { generation: 0, draftId: view.draft!.id }, provenance: assistant, operations: [{ kind: "updateField", page: home, nodeId: "paragraph", prop: "text", value: "Late" }] })).rejects.toMatchObject({ code: "stale-draft" });
    await expect(drafts.propose({ workspaceId: "proof", expected: { generation: 0, draftId: null }, provenance: assistant, operations: [{ kind: "updateField", page: home, nodeId: "paragraph", prop: "text", value: "Late" }] })).rejects.toMatchObject({ code: "stale-draft" });

    const next = await drafts.propose({ workspaceId: "proof", expected: { generation: 1, draftId: null }, provenance: assistant, operations: [{ kind: "updateField", page: home, nodeId: "paragraph", prop: "text", value: "Applied" }, { kind: "updateField", page: other, nodeId: "note", prop: "text", value: "Applied note" }] });
    const approve = next.draft!.candidateDigest!;
    await drafts.apply({ workspaceId: "proof", draftId: next.draft!.id, revision: next.draft!.revision, approve });
    const undo = await drafts.undo({ workspaceId: "proof", draftId: next.draft!.id, approve });
    expect(undo.kind).toBe("draft-undone");
    expect(JSON.parse((await bytes())[0]!)).toEqual(JSON.parse(before[0]!));
    expect(await drafts.undo({ workspaceId: "proof", draftId: next.draft!.id, approve })).toEqual(undo);

    const third = await drafts.propose({ workspaceId: "proof", expected: { generation: 3, draftId: null }, provenance: assistant, operations: [{ kind: "updateField", page: home, nodeId: "paragraph", prop: "text", value: "Third" }] });
    await drafts.apply({ workspaceId: "proof", draftId: third.draft!.id, revision: third.draft!.revision, approve: third.draft!.candidateDigest! });
    const state = await captureHost(options);
    const record = state.records.compositions.find(candidate => candidate.id === "home")!;
    await state.stores.compositions.put({ ...record, document: { ...record.document, root: record.document.root.slice(0, 1) } }, "later JSX");
    await expect(drafts.undo({ workspaceId: "proof", draftId: third.draft!.id, approve: third.draft!.candidateDigest! })).rejects.toMatchObject({ code: "undo-conflict" });
  });

  it("reconciles a draft from its durable receipt when the process died before the draft status write", async () => {
    const { drafts, root, bytes } = await fixture();
    const view = await drafts.propose({ workspaceId: "proof", expected: { generation: 0, draftId: null }, provenance: assistant, operations: [{ kind: "updateField", page: home, nodeId: "paragraph", prop: "text", value: "Committed" }] });
    const approve = view.draft!.candidateDigest!;
    const draftFile = join(root, "cms/edit-drafts", `${view.draft!.id}.draft.json`);
    const pending = await readFile(draftFile, "utf8");
    const receipt = await drafts.apply({ workspaceId: "proof", draftId: view.draft!.id, revision: view.draft!.revision, approve });
    const committed = await bytes();
    // Simulate the crash window: canonical files and receipt are durable, the draft record still says "open".
    await writeFile(draftFile, pending);
    expect((await drafts.draft({ workspaceId: "proof" })).draft).toMatchObject({ status: "applied", applied: { operationId: receipt.operationId } });
    expect(await drafts.apply({ workspaceId: "proof", draftId: view.draft!.id, revision: view.draft!.revision, approve })).toEqual(receipt);
    expect(await bytes()).toEqual(committed);
  });

  it("propose-only hosts review drafts but refuse Apply", async () => {
    const { drafts } = await fixture(`export default { pack: "native-edit-host/components", nativeEditing: { source: "workspace" }, assistant: { permission: "propose" } };\n`);
    const view = await drafts.propose({ workspaceId: "proof", expected: { generation: 0, draftId: null }, provenance: assistant, operations: [{ kind: "updateField", page: home, nodeId: "paragraph", prop: "text", value: "Review only" }] });
    expect(view.permission).toBe("propose");
    await expect(drafts.apply({ workspaceId: "proof", draftId: view.draft!.id, revision: view.draft!.revision, approve: view.draft!.candidateDigest! })).rejects.toMatchObject({ code: "approval-denied" });
  });
});
