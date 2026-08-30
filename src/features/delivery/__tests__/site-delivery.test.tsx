import { createHash } from "node:crypto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProductionProviderIntegration, ProviderIntegrationError, type ProductionProviderIntegration } from "../../../app/provider-integration";
import { activeComponentProvider } from "../../composer/active-pack";
import { loadSampleSiteProject } from "../../../site-project/sample";
import { serializeSiteProject } from "../../../site-project/model/canonical";
import { SiteDelivery } from "../site-delivery";

afterEach(cleanup);
const sample = () => loadSampleSiteProject({ componentPack: activeComponentProvider.manifest });
const revision = (project: ReturnType<typeof sample>) => createHash("sha256").update(serializeSiteProject(project), "utf8").digest("hex");
function fixture(project = sample()): ProductionProviderIntegration {
  return { componentProvider: activeComponentProvider, getCurrentSiteProject: vi.fn(async () => ({ status: "ready" as const, project: structuredClone(project) })) } as unknown as ProductionProviderIntegration;
}

describe("SiteDelivery", () => {
  it.each([
    ["/site", "Clear ideas, carefully shaped"],
    ["/site/services", "Ways to work together"],
    ["/site/about", "A studio built around useful clarity"],
    ["/site/journal/start-with-the-question", "Start with the question"],
    ["/site/journal/map-the-moving-parts", "Map the moving parts"],
    ["/site/journal/review-in-small-loops", "Review in small loops"],
  ])("renders the coherent evaluated route at %s", async (pathname, heading) => {
    const providers = fixture(); render(<SiteDelivery providers={providers} pathname={pathname} />);
    expect(screen.getByRole("heading", { name: "Loading site" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
    expect(providers.getCurrentSiteProject).toHaveBeenCalledTimes(1);
  });

  it("renders Sitemap navigation, collection breadcrumbs, footer, and not-found", async () => {
    const providers = fixture(); render(<SiteDelivery providers={providers} pathname="/site/journal/start-with-the-question" />);
    await screen.findByRole("heading", { name: "Start with the question" });
    expect(screen.getByRole("navigation", { name: "Primary navigation" }).querySelectorAll("a")).toHaveLength(4);
    expect(screen.getByRole("navigation", { name: "Primary navigation" }).querySelector('[aria-current="page"]')).toBeNull();
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toHaveTextContent("HomeJournalStart with the question");
    expect(screen.getByRole("navigation", { name: "Footer navigation" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Skip to main content" })).toHaveAttribute("href", "#main-content");
    await waitFor(() => expect(document.title).toBe("Start with the question — Sample Studio"));
    cleanup(); render(<SiteDelivery providers={providers} pathname="/site/missing" />);
    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Return to site home" })).toHaveAttribute("href", "/site");
    await waitFor(() => expect(document.title).toBe("Page not found — Sample Studio"));
  });

  it("links every generated journal entry from the journal index", async () => {
    render(<SiteDelivery providers={fixture()} pathname="/site/journal" />);
    await screen.findByRole("heading", { name: "Working notes" });
    expect(screen.getByRole("link", { name: "Read Start with the question" })).toHaveAttribute("href", "/site/journal/start-with-the-question");
    expect(screen.getByRole("link", { name: "Read Map the moving parts" })).toHaveAttribute("href", "/site/journal/map-the-moving-parts");
    expect(screen.getByRole("link", { name: "Read Review in small loops" })).toHaveAttribute("href", "/site/journal/review-in-small-loops");
  });

  it("fails closed for provider, validation, and compiler errors without a seed fallback", async () => {
    const unavailable = { componentProvider: activeComponentProvider, getCurrentSiteProject: vi.fn(async () => ({ status: "error" as const, error: new ProviderIntegrationError("snapshot", "offline") })) } as unknown as ProductionProviderIntegration;
    render(<SiteDelivery providers={unavailable} pathname="/site" />);
    expect(await screen.findByRole("heading", { name: "Site unavailable" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    await waitFor(() => expect(document.title).toBe("Site unavailable — Site delivery"));
    expect(screen.queryByText("Clear ideas, carefully shaped")).not.toBeInTheDocument();
    cleanup();
    const invalid = sample(); invalid.componentPack.packVersion = "wrong";
    render(<SiteDelivery providers={fixture(invalid)} pathname="/site" />);
    expect(await screen.findByRole("heading", { name: "Site data blocked" })).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("Site data blocked — Site delivery"));
    cleanup();
    const blocked = sample(); blocked.providers.sitemaps[0]!.records[0]!.document.root[0]!.children[1]!.source = { kind: "unassigned" };
    render(<SiteDelivery providers={fixture(blocked)} pathname="/site" />);
    expect(await screen.findByRole("heading", { name: "Site build blocked" })).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("Site build blocked — Site delivery"));
  });

  it("retries a retryable provider failure and renders the recovered route", async () => {
    const project = sample();
    const getCurrentSiteProject = vi.fn()
      .mockResolvedValueOnce({ status: "error" as const, error: new ProviderIntegrationError("snapshot", "temporary", true) })
      .mockResolvedValueOnce({ status: "ready" as const, project });
    const retry = vi.fn(async () => ({ status: "ready" as const }));
    const providers = { componentProvider: activeComponentProvider, getCurrentSiteProject, initialization: { retry } } as unknown as ProductionProviderIntegration;
    render(<SiteDelivery providers={providers} pathname="/site" />);
    const retryButton = await screen.findByRole("button", { name: "Retry loading site" });
    fireEvent.click(retryButton);
    expect(await screen.findByRole("heading", { name: "Clear ideas, carefully shaped" })).toBeInTheDocument();
    expect(retry).toHaveBeenCalledTimes(1);
    expect(getCurrentSiteProject).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById("main-content")));
  });

  it("announces and focuses a provider error that remains after retry", async () => {
    const getCurrentSiteProject = vi.fn(async () => ({ status: "error" as const, error: new ProviderIntegrationError("snapshot", "temporary", true) }));
    const retry = vi.fn(async () => ({ status: "error" as const, error: new ProviderIntegrationError("snapshot", "still offline", true) }));
    const providers = { componentProvider: activeComponentProvider, getCurrentSiteProject, initialization: { retry } } as unknown as ProductionProviderIntegration;
    render(<SiteDelivery providers={providers} pathname="/site" />);
    fireEvent.click(await screen.findByRole("button", { name: "Retry loading site" }));
    expect(await screen.findByText(/still offline/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    await waitFor(() => expect(document.activeElement).toBe(document.querySelector("[data-site-delivery-state]")));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("reads a new provider snapshot after remount and shows a persisted Content edit", async () => {
    const idb = new IDBFactory();
    const project = sample();
    const providers = createProductionProviderIntegration({ project, sourceRevision: revision(project), compositionIdbFactory: idb, contentIdbFactory: idb, mappingIdbFactory: idb, sitemapIdbFactory: idb });
    render(<SiteDelivery providers={providers} pathname="/site/about" />);
    expect(await screen.findByRole("heading", { name: "A studio built around useful clarity" })).toBeInTheDocument();
    const loaded = await providers.contentProvider.store.getEntry("about-entry");
    if (loaded.status !== "loaded") throw new Error("seed entry unavailable");
    await providers.contentProvider.store.putEntry({ ...loaded.record, updatedAt: "2026-08-31T01:00:00.000Z", values: { ...loaded.record.values, "about-heading-field": "Persisted delivery heading" } });
    cleanup(); render(<SiteDelivery providers={providers} pathname="/site/about" />);
    expect(await screen.findByRole("heading", { name: "Persisted delivery heading" })).toBeInTheDocument();
  });
});
