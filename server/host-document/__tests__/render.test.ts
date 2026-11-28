import { runInNewContext } from "node:vm";
import { authoringProbeMessage } from "../../../src/features/composer/preview/protocol";
import { describe, expect, it } from "vitest";
import { hostDocumentTargets, renderHostDocument } from "../render";
import type { SiteCompiledRoute } from "../../../src/site-project/compiler/types";
const node = (id: string) => ({ id, componentId: "test.text", componentVersion: 1, props: { text: "Hello" }, slots: {} });
const route = { pathname: "/lessons/", source: { kind: "composition", ref: { providerId: "files", recordId: "lessons" } }, composition: { local: { providerId: "files", recordId: "lessons" }, document: { root: [{ ...node("section"), slots: { main: [node("course-price")] } }] } }, materializationSources: [{ renderedNodeId: "course-price", providerId: "files", recordId: "consultation", nodeId: "price", attachmentId: "course", entries: [{ providerId: "content-filesystem", modelId: "course", recordId: "consultation" }] }] } as unknown as SiteCompiledRoute;
const identity = { workspaceId: "pinsel", revision: "a".repeat(64), pathname: "/lessons/", packId: "pinsel", packVersion: "1", rendererId: "pinsel-zfb", rendererVersion: "1", rendererDigest: "b".repeat(64) };
describe("host document renderer", () => {
  it("retains mapped ownership and slot hierarchy without feeding a component into zudo-react", async () => {
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

it("restores production Location before host scripts and preserves complete visitor URLs", async () => {
  const { JSDOM } = await import("jsdom");
  const visitorUrl = "/lessons/?course=consultation#pricing";
  const preview = await renderHostDocument({ renderDocument: () => '<html><head><script>window.observed=[location.pathname,location.search,location.hash];</script></head><body>Host</body></html>' }, route, identity, undefined, { url: visitorUrl, pathnames: ["/lessons/", "/contact/"] });
  const dom = new JSDOM(preview.html, { url: "http://localhost:4000/lessons/?course=consultation&__zudo_host_document=token#pricing", runScripts: "dangerously" });
  try {
    expect((dom.window as unknown as { observed: string[] }).observed).toEqual(["/lessons/", "?course=consultation", "#pricing"]);
    expect(dom.window.document.querySelector('meta[name="zudo-host-document-frame"]')?.getAttribute("content")).toBe(preview.frameId);
    expect(preview.navigation?.url).toBe(visitorUrl);
  } finally { dom.window.close(); }
  await expect(renderHostDocument({ renderDocument: () => "" }, route, identity, undefined, { url: "//foreign.test/lessons/", pathnames: ["/lessons/"] })).rejects.toThrow("captured route");
});

it("bridges known Browse links with query/hash, retains native fragments and revokes external navigation", async () => {
  const preview = await renderHostDocument({ renderDocument: () => "<html><head></head><body></body></html>" }, { ...route, pathname: "/lessons" }, { ...identity, pathname: "/lessons" }, undefined, { url: "/lessons/?course=old", pathnames: ["/lessons", "/contact"] });
  const scripts = [...preview.html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const script = scripts.at(-1)![1]!;
  const posted: unknown[] = [];
  const parent = { location: { origin: "http://localhost:4000" }, postMessage: (value: unknown) => posted.push(value) };
  const listeners: Record<string, (event?: unknown) => void> = {};
  let click!: (event: unknown) => void;
  const location = new URL("http://localhost:4000/lessons/?course=old");
  class Element { constructor(readonly href: string) {} target = ""; hasAttribute() { return false; } closest() { return this; } }
  const document = { readyState: "complete", querySelector: () => null, addEventListener: (_name: string, listener: typeof click) => { click = listener; } };
  const history = { pushState(_data: unknown, _title: string, href: string) { location.href = new URL(href, location).href; }, replaceState(_data: unknown, _title: string, href: string) { location.href = new URL(href, location).href; } };
  runInNewContext(script, { parent, document, location, URL, Element, history, addEventListener: (name: string, callback: (event?: unknown) => void) => { listeners[name] = callback; } });
  listeners.message!({ source: parent, origin: parent.location.origin, data: { protocol: "zudo-host-document-v1", frameId: preview.frameId, type: "mode", selecting: false } });
  const follow = (href: string) => {
    let prevented = false;
    click({ target: new Element(href), button: 0, preventDefault() { prevented = true; }, stopImmediatePropagation() {} });
    return prevented;
  };
  expect(follow("/contact/?course=stable-id#inquiry")).toBe(true);
  expect(posted.at(-1)).toMatchObject({ type: "navigate", visitorUrl: "/lessons/?course=old", url: "/contact/?course=stable-id#inquiry", identity: { ...identity, pathname: "/lessons" }, frameId: preview.frameId });
  const count = posted.length;
  expect(follow("#pricing")).toBe(false); expect(posted).toHaveLength(count);
  location.hash = "#pricing"; listeners.hashchange!();
  expect(posted.at(-1)).toMatchObject({ type: "navigate", visitorUrl: "/lessons/?course=old", url: "/lessons/?course=old#pricing" });
  history.pushState(null, "", "/contact/?course=changed#inquiry");
  expect(posted.at(-1)).toMatchObject({ type: "navigate", visitorUrl: "/lessons/?course=old#pricing", url: "/contact/?course=changed#inquiry" });
  listeners.message!({ source: parent, origin: parent.location.origin, data: authoringProbeMessage(identity, "a".repeat(64)) });
  expect(posted.at(-1)).toMatchObject({ type: "authoring-settled", clean: false });
  history.replaceState(null, "", "/not-captured/"); expect(posted.at(-1)).toMatchObject({ type: "leaving" });
  expect(follow("https://outside.test/")).toBe(false); expect(posted.at(-1)).toMatchObject({ type: "leaving" });
});
