import { render, settleTasks, waitFor } from "../../../../test/render";
import { getScope, signal } from "@takazudo/zfb/zudo-react";
import { describe, expect, it, vi } from "vitest";
import { notifyPersistenceChange } from "../../../../shared/persistence-generation";
import { providerFixture, PNG } from "../../../assets/__tests__/versioned-fixture";
import { activeComponentProvider } from "../../active-pack";
import { CompositionPreviewHost } from "../composition-preview-host";
import type { CompositionDocument } from "../../../../composer/model/types";
import { assetResolvedPreviewSnapshot, resolvePreviewAssetSnapshot } from "../assets-snapshot";
import { LiveAssetReferenceResolver } from "../../../../assets/references";
import { localPreviewSnapshot } from "../protocol";
describe("host-only draft Asset resolution", () => {
  it("preserves already pinned output without requiring a mutable provider", async () => {
    const href = `/uploaded-assets/sha256-${"a".repeat(64)}.png`;
    const document: CompositionDocument = { schemaVersion: 2, id: "preview", name: "Preview", root: [{ id: "link", componentId: "ui.cta-button", componentVersion: 1, props: { href, children: "Download" }, slots: {} }] };
    const resolver = new LiveAssetReferenceResolver(undefined), resolve = vi.spyOn(resolver, "resolve");
    expect((await resolvePreviewAssetSnapshot(localPreviewSnapshot(document, document.id), activeComponentProvider.catalog, resolver)).status).toBe("ready");
    expect(resolve).not.toHaveBeenCalled();
  });
  it.each(["/uploaded-assets/asset-bad?query", "raw /uploaded-assets/asset-asset"])("never sends malformed or unsupported managed text: %s", async (href) => {
    const { provider } = await providerFixture();
    const document: CompositionDocument = { schemaVersion: 2, id: "preview", name: "Preview", root: [{ id: "link", componentId: "ui.cta-button", componentVersion: 1, props: { href, children: "Download" }, slots: {} }] };
    const send = vi.fn(), error = vi.fn();
    const view = render(<CompositionPreviewHost componentProvider={activeComponentProvider} assetStore={provider.store} document={document} onError={error} createBridge={(() => ({ ready: true, render: send, dispose() {}, updateSession() {} })) as never} location={{ src: "/composer/preview", targetOrigin: "https://example.test" }} hostWindow={{ addEventListener() {}, removeEventListener() {} }} />);
    await waitFor(() => expect(error).toHaveBeenCalled());
    expect(send).not.toHaveBeenCalled();
    expect(view.container.querySelector("iframe")?.style.display).toBe("none");
  });
  it("sends immutable URLs and refreshes after replacement without editing authoring JSON", async () => {
    const { provider, filesystem } = await providerFixture();
    const record = await filesystem.upload({ fileName: "preview.png", declaredMimeType: "image/png", bytes: PNG });
    const document: CompositionDocument = { schemaVersion: 2, id: "preview", name: "Preview", root: [{ id: "link", componentId: "ui.cta-button", componentVersion: 1, props: { href: `/uploaded-assets/asset-${record.id}`, children: "Download" }, slots: {} }] };
    const renderSnapshot = vi.fn(); const createBridge = vi.fn(() => ({ ready: true, render: renderSnapshot, dispose: vi.fn(), updateSession: vi.fn() }));
    render(<CompositionPreviewHost componentProvider={activeComponentProvider} assetStore={provider.store} document={document} createBridge={createBridge as never} location={{ src: "/composer/preview", targetOrigin: "https://example.test" }} hostWindow={{ addEventListener() {}, removeEventListener() {} }} />);
    await waitFor(() => expect(renderSnapshot).toHaveBeenCalledWith(expect.objectContaining({ document: expect.objectContaining({ root: [expect.objectContaining({ props: expect.objectContaining({ href: record.document.versions[0]!.url }) })] }) }), expect.anything()));
    const next = await filesystem.replace(record.id, { bytes: new Uint8Array([...PNG, 9]) }, { expectedRevision: record.revision });
    notifyPersistenceChange("assets");
    await waitFor(() => expect(renderSnapshot.mock.lastCall?.[0].document.root[0].props.href).toBe(next.document.versions.at(-1)!.url));
    expect(document.root[0]!.props.href).toBe(`/uploaded-assets/asset-${record.id}`);
  });
  it("subscribes to Asset changes once per managed span, not once per snapshot", async () => {
    const { provider, filesystem } = await providerFixture();
    const record = await filesystem.upload({ fileName: "preview.png", declaredMimeType: "image/png", bytes: PNG });
    const documentFor = (label: string): CompositionDocument => ({ schemaVersion: 2, id: "preview", name: "Preview", root: [{ id: "link", componentId: "ui.cta-button", componentVersion: 1, props: { href: `/uploaded-assets/asset-${record.id}`, children: label }, slots: {} }] });
    const plain: CompositionDocument = { schemaVersion: 2, id: "preview", name: "Preview", root: [{ id: "link", componentId: "ui.cta-button", componentVersion: 1, props: { href: "https://example.test/", children: "Plain" }, slots: {} }] };
    const unsubscribe = vi.fn();
    const original = LiveAssetReferenceResolver.prototype.subscribeChanges;
    const subscribe = vi.spyOn(LiveAssetReferenceResolver.prototype, "subscribeChanges").mockImplementation(function (this: LiveAssetReferenceResolver, listener) {
      const stop = original.call(this, listener);
      return () => { unsubscribe(); stop(); };
    });
    try {
      const snapshot = signal(localPreviewSnapshot(documentFor("One"), "preview"));
      const results: boolean[] = [];
      function Probe() {
        const resolved = assetResolvedPreviewSnapshot(getScope(), snapshot, activeComponentProvider.catalog, { store: provider.store });
        getScope().effect(() => { results.push(resolved.value.loading); });
        return null;
      }
      const view = render(<Probe />);
      await settleTasks();
      for (const label of ["Two", "Three", "Four"]) { snapshot.value = localPreviewSnapshot(documentFor(label), "preview"); await settleTasks(); }
      expect(subscribe).toHaveBeenCalledTimes(1);
      expect(unsubscribe).not.toHaveBeenCalled();
      snapshot.value = localPreviewSnapshot(plain, "preview"); await settleTasks();
      expect(unsubscribe).toHaveBeenCalledTimes(1);
      snapshot.value = localPreviewSnapshot(documentFor("Five"), "preview"); await settleTasks();
      expect(subscribe).toHaveBeenCalledTimes(2);
      view.unmount();
      expect(unsubscribe).toHaveBeenCalledTimes(2);
      expect(results.length).toBeGreaterThan(0);
    } finally {
      subscribe.mockRestore();
    }
  });
});
