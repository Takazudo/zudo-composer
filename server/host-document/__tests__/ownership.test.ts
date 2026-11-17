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
async function dynamicFixture() {
  const input = await fixture(), project = input.snapshot.project;
  const content = project.providers.content[0]!;
  content.models[0]!.document.fields.push({ id: "course-slug", key: "slug", label: "Slug", kind: "slug", required: false });
  content.entries[0]!.values["course-slug"] = "untouched";
  const second = structuredClone(content.entries[0]!); second.id = "second";
  second.values["course-slug"] = "second";
  second.values["course-price"] = "200"; second.values["course-private"] = "second";
  content.entries.push(second);
  project.providers.sitemaps[0]!.records[0]!.document.root[0]!.children = [{ id: "detail", title: "Detail", source: { kind: "mapping", ref: { providerId: "mapping-filesystem", recordId: "used" }, route: { kind: "entry-field", fieldId: "course-slug" } }, children: [] }];
  const result = await compileSiteProject(project, { componentCatalog: createComponentCatalog(input.manifest), policy: "release" });
  if (result.status !== "ready") throw new Error(JSON.stringify(result.diagnostics));
  input.compiled.build = result.build;
  return input;
}
it("carries qualified root Sitemap Mapping entries into targets and resolves each dynamic route's actual field owner", async () => {
  const input = await dynamicFixture();
  for (const [pathname, recordId, value] of [["/untouched", "consultation", "100"], ["/second", "second", "200"]]) {
    const route = input.compiled.build.routes.find(route => route.pathname === pathname)!;
    const target = hostDocumentTargets(route).find(target => target.nodeId === "copy")!;
    expect(target.entries).toEqual([{ providerId: "content-filesystem", modelId: "course", recordId }]);
    expect(target.props.text).toBe(value);
    const selection = { revision: input.snapshot.digest, pathname: route.pathname, target: { renderedNodeId: target.renderedNodeId, providerId: target.providerId, recordId: target.recordId, nodeId: target.nodeId }, prop: "text" };
    const result = resolveHostOwnership({ ...input, selection });
    expect(result.owner).toEqual({ domain: "content", entry: target.entries[0], fieldIds: ["course-price"] });
    expect(result.affectedUses.map(use => use.pathname).sort()).toEqual(["/", pathname].sort());
    expect(resolveHostOwnership({ ...input, selection: { ...selection, prop: "other" } }).owner.domain).toBe("unsupported");
  }
});
it("keeps nested attachment provenance distinct from the root route and never assigns a linked Global template the selected entry", async () => {
  const input = await dynamicFixture(), project = input.snapshot.project;
  const records = project.providers.compositions[0]!.records;
  const presentation = records.find(record => record.id === "presentation")!;
  const nested = structuredClone(presentation); nested.id = nested.document.id = "nested"; records.push(nested);
  const parent = structuredClone(records.find(record => record.id === "home")!.document.root[0]!);
  parent.id = "nested-slot"; presentation.document.root.push(parent);
  project.providers.mappings[0]!.records.find(record => record.id === "unused")!.document.composition.recordId = "nested";
  project.collectionAttachments = [];
  project.collectionAttachments.push({ id: "nested-use", order: 20, composition: { providerId: "files", recordId: "presentation" }, target: { nodeId: "nested-slot", slotId: "children" }, mapping: { providerId: "mapping-filesystem", recordId: "unused" } });
  const result = await compileSiteProject(project, { componentCatalog: createComponentCatalog(input.manifest), policy: "release" });
  if (result.status !== "ready") throw new Error(JSON.stringify(result.diagnostics));
  input.compiled.build = result.build;
  const route = result.build.routes.find(route => route.pathname === "/second")!;
  const targets = hostDocumentTargets(route);
  const target = targets.find(target => target.recordId === "nested" && target.entries[0]?.recordId === "consultation")!;
  expect(target.entries).toEqual([{ providerId: "content-filesystem", modelId: "course", recordId: "consultation" }]);
  const selection = { revision: input.snapshot.digest, pathname: route.pathname, target: { renderedNodeId: target.renderedNodeId, providerId: target.providerId, recordId: target.recordId, nodeId: target.nodeId }, prop: "text" };
  expect(resolveHostOwnership({ ...input, selection }).owner).toMatchObject({ domain: "content", entry: target.entries[0], fieldIds: ["course-private"] });
  // A linked source is a different canonical owner even on a Mapping-backed route.
  const linked = structuredClone(route);
  linked.composition.linkedSource = { ref: { providerId: "files", recordId: "global" }, document: structuredClone(nested.document), outlet: { id: "main", label: "Main", target: { parentId: "copy", slotId: "children" } } };
  expect(hostDocumentTargets(linked).filter(target => target.recordId === "global").every(target => target.entries.length === 0)).toBe(true);
});
it("does not turn transformed dynamic route values into writable local props", async () => {
  const input = await dynamicFixture(), project = input.snapshot.project;
  project.providers.mappings[0]!.records.find(record => record.id === "used")!.document.bindings[0]!.transform = { kind: "prefix", prefix: "Price: " };
  const compiled = await compileSiteProject(project, { componentCatalog: createComponentCatalog(input.manifest), policy: "release" });
  if (compiled.status !== "ready") throw new Error(JSON.stringify(compiled.diagnostics));
  input.compiled.build = compiled.build;
  const route = compiled.build.routes.find(route => route.pathname === "/untouched")!, target = hostDocumentTargets(route)[0]!;
  expect(target.props.text).toBe("Price: 100");
  expect(resolveHostOwnership({ ...input, selection: { revision: input.snapshot.digest, pathname: route.pathname, target: { renderedNodeId: target.renderedNodeId, providerId: target.providerId, recordId: target.recordId, nodeId: target.nodeId }, prop: "text" } }).owner).toMatchObject({ domain: "unsupported", reason: expect.stringContaining("Transformed") });
});

it("human bound fields show cross-page uses without Assistant policy and ignore unused Mappings", async () => {
  const { describeHostFieldSources } = await import("../field-sources");
  const input = await dynamicFixture();
  const routes = input.compiled.build.routes.map(route => ({ route, targets: hostDocumentTargets(route) }));
  const describe = describeHostFieldSources(input.snapshot.project, input.manifest, routes);
  const home = routes.find(value => value.route.pathname === "/")!;
  const target = home.targets.find(target => target.nodeId === "copy" && target.entries.some(entry => entry.recordId === "consultation"))!;
  const fields = describe(home.route, target);
  expect(fields.map(field => field.prop)).toEqual(["text"]);
  expect(fields[0]!.sources[0]).toMatchObject({ entry: { providerId: "content-filesystem", modelId: "course", recordId: "consultation" }, fieldId: "course-price", fieldLabel: "Price" });
  expect(fields[0]!.sources[0]!.affectedUses.map(use => use.pathname).sort()).toEqual(["/", "/untouched"]);
  expect(resolveHostOwnership({ ...input, contentFields: undefined, selection: input.select("copy", "text") }).owner.domain).toBe("unsupported");
  expect(describe(home.route, home.targets.find(target => target.nodeId === "local")!)).toEqual([]);
  // Discovery includes nontext sources without silently granting AI or local edit capability.
  input.snapshot.project.providers.content[0]!.models[0]!.document.fields.find(field => field.id === "course-price")!.kind = "number";
  expect(describe(home.route, target)[0]!.sources[0]!.fieldId).toBe("course-price");
});
it("human source descriptions distinguish entry identity and transformed values", async () => {
  const { describeHostFieldSources } = await import("../field-sources");
  const input = await fixture();
  const routes = input.compiled.build.routes.map(route => ({ route, targets: hostDocumentTargets(route) }));
  const mapping = input.snapshot.project.providers.mappings[0]!.records.find(record => record.id === "used")!;
  const original = structuredClone(mapping.document.bindings[0]!);
  if (original.source) throw new Error("Expected field binding");
  original.transform = { kind: "prefix", prefix: "Price: " };
  mapping.document.bindings = [original];
  const bound = routes[0]!.targets.find(target => target.nodeId === "copy")!;
  expect(describeHostFieldSources(input.snapshot.project, input.manifest, routes)(routes[0]!.route, bound)[0]!.sources[0]).toMatchObject({ fieldId: "course-price", reason: expect.stringContaining("transformed") });
  input.snapshot.project.providers.content[0]!.entries = [];
  expect(describeHostFieldSources(input.snapshot.project, input.manifest, routes)(routes[0]!.route, bound)[0]!.sources[0]!.reason).toContain("unavailable");
  mapping.document.bindings = [{ id: "identity", source: { kind: "entry-id" }, target: { nodeId: "copy", prop: "text" }, transform: { kind: "identity" } }];
  const target = routes[0]!.targets.find(target => target.nodeId === "copy")!;
  expect(describeHostFieldSources(input.snapshot.project, input.manifest, routes)(routes[0]!.route, target)[0]!.sources[0]).toMatchObject({ fieldLabel: "Entry identity", reason: expect.stringContaining("read-only") });
});

it("returns editing constraints only for the exact selected allowed Content source, without changing authority", async () => {
  const input = await fixture();
  const selection = input.select("copy", "text");
  const before = resolveHostOwnership({ ...input, selection });
  const instructions = "Preserve the currency suffix; do not edit unrelated fields.";
  const contentFields = [
    { ...input.contentFields[0]!, fieldInstructions: { "course-price": instructions, "course-private": "Private field guidance" } },
    { providerId: "foreign", modelId: "course", fieldIds: ["course-price"], fieldInstructions: { "course-price": "Foreign provider guidance" } },
    { providerId: "content-filesystem", modelId: "note", fieldIds: ["course-price"], fieldInstructions: { "course-price": "Foreign model guidance" } },
  ];
  const result = resolveHostOwnership({ ...input, contentFields, selection });
  expect(result).toEqual({ ...before, capabilities: { ...before.capabilities, fields: [{ id: "course-price", label: "Price", kind: "text", editingConstraints: { instructions, authority: "guidance-only" } }] } });
  expect(JSON.stringify(result)).not.toMatch(/Private field guidance|Foreign provider guidance|Foreign model guidance/);
  expect(resolveHostOwnership({ ...input, contentFields, selection: input.select("local", "text") })).toEqual(resolveHostOwnership({ ...input, selection: input.select("local", "text") }));
  expect(resolveHostOwnership({ ...input, contentFields: [{ ...contentFields[0]!, fieldIds: [] }], selection }).owner.domain).toBe("unsupported");
});
