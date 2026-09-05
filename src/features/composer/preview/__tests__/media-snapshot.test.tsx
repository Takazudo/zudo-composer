import { cleanup, render, waitFor } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceContext } from "../../../../app/workspace-context";
import type { ProductionProviderIntegration } from "../../../../app/provider-integration";
import { notifyPersistenceChange } from "../../../../shared/persistence-generation";
import { providerFixture, PNG } from "../../../media/__tests__/versioned-fixture";
import { activeComponentProvider } from "../../active-pack";
import { CompositionPreviewHost } from "../composition-preview-host";
import type { CompositionDocument } from "../../../../composer/model/types";
afterEach(cleanup);
describe("host-only draft Media resolution", () => {
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
