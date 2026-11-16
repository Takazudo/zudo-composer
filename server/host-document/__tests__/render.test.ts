import { describe, expect, it } from "vitest";
import { hostDocumentTargets, renderHostDocument } from "../render";
import type { SiteCompiledRoute } from "../../../src/site-project/compiler/types";
const node = (id: string) => ({ id, componentId: "test.text", componentVersion: 1, props: { text: "Hello" }, slots: {} });
const route = { pathname: "/lessons/", composition: { local: { providerId: "files", recordId: "lessons" }, document: { root: [{ ...node("section"), slots: { main: [node("course-price")] } }] } }, materializationSources: [{ renderedNodeId: "course-price", providerId: "files", recordId: "consultation", nodeId: "price", attachmentId: "course", entries: [{ providerId: "content-filesystem", modelId: "course", recordId: "consultation" }] }] } as unknown as SiteCompiledRoute;
const identity = { workspaceId: "pinsel", revision: "a".repeat(64), pathname: "/lessons/", packId: "pinsel", packVersion: "1", rendererId: "pinsel-zfb", rendererVersion: "1", rendererDigest: "b".repeat(64) };
describe("host document renderer", () => {
  it("retains mapped ownership and slot hierarchy without feeding a component into Preact", async () => {
    const result = await renderHostDocument({ renderDocument: ({ route: value, targets }) => { expect(value).toEqual(route); expect(targets[1]).toMatchObject({ recordId: "consultation", nodeId: "price", parentRenderedNodeId: "section", slotId: "main", entries: [{ modelId: "course" }] }); return '<html><body><main data-composer-target="course-price">actual host output</main></body></html>'; } }, route, identity);
    expect(result.html).toContain("actual host output"); expect(result.html).toContain("zudo-host-document-v1"); expect(result.identity).toEqual(identity);
  });
  it("rejects mismatched routes and ambiguous rendered identities", async () => {
    await expect(renderHostDocument({ renderDocument: () => "" }, route, { ...identity, pathname: "/" })).rejects.toThrow("route identity");
    expect(() => hostDocumentTargets({ ...route, composition: { ...route.composition, document: { ...route.composition.document, root: [node("duplicate"), node("duplicate")] } } })).toThrow("Ambiguous");
  });
  it("qualifies repeated node IDs across a linked template and local composition", async () => {
    const linked = { ...route, composition: { ...route.composition, document: { ...route.composition.document, root: [node("same")] }, linkedSource: { ref: { providerId: "files", recordId: "template" }, document: { ...route.composition.document, root: [node("same")] }, outlet: { id: "main", label: "Main", target: { parentId: "same", slotId: "main" } } } } };
    const targets = hostDocumentTargets(linked);
    expect(targets.map(value => [value.renderedNodeId, value.recordId, value.nodeId])).toEqual([["host-source-same", "template", "same"], ["host-local-same", "lessons", "same"]]);
    expect(linked.composition.document.root[0]!.id).toBe("same");
  });
  it("escapes trusted identity metadata embedded into the bridge", async () => {
    const result = await renderHostDocument({ renderDocument: () => "<html><body></body></html>" }, route, { ...identity, rendererId: "</script><script>bad" });
    expect(result.html).not.toContain("</script><script>bad");
  });
});
