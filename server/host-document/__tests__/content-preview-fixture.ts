import { defineComponent, defineComponentPack } from "@zudo-composer/component-contract";
import { createComponentCatalog } from "../../../src/composer/model/types";
import { defineSite, node } from "../../../src/site-project/authoring";
import { compileSiteProject } from "../../../src/site-project/compiler";
import type { AuthoringWorkspaceSnapshot, compileAuthoringWorkspaceSnapshot } from "../../authoring-workspace/capture";
import { hostDocumentTargets } from "../render";
export async function contentPreviewFixture(multiple = false) {
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
  site.sitemap({ id: "main", name: "Main", root: { id: "home", title: "Home", page: home, ...(multiple ? { children: [{id:"lessons",title:"Lessons",slug:"lessons",page:home}] } : {}) } });
  const project = site.toSiteProject(), result = await compileSiteProject(project, { componentCatalog: createComponentCatalog(pack.manifest), policy: "release" });
  if (result.status !== "ready") throw new Error(JSON.stringify(result.diagnostics));
  const compiled: Awaited<ReturnType<typeof compileAuthoringWorkspaceSnapshot>> = { project, build: result.build, projectSourceRevision: "a".repeat(64), assetFiles: [] };
  const snapshot = { digest: "a".repeat(64), workspaceId: "proof", project, renderer: {id: "host", version: "1", digest: "b".repeat(64)} } as AuthoringWorkspaceSnapshot;
  const targets = hostDocumentTargets(compiled.build.routes[0]!);
  const select = (id: string, prop?: string) => { const target = targets.find(target => target.nodeId === id)!; return { revision: snapshot.digest, pathname: "/", target: { renderedNodeId: target.renderedNodeId, providerId: target.providerId, recordId: target.recordId, nodeId: target.nodeId }, ...(prop ? { prop } : {}) }; };
  const contentFields = [{ providerId: "content-filesystem", modelId: "course", fieldIds: ["course-price", "course-private"] }];
  return { snapshot, compiled, pack, manifest: pack.manifest, select, contentFields };
}
