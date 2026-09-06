import { cleanup, render, waitFor } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceContext } from "../../../../app/workspace-context";
import type { ProductionProviderIntegration } from "../../../../app/provider-integration";
import { notifyPersistenceChange } from "../../../../shared/persistence-generation";
import { providerFixture, PNG } from "../../../media/__tests__/versioned-fixture";
import { activeComponentProvider } from "../../active-pack";
import { CompositionPreviewHost } from "../composition-preview-host";
import type { CompositionDocument } from "../../../../composer/model/types";
import { resolvePreviewMediaSnapshot } from "../media-snapshot";
import { LiveMediaReferenceResolver } from "../../../../media/references";
import { localPreviewSnapshot } from "../protocol";
afterEach(cleanup);
describe("host-only draft Media resolution", () => {
  it("preserves already pinned output without requiring a mutable provider", async () => {
    const href = `/uploaded-media/sha256-${"a".repeat(64)}.png`;
    const document: CompositionDocument = { schemaVersion: 2, id: "preview", name: "Preview", root: [{ id: "link", componentId: "ui.cta-button", componentVersion: 1, props: { href, children: "Download" }, slots: {} }] };
    const resolver = new LiveMediaReferenceResolver(undefined), resolve = vi.spyOn(resolver, "resolve");
    expect((await resolvePreviewMediaSnapshot(localPreviewSnapshot(document, document.id), activeComponentProvider.catalog, resolver)).status).toBe("ready");
    expect(resolve).not.toHaveBeenCalled();
  });
  it.each(["/uploaded-media/asset-bad?query", "raw /uploaded-media/asset-asset"])("never sends malformed or unsupported managed text: %s", async (href) => {
    const { provider } = await providerFixture();
    const document: CompositionDocument = { schemaVersion: 2, id: "preview", name: "Preview", root: [{ id: "link", componentId: "ui.cta-button", componentVersion: 1, props: { href, children: "Download" }, slots: {} }] };
    const send = vi.fn(), error = vi.fn();
    const integration = { mediaProvider: provider } as unknown as ProductionProviderIntegration;
    const view = render(<WorkspaceContext.Provider value={{ integration, navigate: async () => true, reset: async () => true, open: async () => true, busy: false, error: null }}><CompositionPreviewHost componentProvider={activeComponentProvider} document={document} onError={error} createBridge={(() => ({ ready: true, render: send, dispose() {}, updateSession() {} })) as never} location={{ src: "/composer/preview", targetOrigin: "https://example.test" }} hostWindow={{ addEventListener() {}, removeEventListener() {} }} /></WorkspaceContext.Provider>);
    await waitFor(() => expect(error).toHaveBeenCalled());
    expect(send).not.toHaveBeenCalled();
    expect(view.container.querySelector("iframe")?.style.display).toBe("none");
  });
  it("sends immutable URLs and refreshes after replacement without editing authoring JSON", async () => {
    const { provider, filesystem } = await providerFixture();
    const record = await filesystem.upload({ fileName: "preview.png", declaredMediaType: "image/png", bytes: PNG });
    const document: CompositionDocument = { schemaVersion: 2, id: "preview", name: "Preview", root: [{ id: "link", componentId: "ui.cta-button", componentVersion: 1, props: { href: `/uploaded-media/asset-${record.id}`, children: "Download" }, slots: {} }] };
    const renderSnapshot = vi.fn(); const createBridge = vi.fn(() => ({ ready: true, render: renderSnapshot, dispose: vi.fn(), updateSession: vi.fn() }));
    const integration = { mediaProvider: provider } as unknown as ProductionProviderIntegration;
    render(<WorkspaceContext.Provider value={{ integration, navigate: async () => true, reset: async () => true, open: async () => true, busy: false, error: null }}><CompositionPreviewHost componentProvider={activeComponentProvider} document={document} createBridge={createBridge as never} location={{ src: "/composer/preview", targetOrigin: "https://example.test" }} hostWindow={{ addEventListener() {}, removeEventListener() {} }} /></WorkspaceContext.Provider>);
    await waitFor(() => expect(renderSnapshot).toHaveBeenCalledWith(expect.objectContaining({ document: expect.objectContaining({ root: [expect.objectContaining({ props: expect.objectContaining({ href: record.document.versions[0]!.url }) })] }) }), expect.anything()));
    const next = await filesystem.replace(record.id, { bytes: new Uint8Array([...PNG, 9]) }, { expectedRevision: record.revision });
    notifyPersistenceChange("media");
    await waitFor(() => expect(renderSnapshot.mock.lastCall?.[0].document.root[0].props.href).toBe(next.document.versions.at(-1)!.url));
    expect(document.root[0]!.props.href).toBe(`/uploaded-media/asset-${record.id}`);
  });
});
