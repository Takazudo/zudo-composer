import { cleanup, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, describe, expect, it } from "vitest";
import ts from "typescript";
import { ProseMd } from "@zudo-sg/ui";
import { h, Fragment } from "preact";
import { render as renderToString } from "preact-render-to-string";
import { activeComponentProvider } from "../../composer/active-pack";
import { DeliveryRuntime } from "../runtime";
import { project, model, entry, composition, mapping, page, mappingSource } from "../../../site-project/compiler/__tests__/fixtures";
import { resolveCompositionAsset } from "../../../site-project/assets/impact";
import { captureSiteProjectAssetLock } from "../../../site-project/assets/capture";
import { compileWithCapturedAsset } from "../../../site-project/assets/compile";
import { createProjectAssetUsageInspection } from "../../../site-project/assets/usage";
import { compileSiteProject } from "../../../site-project/compiler";
import { assetDownloadMarkdown, assetDownloadBlocks, splitAssetDownloadMarkdown } from "../../../assets/integration/download";
import { resolvePreviewAssetSnapshot } from "../../composer/preview/assets-snapshot";
import { LiveAssetReferenceResolver } from "../../../assets/references";
import { providerFixture } from "../../assets/__tests__/versioned-fixture";
import { generateJsx } from "../../../composer/source/generate-jsx";
import { CompositionCanvas } from "../../composer/preview/renderer";

const ZIP = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, ...Array(18).fill(0)]);
afterEach(cleanup);

function downloadProject(assetId: string, providerId: string) {
  const contentModel = model("single");
  contentModel.document.fields.push({ id: "download", key: "download", label: "Download", required: true, kind: "asset-use", use: "download" });
  const record = entry("resource");
  record.values.download = { kind: "download", asset: { providerId, assetId }, label: 'Get <archive> & "files"', showSize: true, showType: true };
  const target = composition("landing"); target.document.root = [{ id: "prose", componentId: "ui.prose-md", componentVersion: 1, props: { markdown: "" }, slots: {} }];
  const map = mapping(); map.document.bindings = [{ id: "download", sourceFieldId: "download", projection: { kind: "asset-download" }, target: { nodeId: "prose", prop: "markdown" }, transform: { kind: "identity" } }];
  const value = project({ contentModel, entries: [record], compositions: [target], mappings: [map], root: page("home", undefined, mappingSource("single")) });
  const { packId, packVersion, contractVersion } = activeComponentProvider.manifest; value.componentPack = { packId, packVersion, contractVersion };
  return value;
}

describe("managed downloads in the stock Markdown component", () => {
  it("maps, captures, delivers and exports native download links with frozen display metadata", async () => {
    const { filesystem, provider } = await providerFixture();
    const asset = await filesystem.upload({ fileName: '資料 & "files".zip', bytes: ZIP, declaredMimeType: "application/zip" });
    const value = downloadProject(asset.id, provider.descriptor.id);
    const catalog = activeComponentProvider.catalog;
    const captured = await captureSiteProjectAssetLock(value, catalog, provider.store);
    expect(captured.status).toBe("ready"); if (captured.status !== "ready" || !captured.lock) throw new Error(JSON.stringify(captured));
    expect(captured.lock.pins[0]!.fileName).toBe(asset.document.fileName);
    const compilation = await compileWithCapturedAsset(value, { catalog, assetStore: provider.store });
    expect(compilation.status).toBe("ready"); if (compilation.status !== "ready") throw new Error(JSON.stringify(compilation));
    const route = compilation.build.routes[0]!;
    const capturedMarkdown = String(route.composition.document.root[0]!.props.markdown);
    const block = assetDownloadBlocks(capturedMarkdown)[0]!.block!;
    const forgedDocument = structuredClone(route.composition.document);
    forgedDocument.root[0]!.props.markdown = assetDownloadMarkdown(block.use, { ...block.resolved!, fileName: "wrong.zip", byteLength: 99 });
    expect(resolveCompositionAsset(forgedDocument, catalog, { lock: captured.lock }).document.root[0]!.props.markdown).toBe(capturedMarkdown);
    const legacyLock = structuredClone(captured.lock); delete legacyLock.pins[0]!.fileName;
    expect((await compileSiteProject(value, { componentCatalog: catalog, assetLock: legacyLock })).status).toBe("blocked");
    render(<DeliveryRuntime composition={route.composition} pack={activeComponentProvider.pack} />);
    const anchor = screen.getByRole("link", { name: 'Get <archive> & "files" · ZIP · 22 B' });
    expect(anchor).toHaveAttribute("href", asset.document.versions[0]!.url);
    expect(anchor).toHaveAttribute("download", asset.document.fileName);
    expect(anchor.outerHTML).toContain('&amp;'); expect(anchor.outerHTML).toContain('&quot;'); expect(anchor.outerHTML).not.toContain('.zip.zip');
    const generated = generateJsx(route.composition.document, catalog, { componentName: "Composition" });
    expect(generated.ok).toBe(true); expect(generated.code).toContain("<a onClick="); expect(generated.code).toContain("download=");
    // Execute the exported JSX with its real pack import. It contains no runtime asset lookups.
    const js = ts.transpileModule(generated.code, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, jsxFactory: "h", jsxFragmentFactory: "Fragment" } }).outputText;
    const exported = { exports: {} as { Composition(): ReturnType<typeof h> } };
    new Function("require", "module", "exports", "h", "Fragment", js)(() => ({ ProseMd }), exported, exported.exports, h, Fragment);
    const html = renderToString(exported.exports.Composition());
    expect(html).toContain('download="資料 &amp; &quot;files&quot;.zip"');
    expect(html).toContain(asset.document.versions[0]!.url);
    const inspection = await createProjectAssetUsageInspection({ readProject: async () => value, catalog, assetStore: provider.store }).read();
    expect(inspection.index.complete).toBe(true); expect(inspection.index.references.some(({ location }) => location.domain === "materialization")).toBe(true);
    await filesystem.updateMetadata(asset.id, { fileName: "renamed.zip" }, { expectedRevision: asset.revision });
    await filesystem.replace(asset.id, { bytes: Uint8Array.from([...ZIP, 1]) }, { expectedRevision: asset.revision + 1 });
    const historical = await compileSiteProject(value, { componentCatalog: catalog, assetLock: captured.lock });
    expect(historical.status).toBe("ready");
    if (historical.status === "ready") expect(historical.build.routes[0]!.composition.document.root[0]!.props.markdown).toBe(route.composition.document.root[0]!.props.markdown);
    const latest = await compileWithCapturedAsset(value, { catalog, assetStore: provider.store });
    expect(latest.status).toBe("ready");
    if (latest.status === "ready") {
      const latestBlock = assetDownloadBlocks(String(latest.build.routes[0]!.composition.document.root[0]!.props.markdown))[0]!.block!;
      expect(latestBlock.resolved).toMatchObject({ fileName: "renamed.zip", byteLength: 23 });
      expect(latestBlock.resolved!.url).not.toBe(block.resolved!.url);
    }
  });

  it("keeps prose and links in stock preview, refuses forged URLs, and treats code literally", async () => {
    const { filesystem, provider } = await providerFixture();
    const asset = await filesystem.upload({ fileName: "bundle.zip", bytes: ZIP, declaredMimeType: "application/zip" });
    const use = { kind: "download" as const, asset: { providerId: provider.descriptor.id, assetId: asset.id }, label: "Get bundle", showSize: false, showType: false };
    const token = assetDownloadMarkdown(use);
    expect(assetDownloadBlocks(token)).toHaveLength(1);
    expect(assetDownloadBlocks(`${token}\n\n${token}`)).toHaveLength(2);
    const plain = composition("unresolved").document;
    plain.root = [{ id: "prose", componentId: "ui.prose-md", componentVersion: 1, props: { markdown: token }, slots: {} }];
    expect(generateJsx(plain, activeComponentProvider.catalog)).toMatchObject({ ok: false, blocked: true, code: "" });
    plain.root[0]!.props.markdown = "<!--zudo-asset-download:invalid-->";
    expect(generateJsx(plain, activeComponentProvider.catalog)).toMatchObject({ ok: false, blocked: true, code: "" });
    expect(assetDownloadBlocks("```html\n" + token + "\n```")).toEqual([]);
    const doc = composition("preview").document; doc.root = [{ id: "prose", componentId: "ui.prose-md", componentVersion: 1, props: { markdown: `Before **download** [reference][resource]\n\n${token}\n\nAfter download\n\n[resource]: https://example.com/resource` }, slots: {} }];
    const result = await resolvePreviewAssetSnapshot({ document: doc } as Parameters<typeof resolvePreviewAssetSnapshot>[0], activeComponentProvider.catalog, new LiveAssetReferenceResolver(provider.store));
    expect(result.status).toBe("ready"); if (result.status !== "ready") throw new Error(result.message);
    const baseline = render(<ProseMd markdown={"Before **download** [reference][resource]\n\n[resource]: https://example.com/resource"} />);
    await waitFor(() => expect(baseline.container.querySelector("strong")).toBeInTheDocument());
    const baselineHtml = baseline.container.firstElementChild!.innerHTML;
    baseline.unmount();
    const canvas = render(<CompositionCanvas document={result.snapshot.document} localRecordId="preview" provider={activeComponentProvider} session={{ mode: "preview", theme: "light", selectedId: null }} onSelect={() => undefined} onRequestAdd={() => undefined} onRequestNodeMenu={() => undefined} onRequestInsertMenu={() => undefined} />);
    expect(screen.getByRole("link", { name: "Get bundle" })).toHaveAttribute("download", "bundle.zip");
    await waitFor(() => expect(screen.getByText("After download")).toBeInTheDocument());
    expect(canvas.container.querySelector("strong")!.parentElement!.parentElement!.innerHTML).toBe(baselineHtml);
    const resolved = { url: "javascript:alert(1)", fileName: "bundle.zip", mimeType: "application/zip", byteLength: 22 };
    expect(splitAssetDownloadMarkdown(assetDownloadMarkdown(use, resolved)).every((part) => "markdown" in part)).toBe(true);
    doc.root[0]!.props.markdown = assetDownloadMarkdown(use, resolved);
    const blocked = await resolvePreviewAssetSnapshot({ document: doc } as Parameters<typeof resolvePreviewAssetSnapshot>[0], activeComponentProvider.catalog, new LiveAssetReferenceResolver(provider.store));
    expect(blocked.status).toBe("blocked");
  });
});
