import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../App";
import type { ProductionProviderIntegration } from "../provider-integration";
import { createWorkspaceSaveRegistry } from "../workspace-sessions";
import { harness, mappingRecord } from "../../features/mapping/__tests__/harness";
import { activeComponentProvider } from "../../features/composer/active-pack";
import { createMediaContentServices } from "../../features/media";
import { MediaFieldPicker, MediaRouteContent } from "../../features/media";
import { ContentRouteContent } from "../../features/content";
import { notifyPersistenceChange } from "../../shared/persistence-generation";
import { CONTENT_DATABASE_NAME } from "../../content";
import { COMPOSER_DATABASE_NAME } from "../../composer/storage/indexeddb/types";
import { MAPPING_DATABASE_NAME } from "../../mapping/storage/indexeddb/types";
import { SITEMAPPER_DATABASE_NAME } from "../../sitemapper/storage/indexeddb/types";
import { WORKSPACE_DATABASE_NAME } from "../workspace-storage";
import { workspaceDatabaseName } from "../workspace-storage";
import * as releaseFeature from "../../features/release";

vi.mock("../provider-integration", () => ({ createProductionProviderIntegration: () => { throw new Error("Inject the test workspace."); } }));
vi.mock("../dashboard", async () => {
  const { useWorkspace } = await import("../workspace-context");
  return { Dashboard: () => { const workspace = useWorkspace()!; return <main><h1>Workspace {workspace.integration.workspace.id}</h1><input aria-label="Draft" defaultValue="draft" /><button onClick={() => void workspace.reset()}>Reset workspace</button></main>; } };
});
vi.mock("../workspace-summary", () => ({ createWorkspaceSummary: () => ({ counts: async () => ({ content: { status: "unavailable" }, compositions: { status: "unavailable" }, mappings: { status: "unavailable" }, sitemaps: { status: "unavailable" }, media: { status: "absent" } }), dispose: () => undefined }) }));
vi.mock("../../features/composer/chrome/composer-app", () => ({ default: () => <h1>Composition editor</h1> }));
vi.mock("../../features/content", () => ({ ContentRouteContent: vi.fn(() => <h1>Content editor</h1>) }));
vi.mock("../../features/media", async () => {
  const { createMediaContentServices } = await import("../../media/integration/content");
  return {
    MediaRouteContent: vi.fn(() => <h1>Media editor</h1>),
    MediaFieldPicker: vi.fn(() => <div>Media field picker</div>),
    createMediaContentServices: vi.fn(createMediaContentServices),
  };
});
vi.mock("../../features/sitemapper", () => ({ SitemapperRouteContent: () => <h1>Sitemap editor</h1> }));
vi.mock("../../features/delivery/site-delivery", () => ({ SiteDelivery: () => <h1>Visitor website</h1> }));
function workspace(id = "one") {
  return {
    componentProvider: activeComponentProvider,
    sessions: createWorkspaceSaveRegistry(),
    workspace: { id, reset: vi.fn(), open: vi.fn() },
    initialization: { initialize: vi.fn(async () => ({ status: "ready" })), retry: vi.fn(async () => ({ status: "ready" })) },
    subscribeChanges: () => () => undefined,
    compositionProviders: [{ descriptor: { id: "indexeddb" } }], contentProviders: [{ descriptor: { id: "content-indexeddb" } }],
    mappingProviders: [{ descriptor: { id: "mapping-indexeddb" } }], sitemapProvider: { descriptor: { id: "sitemap-indexeddb" } },
    contentCatalog: { listModels: async () => ({ entries: [], failures: [] }) }, compositionCatalog: { listCompositions: async () => ({ entries: [], failures: [] }) },
  };
}
afterEach(() => { cleanup(); localStorage.clear(); window.history.replaceState(null, "", "/"); vi.clearAllMocks(); });
describe("application workspace lifetime", () => {
  it("holds the shared replacement gate throughout save, open and committed workspace swap", async () => {
    const actual = releaseFeature.createReleaseController; let controller!: ReturnType<typeof actual>;
    const spy = vi.spyOn(releaseFeature, "createReleaseController").mockImplementation((...args) => { controller = actual(...args); return controller; });
    let finishSave!: () => void, finishOpen!: (value: unknown) => void;
    const integration = { ...workspace(), captureWorkspace: vi.fn() };
    integration.sessions.register({ feature: "Pending editor", providerId: "db" }, { flush: () => new Promise<void>((resolve) => { finishSave = resolve; }) });
    integration.workspace.reset.mockImplementation(() => new Promise((resolve) => { finishOpen = resolve; }));
    try {
      render(<App integration={integration as unknown as ProductionProviderIntegration} />); await screen.findByRole("heading", { name: "Workspace one" });
      fireEvent.click(screen.getByRole("button", { name: "Reset workspace" }));
      expect(controller.getSnapshot().gateBlocked).toBe(true); await controller.review(); expect(integration.captureWorkspace).not.toHaveBeenCalled();
      await act(async () => finishSave()); await waitFor(() => expect(integration.workspace.reset).toHaveBeenCalledTimes(1));
      await controller.review(); expect(integration.captureWorkspace).not.toHaveBeenCalled(); expect(controller.getSnapshot().gateBlocked).toBe(true);
      await act(async () => finishOpen(workspace("two"))); await screen.findByRole("heading", { name: "Workspace two" });
      expect(controller.getSnapshot().gateBlocked).toBe(false);
    } finally { spy.mockRestore(); }
  });
  it("adapts Content field picking and exact Media usage locations without feature globals", async () => {
    const mediaProvider = { descriptor: { id: "media-files" } };
    const integration = { ...workspace(), mediaProvider };
    window.history.replaceState(null, "", "/content?provider=content-indexeddb&model=articles");
    render(<App integration={integration as unknown as ProductionProviderIntegration} />);
    await screen.findByRole("heading", { name: "Content editor" });
    const contentProps = vi.mocked(ContentRouteContent).mock.lastCall![0];
    const picker = contentProps.renderMediaPicker!({ kind: "card", onSelect: vi.fn(), onClose: vi.fn() }) as { type: unknown; props: { provider?: unknown; kind: string } };
    expect(picker.type).toBe(MediaFieldPicker);
    expect(picker.props).toMatchObject({ provider: mediaProvider, kind: "card" });

    fireEvent.click(screen.getByRole("link", { name: "Media" }));
    await screen.findByRole("heading", { name: "Media editor" });
    const mediaProps = vi.mocked(MediaRouteContent).mock.lastCall![0];
    expect(mediaProps.usageHref!({ providerId: "content-indexeddb", modelId: "articles", entryId: "entry-1", fieldId: "body", valuePath: ["cards", 2] }))
      .toBe("/content?provider=content-indexeddb&model=articles&entry=entry-1&field=body&path=%2Ff%3Acards%2Fi%3A2");
    expect(mediaProps.usageHref!({ providerId: "content-indexeddb", modelId: "articles", entryId: "entry-1", fieldId: "hero", valuePath: [] }))
      .toBe("/content?provider=content-indexeddb&model=articles&entry=entry-1&field=hero");
  });
  it("invalidates Media usage only for the exact workspace Content database", async () => {
    const integration = workspace();
    render(<App integration={integration as unknown as ProductionProviderIntegration} />);
    await screen.findByRole("heading", { name: "Workspace one" });
    const subscribe = vi.mocked(createMediaContentServices).mock.lastCall![2]!;
    const listener = vi.fn(); const stop = subscribe(listener);
    try {
      notifyPersistenceChange("media");
      notifyPersistenceChange(CONTENT_DATABASE_NAME);
      notifyPersistenceChange(workspaceDatabaseName(CONTENT_DATABASE_NAME, "other"));
      integration.sessions.register({ feature: "Media", providerId: "media-files" }, { flush: async () => undefined }).changed();
      expect(listener).not.toHaveBeenCalled();
      notifyPersistenceChange(workspaceDatabaseName(CONTENT_DATABASE_NAME, "one"));
      for (const database of [COMPOSER_DATABASE_NAME, MAPPING_DATABASE_NAME, SITEMAPPER_DATABASE_NAME]) notifyPersistenceChange(workspaceDatabaseName(database, "one"));
      notifyPersistenceChange(WORKSPACE_DATABASE_NAME); notifyPersistenceChange("compositions:files");
      expect(listener).toHaveBeenCalledTimes(6);
    } finally { stop(); }
    notifyPersistenceChange(workspaceDatabaseName(CONTENT_DATABASE_NAME, "one"));
    expect(listener).toHaveBeenCalledTimes(6);
  });
  it.each(["rail", "portal"])("flushes real Mapping edits before %s navigation and retains failed edits", async (kind) => {
    const record = mappingRecord([]), h = harness([record]);
    const integration = { ...workspace(), mappingProvider: h.provider, mappingProviders: [h.provider], contentCatalog: h.content, mappingCompositionCatalog: h.compositions, mappingContentEntries: h.contentEntries, componentProvider: activeComponentProvider };
    window.history.replaceState(null, "", `/mapping?provider=${h.provider.descriptor.id}&mapping=${record.id}`);
    render(<App integration={integration as unknown as ProductionProviderIntegration} />);
    const name = await screen.findByRole("textbox", { name: "Mapping name" });
    await act(async () => undefined);
    fireEvent.input(name, { target: { value: "Accepted real draft" } }); fireEvent.keyDown(name, { key: "Enter" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());
    const put = vi.spyOn(h.provider.store, "put").mockRejectedValueOnce(new Error("save denied"));
    const follow = async () => {
      if (kind === "rail") fireEvent.click(screen.getByRole("link", { name: "Content" }));
      else {
        fireEvent.click(screen.getByRole("button", { name: "More Mapping actions" }));
        const link = await screen.findByRole("menuitem", { name: "Open in Content" });
        expect(link.closest(".cms-overlay-portal")?.parentElement).toBe(document.body);
        fireEvent.click(link);
      }
    };
    await follow();
    expect(await screen.findByRole("alert")).toHaveTextContent("save denied");
    expect(window.location.pathname).toBe("/mapping"); expect(screen.getByRole("textbox", { name: "Mapping name" })).toBe(name);
    expect(name).toHaveValue("Accepted real draft"); expect(h.records.get(record.id)?.document.name).toBe(record.document.name);
    await follow();
    await screen.findByRole("heading", { name: "Content editor" });
    expect(put).toHaveBeenCalledTimes(2); expect(h.records.get(record.id)?.document.name).toBe("Accepted real draft");
  });

  it("preserves Back/Forward destinations when a save rejects browser traversal", async () => {
    const integration = workspace();
    render(<App integration={integration as unknown as ProductionProviderIntegration} />); await screen.findByRole("heading", { name: "Workspace one" });
    fireEvent.click(screen.getByRole("link", { name: "Media" })); await screen.findByRole("heading", { name: "Media editor" });
    let fail = true;
    integration.sessions.register({ feature: "Media", providerId: "media-files" }, { flush: async () => { if (fail) throw new Error("pending upload failed"); } });
    const length = history.length;
    act(() => history.back());
    expect(await screen.findByRole("alert")).toHaveTextContent("pending upload failed");
    expect(location.pathname).toBe("/media"); expect(history.length).toBe(length);
    fail = false;
    act(() => history.back()); await screen.findByRole("heading", { name: "Workspace one" }); expect(location.pathname).toBe("/");
    act(() => history.forward()); await screen.findByRole("heading", { name: "Media editor" }); expect(location.pathname).toBe("/media");
  });
  it("waits for registered saves before navigation and keeps the editor mounted while waiting", async () => {
    const integration = workspace(); let finish!: () => void;
    integration.sessions.register({ feature: "Content", providerId: "content-indexeddb", recordId: "draft" }, { flush: () => new Promise<void>((resolve) => { finish = resolve; }) });
    render(<App integration={integration as unknown as ProductionProviderIntegration} />);
    await screen.findByRole("heading", { name: "Workspace one" });
    const input = screen.getByRole("textbox");
    fireEvent.click(screen.getByRole("link", { name: "Content" }));
    expect(window.location.pathname).toBe("/"); expect(screen.getByRole("textbox")).toBe(input);
    await act(async () => finish());
    await screen.findByRole("heading", { name: "Content editor" }); expect(window.location.pathname).toBe("/content");
  });
  it("keeps navigation/review on the current route and surfaces provider/record save failure", async () => {
    const integration = workspace();
    integration.sessions.register({ feature: "Content", providerId: "content-indexeddb", recordId: "draft" }, { flush: async () => { throw new Error("disk full"); } });
    render(<App integration={integration as unknown as ProductionProviderIntegration} />); await screen.findByRole("heading", { name: "Workspace one" });
    fireEvent.click(screen.getByRole("link", { name: "Review & release" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Content (content-indexeddb / draft): disk full");
    expect(window.location.pathname).toBe("/"); expect(screen.getByRole("textbox")).toHaveValue("draft");
  });
  it("swaps only a successfully initialized reset replacement and retains the old integration after failure", async () => {
    const original = workspace(), replacement = workspace("two");
    original.workspace.reset.mockRejectedValueOnce(new Error("reset unavailable")).mockResolvedValueOnce(replacement);
    render(<App integration={original as unknown as ProductionProviderIntegration} />); await screen.findByRole("heading", { name: "Workspace one" });
    fireEvent.click(screen.getByRole("button", { name: "Reset workspace" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("reset unavailable"); expect(screen.getByRole("heading", { name: "Workspace one" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reset workspace" }));
    await screen.findByRole("heading", { name: "Workspace two" }); expect(original.workspace.reset).toHaveBeenCalledTimes(2);
    expect(original.initialization.retry).not.toHaveBeenCalled();
  });
  it("rejects an unavailable provider before mounting any record editor", async () => {
    window.history.replaceState(null, "", "/content?provider=other&model=people");
    render(<App integration={workspace() as unknown as ProductionProviderIntegration} />);
    await screen.findByRole("heading", { name: "Invalid workspace link" });
    expect(screen.queryByRole("heading", { name: "Content editor" })).toBeNull();
  });
  it("retries opening without reseeding and exposes explicit reset recovery", async () => {
    const integration = workspace(); integration.initialization.initialize.mockResolvedValue({ status: "error", error: new Error("Reset required") } as never);
    render(<App integration={integration as unknown as ProductionProviderIntegration} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Reset required"); expect(integration.workspace.reset).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Retry opening" }));
    await waitFor(() => expect(integration.initialization.retry).toHaveBeenCalledOnce());
    await screen.findByRole("heading", { name: "Workspace one" }); expect(integration.workspace.reset).not.toHaveBeenCalled();
  });
});
