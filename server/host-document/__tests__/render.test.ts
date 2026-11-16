import { runInNewContext } from "node:vm";
import { authoringProbeMessage } from "../../../src/features/composer/preview/protocol";
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
    expect(targets.find(target => target.renderedNodeId === "host-local-same")).toMatchObject({ parentRenderedNodeId: "host-source-same", slotId: "main", providerId: "files", recordId: "lessons", nodeId: "same" });
    expect(targets.map(value => [value.renderedNodeId, value.recordId, value.nodeId])).toEqual([["host-source-same", "template", "same"], ["host-local-same", "lessons", "same"]]);
    expect(linked.composition.document.root[0]!.id).toBe("same");
  });
  it("escapes trusted identity metadata embedded into the bridge", async () => {
    const result = await renderHostDocument({ renderDocument: () => "<html><body></body></html>" }, route, { ...identity, rendererId: "</script><script>bad" });
    expect(result.html).not.toContain("</script><script>bad");
  });
});

it("answers only exact coordination probes after load and refuses inline drafts", async () => {
  const preview = await renderHostDocument({ renderDocument: () => "<html><body></body></html>" }, route, identity);
  const script = preview.html.match(/<script>([\s\S]*?)<\/script>/)![1]!;
  const posted: unknown[] = [];
  const parent = { location: { origin: "http://localhost:4000" }, postMessage: (value: unknown) => posted.push(value) };
  const listeners: Record<string, (event: unknown) => void> = {};
  let dirty = false;
  const document = { readyState: "loading", querySelector: () => dirty ? {} : null, addEventListener() {} };
  runInNewContext(script, { parent, document, addEventListener: (name: string, callback: (event: unknown) => void) => { listeners[name] = callback; } });
  const probe = authoringProbeMessage(identity, "a".repeat(64));
  const send = (data: unknown, source: unknown = parent, origin = parent.location.origin) => listeners.message!({ source, origin, data });
  send(probe); expect(posted.at(-1)).toMatchObject({ type: "authoring-settled", clean: false, nonce: "a".repeat(64) });
  document.readyState = "complete";
  send(probe); expect(posted.at(-1)).toMatchObject({ type: "authoring-settled", clean: true, packId: identity.packId });
  dirty = true; send(probe); expect(posted.at(-1)).toMatchObject({ clean: false });
  const count = posted.length;
  send(probe, {}); send(probe, parent, "https://foreign.example");
  send({ ...probe, packVersion: "other" }); send({ ...probe, extra: true }); send({ ...probe, nonce: "bad" });
  expect(posted).toHaveLength(count);
});
