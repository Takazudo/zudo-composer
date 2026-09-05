import { describe, expect, it } from "vitest";
import { createComponentCatalog } from "../../../composer/model/types";
import { componentCatalog, project, entry } from "../../compiler/__tests__/fixtures";
import { resolveSiteProjectMedia } from "../impact";
import { compileSiteProject } from "../../compiler";
import { createMediaRecord, mediaVersionUrl } from "../../../media";
import type { MediaReferenceLock } from "../../../media/references";
const checksum = "a".repeat(64);
const catalog = createComponentCatalog({ kind: "zudo-composer/component-pack", contractVersion: 2, packId: "test", packVersion: "1", components: [{ ...componentCatalog.get("leaf")!, fields: [
  { prop: "title", label: "Title", schema: { type: "string" }, editor: { kind: "text" } },
  { prop: "href", label: "Link", schema: { type: "string" }, editor: { kind: "text" } },
  { prop: "body", label: "Markdown", schema: { type: "string" }, editor: { kind: "text", mode: "markdown-source" } },
  { prop: "cards", label: "Cards", schema: { type: "array", items: { schema: { type: "object", fields: [{ key: "src", label: "Image", schema: { type: "string" }, editor: { kind: "text" } }] }, editor: { kind: "group" } } }, editor: { kind: "list" } },
] }] });
const lock: MediaReferenceLock = { schemaVersion: 1, providerId: "media-files", mutationToken: "b".repeat(64), pins: [{ providerId: "media-files", assetId: "asset", versionId: checksum, checksum, mediaType: "image/png", byteLength: 12, url: mediaVersionUrl(checksum, "image/png"), metadataRevision: 1, headVersionId: checksum }] };
describe("provider-qualified media impact", () => {
  it("indexes typed Content and nested declared props, preserving arbitrary text and external URLs", () => {
    const value = project(); const model = value.providers.content[0]!.models[0]!;
    model.document.fields.push({ id: "hero", key: "hero", label: "Hero", required: false, kind: "media-use", use: "image" });
    const record = entry("one"); record.values.hero = { kind: "image", asset: { providerId: "media-files", assetId: "asset" }, alt: "Context", decorative: false, caption: "" }; value.providers.content[0]!.entries.push(record);
    const props = value.providers.compositions[0]!.records[0]!.document.root[0]!.props;
    props.href = "/uploaded-media/asset-asset"; props.body = "![image](/uploaded-media/asset-asset) [external](https://example.com/external)";
    props.cards = [{ src: "/uploaded-media/asset-asset" }]; props.title = "ordinary text /uploaded-media/asset-asset";
    const result = resolveSiteProjectMedia(value, catalog, { lock });
    expect(result.index.references).toHaveLength(4); expect(result.index.complete).toBe(false);
    expect(result.index.references).toContainEqual(expect.objectContaining({ location: expect.objectContaining({ domain: "content", providerId: "content-indexeddb", recordId: "one", fieldId: "hero", valuePath: ["asset"] }) }));
    const output = result.project.providers.compositions[0]!.records[0]!.document.root[0]!.props;
    expect(output.href).toBe(lock.pins[0]!.url); expect(output.title).toBe(props.title); expect(output.body).toContain("https://example.com/external");
    expect(props.href).toBe("/uploaded-media/asset-asset");
  });
  it("requires a lock for managed release output and pins supported properties without latest lookups", async () => {
    const value = project(); value.providers.compositions[0]!.records[0]!.document.root[0]!.props.href = "/uploaded-media/asset-asset";
    expect((await compileSiteProject(value, { componentCatalog: catalog })).status).toBe("blocked");
    const result = await compileSiteProject(value, { componentCatalog: catalog, mediaLock: lock });
    expect(result.status).toBe("ready"); if (result.status !== "ready") return;
    expect(result.build.routes[0]!.composition.document.root[0]!.props.href).toBe(lock.pins[0]!.url);
    const media = createMediaRecord({ fileName: "image.png", checksum, byteLength: 12, mediaType: "image/png" }, { id: "asset" });
    const index = resolveSiteProjectMedia(value, catalog, { snapshot: { schemaVersion: 2, mutationToken: "b".repeat(64), folders: [], records: [media] }, routes: result.build.routes }).index;
    expect(index.references.some(({ location }) => location.domain === "materialization" && location.pathname === "/")).toBe(true);
    const rendered = result.build.routes[0]!;
    rendered.materializationSources = [{ renderedNodeId: rendered.composition.document.root[0]!.id, providerId: "indexeddb", recordId: "card-source", nodeId: "original-link", attachmentId: "cards", entries: [{ providerId: "content-indexeddb", modelId: "articles", recordId: "one" }] }];
    const mapped = resolveSiteProjectMedia(value, catalog, { lock, routes: [rendered] }).index.references.find(({ location }) => location.domain === "materialization")!;
    expect(mapped.location).toMatchObject({ recordId: "card-source", nodeId: "original-link", attachmentId: "cards", entries: [{ recordId: "one" }] });
  });
});
