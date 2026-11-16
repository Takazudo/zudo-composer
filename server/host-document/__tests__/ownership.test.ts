import { expect, it } from "vitest";
import { defineComponent, defineComponentPack } from "@zudo-composer/component-contract";
import { createComponentCatalog } from "../../../src/composer/model/types";
import { defineSite, node } from "../../../src/site-project/authoring";
import { compileSiteProject } from "../../../src/site-project/compiler";
import type { AuthoringWorkspaceSnapshot, compileAuthoringWorkspaceSnapshot } from "../../authoring-workspace/capture";
import { hostDocumentTargets } from "../render";
import { resolveHostOwnership } from "../ownership";

async function fixture() {
  const pack = defineComponentPack({ packId: "proof", packVersion: "1", components: [
    defineComponent<{ children: unknown[] }>()((props: { children: unknown[] }) => props.children, { id: "group", title: "Group", description: "Group", category: "Proof", schemaVersion: 1, source: { module: "proof/pack", exportName: "Group", exportKind: "named" }, defaults: {}, fields: [], slots: [{ id: "children", prop: "children", label: "Children", cardinality: "many", accepts: ["text"] }] }),
    defineComponent<{ text: string; other: string }>()((props: { text: string; other: string }) => props.text, { id: "text", title: "Text", description: "Text", category: "Proof", schemaVersion: 1, source: { module: "proof/pack", exportName: "Text", exportKind: "named" }, defaults: { text: "", other: "" }, fields: [{ kind: "text", prop: "text", label: "Text" }, { kind: "text", prop: "other", label: "Other" }] }),
  ] });
  const site = defineSite({ id: "proof", name: "Proof", componentPack: pack });
  const model = site.model({ id: "course", name: "Course", kind: "collection", fields: [{ key: "price", label: "Price", kind: "text" }, { key: "private", label: "Other", kind: "text" }] });
  site.entry(model, { id: "consultation", values: { price: "100", private: "untouched" } });
  const presentation = site.page({ id: "presentation", name: "Presentation", root: [node("text", { text: "", other: "Local copy" }, {}, "copy")] });
  const mapping = site.mapping({ id: "used", name: "Used", model, composition: presentation, mode: { kind: "collection" }, bindings: [{ field: "price", nodeId: "copy", prop: "text" }] });
  site.mapping({ id: "unused", name: "Unused", model, composition: presentation, mode: { kind: "collection" }, bindings: [{ field: "private", nodeId: "copy", prop: "other" }, { field: "private", nodeId: "copy", prop: "text" }] });
  const home = site.page({ id: "home", name: "Home", root: [node("group", {}, { children: [] }, "root"), node("text", { text: "Local", other: "" }, {}, "local")] });
  site.attach(mapping, { composition: home, nodeId: "root", slotId: "children" });
  site.sitemap({ id: "main", name: "Main", root: { id: "home", title: "Home", page: home } });
  const project = site.toSiteProject(), result = await compileSiteProject(project, { componentCatalog: createComponentCatalog(pack.manifest), policy: "release" });
  if (result.status !== "ready") throw new Error(JSON.stringify(result.diagnostics));
  const compiled: Awaited<ReturnType<typeof compileAuthoringWorkspaceSnapshot>> = { project, build: result.build, projectSourceRevision: "a".repeat(64), assetFiles: [] };
  const snapshot = { digest: "a".repeat(64), workspaceId: "proof", project } as AuthoringWorkspaceSnapshot;
  const targets = hostDocumentTargets(compiled.build.routes[0]!);
  const select = (id: string, prop?: string) => { const target = targets.find(target => target.nodeId === id)!; return { revision: snapshot.digest, pathname: "/", target: { renderedNodeId: target.renderedNodeId, providerId: target.providerId, recordId: target.recordId, nodeId: target.nodeId }, ...(prop ? { prop } : {}) }; };
  const contentFields = [{ providerId: "content-filesystem", modelId: "course", fieldIds: ["course-price", "course-private"] }];
  return { snapshot, compiled, manifest: pack.manifest, select, contentFields };
}
it("uses only the actual attached Mapping for Content owner and affected uses", async () => {
  const input = await fixture();
  const result = resolveHostOwnership({ ...input, selection: input.select("copy", "text") });
  expect(result.owner).toEqual({ domain: "content", entry: { providerId: "content-filesystem", modelId: "course", recordId: "consultation" }, fieldIds: ["course-price"] });
  expect(result.affectedUses.map(use => use.prop)).toEqual(["text"]);
  expect(result.field?.current).toBe("100");
  expect(resolveHostOwnership({ ...input, selection: input.select("copy", "other") }).owner.domain).toBe("unsupported");
});
it("refuses stale/foreign selections, absent policy and entry metadata; local fields retain local owner", async () => {
  const input = await fixture();
  expect(() => resolveHostOwnership({ ...input, selection: { ...input.select("copy", "text"), revision: "b".repeat(64) } })).toThrow("changed");
  const foreign = input.select("copy", "text"); foreign.target.recordId = "home";
  expect(() => resolveHostOwnership({ ...input, selection: foreign })).toThrow("qualified");
  expect(resolveHostOwnership({ ...input, contentFields: undefined, selection: input.select("copy", "text") }).owner.domain).toBe("unsupported");
  expect(resolveHostOwnership({ ...input, selection: input.select("local", "text") }).owner).toMatchObject({ domain: "composition", nodeId: "local", recordId: "home" });
  const mapping = input.snapshot.project.providers.mappings[0]!.records.find(record => record.id === "used")!;
  mapping.document.bindings = [{ id: "identity", source: { kind: "entry-id" }, target: { nodeId: "copy", prop: "text" }, transform: { kind: "identity" } }];
  expect(resolveHostOwnership({ ...input, selection: input.select("copy", "text") }).owner).toMatchObject({ domain: "unsupported", reason: expect.stringContaining("read-only metadata") });
});
it("qualifies removal from the canonical parent slot and refuses roots/shared or Mapping-owned structure", async () => {
  const { removalReason, describeHostDocumentTargets } = await import("../capabilities");
  const input = await fixture(), project = input.snapshot.project;
  const targets = hostDocumentTargets(input.compiled.build.routes[0]!);
  const local = targets.find(target => target.nodeId === "local")!, shared = targets.find(target => target.nodeId === "copy")!;
  expect(removalReason(project, local, input.manifest)).toContain("Root");
  expect(removalReason(project, shared, input.manifest)).toContain("shared Mapping");
  const record = project.providers.compositions.find(provider => provider.id === "files")!.records.find(record => record.id === "home")!;
  const child = record.document.root.pop()!;
  record.document.root[0]!.slots.children = [child];
  expect(removalReason(project, local, input.manifest)).toContain("parent slot");
  const attachments = project.collectionAttachments;
  project.collectionAttachments = [];
  // Display hierarchy is irrelevant: this fixture still says parentRenderedNodeId=null.
  expect(describeHostDocumentTargets([local], project, input.manifest)[0]!.capabilities?.remove).toEqual({ allowed: true });
  project.collectionAttachments = attachments;
  const original = record.document.root[0]!;
  record.document.root = [{ ...original, id: "outer", slots: { children: [original] } }];
  expect(removalReason(project, targets.find(target => target.nodeId === "root")!, input.manifest)).toContain("subtree owns a Mapping placement");
});
