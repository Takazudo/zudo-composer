import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../App";
import type { ProductionProviderIntegration } from "../provider-integration";
import { createWorkspaceSaveRegistry } from "../workspace-sessions";

vi.mock("../provider-integration", () => ({ createProductionProviderIntegration: () => { throw new Error("Inject the test workspace."); } }));
vi.mock("../dashboard", async () => {
  const { useWorkspace } = await import("../workspace-context");
  return { Dashboard: () => { const workspace = useWorkspace()!; return <main><h1>Workspace {workspace.integration.workspace.id}</h1><input aria-label="Draft" defaultValue="draft" /><button onClick={() => void workspace.reset()}>Reset workspace</button></main>; } };
});
vi.mock("../workspace-summary", () => ({ createWorkspaceSummary: () => ({ counts: async () => ({ content: { status: "unavailable" }, compositions: { status: "unavailable" }, mappings: { status: "unavailable" }, sitemaps: { status: "unavailable" }, media: { status: "absent" } }), dispose: () => undefined }) }));
vi.mock("../../features/composer/chrome/composer-app", () => ({ default: () => <h1>Composition editor</h1> }));
vi.mock("../../features/content", () => ({ ContentRouteContent: () => <h1>Content editor</h1> }));
vi.mock("../../features/mapping", () => ({ MappingRouteContent: () => <h1>Mapping editor</h1> }));
vi.mock("../../features/media", () => ({ MediaRouteContent: () => <h1>Media editor</h1> }));
vi.mock("../../features/sitemapper", () => ({ SitemapperRouteContent: () => <h1>Sitemap editor</h1> }));
vi.mock("../../features/delivery/site-delivery", () => ({ SiteDelivery: () => <h1>Visitor website</h1> }));
function workspace(id = "one") {
  return {
    sessions: createWorkspaceSaveRegistry(),
    workspace: { id, reset: vi.fn(), open: vi.fn() },
    initialization: { initialize: vi.fn(async () => ({ status: "ready" })), retry: vi.fn(async () => ({ status: "ready" })) },
    subscribeChanges: () => () => undefined,
    compositionProviders: [{ descriptor: { id: "indexeddb" } }], contentProviders: [{ descriptor: { id: "content-indexeddb" } }],
    mappingProviders: [{ descriptor: { id: "mapping-indexeddb" } }], sitemapProvider: { descriptor: { id: "sitemap-indexeddb" } },
    contentCatalog: { listModels: async () => ({ entries: [], failures: [] }) }, compositionCatalog: { listCompositions: async () => ({ entries: [], failures: [] }) },
  };
}
afterEach(() => { cleanup(); localStorage.clear(); window.history.replaceState(null, "", "/"); });
describe("application workspace lifetime", () => {
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
