import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { defineComponent, defineComponentPack } from "@zudo-composer/component-contract";
import { composer } from "../../config/config";
import { initializeAuthoringWorkspace } from "../../edit/initialize-workspace";
import { defineSite, node } from "../../../src/site-project/authoring";
import { createFilesystemAssetStore } from "../../../src/assets/storage/filesystem/store";
import { hostDocumentTargets } from "../render";
import { captureAuthoringWorkspace, compileAuthoringWorkspaceSnapshot } from "../../authoring-workspace/capture";
import { editHostDocument } from "../edit";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture(shared = false, consultation = false) {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "host-edit-")); roots.push(workspaceRoot);
  const pack = defineComponentPack({ packId: "proof", packVersion: "1.0.0", components: [defineComponent<{ items: unknown[] }>()((props: { items: unknown[] }) => props.items, { id: "group", schemaVersion: 1, title: "Group", description: "Placement", category: "Proof", source: { module: "proof/components", exportKind: "named", exportName: "Group" }, defaults: {}, fields: [], slots: [{ id: "items", prop: "items", label: "Items", cardinality: "many", accepts: ["paragraph", "group"] }] }), defineComponent<{ text: string }>()((props: { text: string }) => props.text, { id: "paragraph", schemaVersion: 1, title: "Paragraph", description: "Proof", category: "Proof", source: { module: "proof/components", exportKind: "named", exportName: "Paragraph" }, defaults: { text: "" }, fields: [{ kind: "text", prop: "text", label: "Text" }] })] });
  const composerConfig = composer({ workspaceRoot, pack: "proof/components", authoringAuthority: "workspace", nativeEditing: { source: "workspace" } }, { env: {} });
  await createFilesystemAssetStore({ assetsStoreRoot: composerConfig.paths.assets });
  const site = defineSite({ id: "proof", name: "Proof", componentPack: pack });
  const page = site.page({ id: "home", name: "Home", root: [node("paragraph", { text: "First" }, {}, "first"), node("paragraph", { text: "Second" }, {}, "second")] });
  site.sitemap({ id: "main", name: "Main", root: { id: "home", title: "Home", page, ...(shared ? { children: [{ id: "duplicate", title: "Duplicate", slug: "duplicate", page }] } : {}) } });
  if (consultation) {
    const model = site.model({ id: "course", name: "Course", kind: "collection", fields: [{ key: "price", label: "Price", kind: "text" }] });
    site.entry(model, { id: "consultation", values: { price: "Shared price" } });
    const presentation = site.page({ id: "lessons-consultation", name: "Consultation", root: [node("group", {}, { items: [node("paragraph", { text: "" }, {}, "price")] }, "section")] });
    const mapping = site.mapping({ id: "lessons-consultation", name: "Consultation", model, composition: presentation, mode: { kind: "collection" }, bindings: [{ field: "price", nodeId: "price", prop: "text" }] });
    page.record.document.root.push({ id: "consultation", componentId: "group", componentVersion: 1, props: {}, slots: { items: [] } });
    site.attach(mapping, { composition: page, nodeId: "consultation", slotId: "items" });
  }
  await initializeAuthoringWorkspace({ composerConfig, pack, project: site.toSiteProject(), workspaceId: "proof" });
  return { composerConfig, pack, packIdentity: { specifier: "proof/components", source: "self", digest: "a".repeat(64), compiler: "proof-compiler", contractDigest: "b".repeat(64) }, renderer: { id: "proof", version: "1", module: "proof/renderer", digest: "c".repeat(64) } };
}
it("saves exact owner field, recovers retry receipt, refuses stale and invalid writes, and persists reorder", async () => {
  const options = await fixture(); const before = await captureAuthoringWorkspace(options);
  const request = { workspaceId: "proof", revision: before.digest, pathname: "/", operationId: randomUUID(), target: { renderedNodeId: "first", providerId: "files", recordId: "home", nodeId: "first" }, change: { kind: "field", prop: "text", value: "Changed" } };
  const receipt = await editHostDocument(options, request);
  expect(await editHostDocument(options, request)).toEqual(receipt);
  const saved = await captureAuthoringWorkspace(options);
  expect(saved.project.providers.compositions[0]!.records[0]!.document.root[0]!.props.text).toBe("Changed");
  await expect(editHostDocument(options, { ...request, operationId: randomUUID() })).rejects.toMatchObject({ code: "stale-plan" });
  await expect(editHostDocument(options, { ...request, revision: saved.digest, operationId: randomUUID(), change: { kind: "field", prop: "text", value: 42 } })).rejects.toMatchObject({ code: "component-invalid" });
  expect((await captureAuthoringWorkspace(options)).digest).toBe(saved.digest);
  await editHostDocument(options, { ...request, revision: saved.digest, operationId: randomUUID(), change: { kind: "reorder", direction: "down" } });
  const reordered = await captureAuthoringWorkspace(options);
  expect(reordered.project.providers.compositions[0]!.records[0]!.document.root.map(node => node.id)).toEqual(["second", "first"]);
});

it("refuses a purported local property edit when direct Sitemap routes share the composition", async () => {
  const options = await fixture(true); const before = await captureAuthoringWorkspace(options);
  await expect(editHostDocument(options, { workspaceId: "proof", revision: before.digest, pathname: "/", operationId: randomUUID(), target: { renderedNodeId: "first", providerId: "files", recordId: "home", nodeId: "first" }, change: { kind: "field", prop: "text", value: "Shared change" } })).rejects.toMatchObject({ code: "unsupported-scope" });
  expect((await captureAuthoringWorkspace(options)).digest).toBe(before.digest);
});

it("moves the local placement of a mapped Consultation root without editing its shared owner", async () => {
  const options = await fixture(false, true);
  const before = await captureAuthoringWorkspace(options);
  const compiled = await compileAuthoringWorkspaceSnapshot({ ...options, snapshot: before });
  const targets = hostDocumentTargets(compiled.build.routes[0]!);
  const section = targets.find(target => target.recordId === "lessons-consultation" && target.nodeId === "section")!;
  const price = targets.find(target => target.recordId === "lessons-consultation" && target.nodeId === "price")!;
  expect(section.placement).toEqual({ providerId: "files", recordId: "home", nodeId: "consultation", parentNodeId: null, slotId: null });
  expect(price.placement).toBeUndefined();
  const coordinates = (target: typeof section) => ({ renderedNodeId: target.renderedNodeId, providerId: target.providerId, recordId: target.recordId, nodeId: target.nodeId });
  const request = { workspaceId: "proof", pathname: "/", revision: before.digest, operationId: randomUUID(), target: coordinates(section), change: { kind: "reorder-placement", direction: "up" } };
  for (const invalid of [
    { ...request, target: coordinates(price) },
    { ...request, target: { ...coordinates(section), nodeId: "consultation" } },
    { ...request, change: { kind: "reorder", direction: "up" } },
    { ...request, change: { ...request.change, placement: section.placement } },
  ]) await expect(editHostDocument(options, invalid)).rejects.toThrow();
  expect((await captureAuthoringWorkspace(options)).digest).toBe(before.digest);
  const receipt = await editHostDocument(options, request);
  expect(await editHostDocument(options, request)).toEqual(receipt);
  const after = await captureAuthoringWorkspace(options);
  expect(after.project.providers.content).toEqual(before.project.providers.content);
  expect(after.project.providers.mappings).toEqual(before.project.providers.mappings);
  expect(after.project.providers.compositions[0]!.records.find(record => record.id === "lessons-consultation")).toEqual(before.project.providers.compositions[0]!.records.find(record => record.id === "lessons-consultation"));
  expect(after.project.providers.compositions[0]!.records.find(record => record.id === "home")!.document.root.map(node => node.id)).toEqual(["first", "consultation", "second"]);
  await expect(editHostDocument(options, { ...request, operationId: randomUUID() })).rejects.toMatchObject({ code: "stale-plan" });
  expect((await captureAuthoringWorkspace(options)).digest).toBe(after.digest);
});
