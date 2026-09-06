import { createHash } from "node:crypto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProductionProviderIntegration, type ProductionProviderIntegration } from "../../../app/provider-integration";
import { activeComponentProvider } from "../../composer/active-pack";
import { loadSampleSiteProject } from "../../../site-project/sample";
import { serializeSiteProject } from "../../../site-project/model/canonical";
import { SiteDelivery, loadWorkingPreviewSnapshot } from "../site-delivery";
import bundledRelease from "../bundled-release.json";
import type { ActivatedDeliverySource, DeliverySourceContract } from "../source";
import { validateActivatedDeliveryArtifact } from "../source";
import { providerFixture, PNG } from "../../media/__tests__/versioned-fixture";

afterEach(cleanup);
const sample = () => loadSampleSiteProject({ componentPack: activeComponentProvider.manifest });
const revision = (project: ReturnType<typeof sample>) => createHash("sha256").update(serializeSiteProject(project), "utf8").digest("hex");
function fixture(project = sample()): ProductionProviderIntegration {
  return { componentProvider: activeComponentProvider, getCurrentSiteProject: vi.fn(async () => ({ status: "ready" as const, project: structuredClone(project) })) } as unknown as ProductionProviderIntegration;
}
const working = (providers: ProductionProviderIntegration): DeliverySourceContract => ({ kind: "working-preview", providers });
const bundled = bundledRelease as unknown as ActivatedDeliverySource;
const activated = (value: ActivatedDeliverySource = bundled): DeliverySourceContract => ({ kind: "activated", componentProvider: activeComponentProvider, read: () => value });

describe("SiteDelivery", () => {
  it("ships one explicit self-contained completed sample with all seven deterministic visitor routes", () => {
    expect(bundled.status).toBe("ready");
    if (bundled.status !== "ready") throw new Error("Bundled fixture missing");
    expect(validateActivatedDeliveryArtifact(bundled.artifact)).toBeUndefined();
    expect(bundled.artifact.kind).toBe("bundled-static");
    expect(bundled.artifact.identity.revision).toBe(revision(sample()));
    expect(bundled.artifact.build.routes.map(({ pathname }) => pathname)).toEqual([
      "/", "/about", "/journal", "/journal/map-the-moving-parts", "/journal/review-in-small-loops", "/journal/start-with-the-question", "/services",
    ]);
    expect(bundled.artifact.build.navigation.primary.map(({ href }) => href)).toEqual(["/", "/about", "/services", "/journal"]);
    expect(bundled.artifact.build.routes.find(({ pathname }) => pathname === "/journal/start-with-the-question")?.ancestors.map(({ pathname }) => pathname)).toEqual(["/", "/journal"]);
    expect(Object.keys(bundled.artifact.files).filter((name) => name.startsWith("module-"))).toHaveLength(8);
  });
  it("captures exact managed Media for visitor output and blocks missing provider or corrupt bytes", async () => {
    const { provider, filesystem } = await providerFixture();
    const asset = await filesystem.upload({ fileName: "download.png", declaredMediaType: "image/png", bytes: PNG });
    const project = sample();
    project.providers.compositions[0]!.records.find(({ id }) => id === "home-page")!.document.root.push({ id: "download", componentId: "ui.cta-button", componentVersion: 1, props: { href: `/uploaded-media/asset-${asset.id}`, children: "Download" }, slots: {} });
    const idb = new IDBFactory();
    const base = createProductionProviderIntegration({ project, sourceRevision: revision(project), mediaProvider: provider, compositionIdbFactory: idb, contentIdbFactory: idb, mappingIdbFactory: idb, sitemapIdbFactory: idb });
    const providers = { ...base, captureWorkspace: vi.fn(() => base.captureWorkspace()), getCurrentSiteProject: vi.fn(() => { throw new Error("Must use aggregate project"); }) };
    const result = await loadWorkingPreviewSnapshot(providers);
    expect(result.status).toBe("ready");
    expect(result).toMatchObject({ sourceKind: "working-preview" });
    expect(providers.captureWorkspace).toHaveBeenCalledTimes(1);
    expect(providers.getCurrentSiteProject).not.toHaveBeenCalled();
    if (result.status === "ready") expect(result.build.routes.find(({ pathname }) => pathname === "/")!.composition.document.root.find(({ id }) => id === "download")!.props.href).toBe(asset.document.versions[0]!.url);
    expect((await loadWorkingPreviewSnapshot(fixture(project))).status).toBe("compiler-error");
    vi.spyOn(provider.store, "resolveVersion").mockRejectedValue(new Error("Corrupt bytes"));
    expect((await loadWorkingPreviewSnapshot(providers)).status).toBe("compiler-error");
  });
  it.each(["media", "project"])("rejects a changed %s aggregate token rather than recapturing latest", async (domain) => {
    const { provider, filesystem } = await providerFixture();
    const project = sample(), idb = new IDBFactory();
    const base = createProductionProviderIntegration({ project, sourceRevision: revision(project), mediaProvider: provider, compositionIdbFactory: idb, contentIdbFactory: idb, mappingIdbFactory: idb, sitemapIdbFactory: idb });
    const capture = vi.fn(() => base.captureWorkspace());
    let checks = 0;
    const providers = { ...base, captureWorkspace: capture, isCaptureCurrent: async (value: Parameters<typeof base.isCaptureCurrent>[0]) => {
      if (++checks === 2) {
        if (domain === "media") await filesystem.upload({ fileName: "changed.png", declaredMediaType: "image/png", bytes: PNG });
        else await base.workspace.updateMetadata((await base.workspace.metadata()).mutationToken, { name: "Changed project" });
      }
      return base.isCaptureCurrent(value);
    } };
    expect((await loadWorkingPreviewSnapshot(providers)).status).toBe("compiler-error");
    expect(capture).toHaveBeenCalledTimes(1); expect(checks).toBe(2);
  });
  it.each([
    ["/site", "Clear ideas, carefully shaped"],
    ["/site/services", "Ways to work together"],
    ["/site/about", "A studio built around useful clarity"],
    ["/site/journal/start-with-the-question", "Start with the question"],
    ["/site/journal/map-the-moving-parts", "Map the moving parts"],
    ["/site/journal/review-in-small-loops", "Review in small loops"],
  ])("renders the coherent evaluated route at %s", async (pathname, heading) => {
    render(<SiteDelivery source={activated()} pathname={pathname} />);
    expect(screen.getByRole("heading", { name: "Loading site" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
    expect(screen.getByText("Bundled static sample")).toBeInTheDocument();
  });

  it("renders Sitemap navigation, collection breadcrumbs, footer, and not-found", async () => {
    render(<SiteDelivery source={activated()} pathname="/site/journal/start-with-the-question" />);
    await screen.findByRole("heading", { name: "Start with the question" });
    expect(screen.getByRole("navigation", { name: "Primary navigation" }).querySelectorAll("a")).toHaveLength(4);
    expect(screen.getByRole("navigation", { name: "Primary navigation" }).querySelector('[aria-current="page"]')).toBeNull();
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toHaveTextContent("HomeJournalStart with the question");
    expect(screen.getByRole("navigation", { name: "Footer navigation" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Skip to main content" })).toHaveAttribute("href", "#main-content");
    await waitFor(() => expect(document.title).toBe("Start with the question — Sample Studio"));
    cleanup(); render(<SiteDelivery source={activated()} pathname="/site/missing" />);
    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Return to site home" })).toHaveAttribute("href", "/site");
    await waitFor(() => expect(document.title).toBe("Page not found — Sample Studio"));
  });

  it("links every generated journal entry from the journal index", async () => {
    render(<SiteDelivery source={activated()} pathname="/site/journal" />);
    await screen.findByRole("heading", { name: "Working notes" });
    expect(screen.getByRole("link", { name: "Read Start with the question" })).toHaveAttribute("href", "/site/journal/start-with-the-question");
    expect(screen.getByRole("link", { name: "Read Map the moving parts" })).toHaveAttribute("href", "/site/journal/map-the-moving-parts");
    expect(screen.getByRole("link", { name: "Read Review in small loops" })).toHaveAttribute("href", "/site/journal/review-in-small-loops");
  });

  it("fails closed for provider, validation, and compiler errors without a seed fallback", async () => {
    render(<SiteDelivery source={activated({ status: "error", message: "offline" })} pathname="/site" />);
    expect(await screen.findByRole("heading", { name: "Site unavailable" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    await waitFor(() => expect(document.title).toBe("Site unavailable — Site delivery"));
    expect(screen.queryByText("Clear ideas, carefully shaped")).not.toBeInTheDocument();
    cleanup();
    const invalid = structuredClone((bundled as Extract<ActivatedDeliverySource, { status: "ready" }>).artifact); invalid.project.componentPack.packVersion = "wrong";
    render(<SiteDelivery source={activated({ status: "ready", artifact: invalid })} pathname="/site" />);
    expect(await screen.findByRole("heading", { name: "Site data blocked" })).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("Site data blocked — Site delivery"));
    cleanup();
    const blocked = structuredClone((bundled as Extract<ActivatedDeliverySource, { status: "ready" }>).artifact); blocked.build.projectId = "wrong";
    render(<SiteDelivery source={activated({ status: "ready", artifact: blocked })} pathname="/site" />);
    expect(await screen.findByRole("heading", { name: "Site build blocked" })).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("Site build blocked — Site delivery"));
  });

  it("retries a retryable provider failure and renders the recovered route", async () => {
    let selected: ActivatedDeliverySource = { status: "error", message: "temporary" };
    const source = activated(selected) as Extract<DeliverySourceContract, { kind: "activated" }>;
    source.read = () => selected;
    render(<SiteDelivery source={source} pathname="/site" />);
    const retryButton = await screen.findByRole("button", { name: "Retry loading site" });
    selected = bundled; fireEvent.click(retryButton);
    expect(await screen.findByRole("heading", { name: "Clear ideas, carefully shaped" })).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById("main-content")));
  });

  it("announces and focuses a provider error that remains after retry", async () => {
    render(<SiteDelivery source={activated({ status: "error", message: "still offline" })} pathname="/site" />);
    fireEvent.click(await screen.findByRole("button", { name: "Retry loading site" }));
    expect(await screen.findByText(/still offline/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    await waitFor(() => expect(document.activeElement).toBe(document.querySelector("[data-site-delivery-state]")));
  });

  it("reads a new provider snapshot after remount and shows a persisted Content edit", async () => {
    const idb = new IDBFactory();
    const project = sample();
    const providers = createProductionProviderIntegration({ project, sourceRevision: revision(project), compositionIdbFactory: idb, contentIdbFactory: idb, mappingIdbFactory: idb, sitemapIdbFactory: idb });
    render(<SiteDelivery source={working(providers)} pathname="/website-preview/about" />);
    expect(await screen.findByRole("heading", { name: "A studio built around useful clarity" })).toBeInTheDocument();
    expect(screen.getByText("Live working preview — not activated")).toBeInTheDocument();
    const loaded = await providers.contentProvider.store.getEntry("about-entry");
    if (loaded.status !== "loaded") throw new Error("seed entry unavailable");
    await providers.contentProvider.store.putEntry({ ...loaded.record, updatedAt: "2026-08-31T01:00:00.000Z", values: { ...loaded.record.values, "about-heading-field": "Persisted delivery heading" } });
    cleanup(); render(<SiteDelivery source={working(providers)} pathname="/website-preview/about" />);
    expect(await screen.findByRole("heading", { name: "Persisted delivery heading" })).toBeInTheDocument();
  });
});
