import { createHash } from "node:crypto";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { createTemporaryWorkspaceProviders, type TemporaryWorkspaceProviders } from "../../../test/workspace-providers";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createProductionProviderIntegration, type ProductionProviderIntegration } from "../../../app/provider-integration";
import { createEmptySiteProject } from "../../../app/empty-site-project";
import { activeComponentProvider } from "../../composer/active-pack";
import { loadSampleSiteProject } from "../../../test/site-project-fixture";
import { captureSampleAssetLock, SAMPLE_ASSETS_STORE_ROOT } from "../../../test/sample-asset-lock";
import { serializeSiteProject } from "../../../site-project/model/canonical";
import { RECAPTURE_DEBOUNCE_MS, SiteDelivery, loadWorkingPreviewSnapshot } from "../site-delivery";
import { PREVIEW_PENDING_COPY, PREVIEW_REFRESHING_COPY } from "../preview-strip";
import { compileSiteProject } from "../../../site-project/compiler";
import type { ActivatedDeliveryArtifact, ActivatedDeliverySource, DeliverySourceContract } from "../source";
import { validateActivatedDeliveryArtifact } from "../source";
import { toDeliveryHref } from "../routing";
import { providerFixture, PNG } from "../../assets/__tests__/versioned-fixture";

afterEach(cleanup);
const hosts: TemporaryWorkspaceProviders[] = [];
afterEach(async () => { await Promise.all(hosts.splice(0).map((value) => value.dispose())); });
async function host(): Promise<TemporaryWorkspaceProviders> {
  const value = await createTemporaryWorkspaceProviders();
  hosts.push(value);
  return value;
}
const sample = () => loadSampleSiteProject({ componentPack: activeComponentProvider.manifest });
const revision = (project: ReturnType<typeof sample>) => createHash("sha256").update(serializeSiteProject(project), "utf8").digest("hex");
function fixture(project = sample()): ProductionProviderIntegration {
  return { componentProvider: activeComponentProvider, getCurrentSiteProject: vi.fn(async () => ({ status: "ready" as const, project: structuredClone(project) })) } as unknown as ProductionProviderIntegration;
}
const working = (providers: ProductionProviderIntegration): DeliverySourceContract => ({ kind: "working-preview", providers });
/** A real, initialized working-preview integration seeded with Sample
 * Studio's own committed images, so its own pinned references (#695) resolve
 * through the real `captureWorkspace` aggregate path `fixture()` doesn't
 * implement. */
async function workingIntegration(project = sample()): Promise<ProductionProviderIntegration> {
  const { provider } = await providerFixture({ seedFrom: SAMPLE_ASSETS_STORE_ROOT });
  const providers = createProductionProviderIntegration({ project, sourceRevision: revision(project), assetProvider: provider, createProviders: (await host()).createProviders });
  await providers.initialization.initialize();
  return providers;
}

/** Compile the checked-in fixture into the exact activated artifact shape delivery consumes. */
async function activatedArtifact(project = sample()): Promise<ActivatedDeliveryArtifact> {
  const { lock } = await captureSampleAssetLock(project, activeComponentProvider.catalog);
  const compilation = await compileSiteProject(project, { componentCatalog: activeComponentProvider.catalog, assetLock: lock });
  if (compilation.status !== "ready") throw new Error(`fixture compilation blocked: ${compilation.diagnostics.map(({ message }) => message).join(" ")}`);
  const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
  const files: Record<string, string> = { "build.json": sha(JSON.stringify(compilation.build)), "stage.json": sha("stage") };
  compilation.build.modules.forEach((module, index) => { files[`module-${String(index).padStart(4, "0")}.mjs`] = sha(module.code); });
  const { packId, packVersion, contractVersion } = activeComponentProvider.manifest;
  return {
    kind: "activated-local",
    identity: { projectId: project.id, revision: revision(project), buildId: sha(`build:${project.id}`) },
    project, build: compilation.build, completionDigest: sha(`complete:${project.id}`), files, assetPins: [],
    toolchain: { compiler: "compiler/2", componentPack: { packId, packVersion, contractVersion }, packSpecifier: "@fixture/pack/composer-pack", packSource: "workspace:*", installedPackDigest: "c".repeat(64), contractDigest: "d".repeat(64) },
  };
}
let artifact: ActivatedDeliveryArtifact;
beforeAll(async () => { artifact = await activatedArtifact(); });
const ready = (): ActivatedDeliverySource => ({ status: "ready", artifact });
const activated = (value: ActivatedDeliverySource = ready()): DeliverySourceContract => ({ kind: "activated", componentProvider: activeComponentProvider, read: () => value });
/** The strip is isolated in a shadow root, so Testing Library queries cannot reach it. */
const strip = (): ShadowRoot => document.querySelector(".zc-preview-strip")!.shadowRoot!;
const stripPicker = (): HTMLSelectElement | null => strip().querySelector<HTMLSelectElement>("select");

/** A promise plus the handle that settles it, for holding one capture open mid-flight. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => { resolve = settle; });
  return { promise, resolve };
}
/** Long enough that any trailing re-capture the component scheduled has started. */
const pastDebounce = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, RECAPTURE_DEBOUNCE_MS + 500));
const SLOW = { timeout: 30_000 };

/**
 * A real working-preview integration with its change channel and its capture
 * under the test's control: `emitChange` stands in for a committed write in
 * the editor tab, and a held capture reproduces a write landing while one is
 * still in flight.
 */
async function recapturable(project = sample()) {
  const { provider } = await providerFixture({ seedFrom: SAMPLE_ASSETS_STORE_ROOT });
  const base = createProductionProviderIntegration({ project, sourceRevision: revision(project), assetProvider: provider, createProviders: (await host()).createProviders });
  // Seeding writes real files; readiness is a precondition here, not the assertion.
  await base.initialization.initialize();
  const listeners = new Set<() => void>();
  const order: string[] = [];
  let captures = 0;
  let held: { entered: ReturnType<typeof deferred>; released: ReturnType<typeof deferred> } | undefined;
  let failure: string | undefined;
  const providers = { ...base,
    subscribeChanges: (listener: () => void) => { order.push("subscribe"); listeners.add(listener); return () => { listeners.delete(listener); }; },
    captureWorkspace: async () => {
      captures += 1;
      order.push("capture");
      if (failure !== undefined) { const message = failure; failure = undefined; return { status: "unavailable" as const, source: "test", error: new Error(message) }; }
      // Read the workspace first, then hold: the gate must open a window
      // *after* the snapshot is taken, which is where a late flush lands.
      const outcome = await base.captureWorkspace();
      if (held) { const gate = held; held = undefined; gate.entered.resolve(); await gate.released.promise; }
      return outcome;
    },
  } as unknown as ProductionProviderIntegration;
  return {
    providers,
    emitChange: () => { for (const listener of listeners) listener(); },
    captures: () => captures,
    order: () => order,
    subscribers: () => listeners.size,
    failNextCapture: (message: string) => { failure = message; },
    holdNextCapture: () => {
      const gate = { entered: deferred(), released: deferred() };
      held = gate;
      return { entered: gate.entered.promise, release: gate.released.resolve };
    },
    async editAboutHeading(heading: string) {
      const loaded = await base.contentProvider.store.getEntry("about-entry");
      if (loaded.status !== "loaded") throw new Error("seed entry unavailable");
      await base.contentProvider.store.putEntry({ ...loaded.record, updatedAt: "2026-08-31T01:00:00.000Z", values: { ...loaded.record.values, "about-heading-field": heading } });
    },
  };
}

describe("SiteDelivery", () => {
  it("compiles the fixture into one self-contained artifact with all seven deterministic visitor routes", () => {
    expect(validateActivatedDeliveryArtifact(artifact, activeComponentProvider.manifest)).toBeUndefined();
    expect(artifact.build.routes.map(({ pathname }) => pathname)).toEqual([
      "/", "/about", "/journal", "/journal/map-the-moving-parts", "/journal/review-in-small-loops", "/journal/start-with-the-question", "/services",
    ]);
    expect(artifact.build.navigation.primary.map(({ href }) => href)).toEqual(["/", "/about", "/services", "/journal"]);
    expect(artifact.build.routes.find(({ pathname }) => pathname === "/journal/start-with-the-question")?.ancestors.map(({ pathname }) => pathname)).toEqual(["/", "/journal"]);
    expect(Object.keys(artifact.files).filter((name) => name.startsWith("module-"))).toHaveLength(artifact.build.modules.length);
  });
  it("captures exact managed Asset for visitor output and blocks missing provider or corrupt bytes", async () => {
    // Sample Studio's own composition pins its real seeded images (#695), so
    // this store must carry them too, on top of the test's own new asset.
    const { provider, filesystem } = await providerFixture({ seedFrom: SAMPLE_ASSETS_STORE_ROOT });
    const asset = await filesystem.upload({ fileName: "download.png", declaredMimeType: "image/png", bytes: PNG });
    const project = sample();
    project.providers.compositions[0]!.records.find(({ id }) => id === "home-page")!.document.root.push({ id: "download", componentId: "ui.cta-button", componentVersion: 1, props: { href: `/uploaded-assets/asset-${asset.id}`, children: "Download" }, slots: {} });
    const base = createProductionProviderIntegration({ project, sourceRevision: revision(project), assetProvider: provider, createProviders: (await host()).createProviders });
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
  it("renders a blocked compile's root cause before the asset-capture wrapper text", async () => {
    // A brand-new project's default Sitemap page has no assigned source
    // (`src/app/empty-site-project.ts`); its compile diagnostic is the root
    // cause the asset-capture wrapper would otherwise hide (issue #850).
    const providers = await workingIntegration(createEmptySiteProject("Empty"));
    render(<SiteDelivery source={working(providers)} pathname="/website-preview" />);
    expect(await screen.findByRole("heading", { name: "Site build blocked" })).toBeInTheDocument();
    expect(screen.getByRole("status").textContent).toContain("The Sitemap page has no assigned source.");
  });
  it.each(["assets", "project"])("rejects a changed %s aggregate token rather than recapturing latest", async (domain) => {
    const { provider, filesystem } = await providerFixture({ seedFrom: SAMPLE_ASSETS_STORE_ROOT });
    const project = sample();
    const base = createProductionProviderIntegration({ project, sourceRevision: revision(project), assetProvider: provider, createProviders: (await host()).createProviders });
    const capture = vi.fn(() => base.captureWorkspace());
    let checks = 0;
    const providers = { ...base, captureWorkspace: capture, isCaptureCurrent: async (value: Parameters<typeof base.isCaptureCurrent>[0]) => {
      if (++checks === 2) {
        if (domain === "assets") await filesystem.upload({ fileName: "changed.png", declaredMimeType: "image/png", bytes: PNG });
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
    expect(strip().textContent).toContain("Activated local release — not deployed");
    expect(stripPicker()).toHaveValue(pathname);
  });

  it("carries the hosted demo notice inside the strip on /site", async () => {
    render(<SiteDelivery source={activated()} pathname="/site" hostedDemo />);
    await screen.findByRole("heading", { name: "Clear ideas, carefully shaped" });
    expect(strip().textContent).toContain("Public demo of zudo-composer");
    expect(strip().textContent).toMatch(/nothing is published/i);
  });

  it("carries the hosted demo notice inside the strip on /website-preview", async () => {
    render(<SiteDelivery source={working(await workingIntegration())} pathname="/website-preview/about" hostedDemo />);
    await screen.findByRole("heading", { name: "A studio built around useful clarity" });
    expect(strip().textContent).toContain("Public demo of zudo-composer");
    expect(strip().textContent).toMatch(/real authoring runs locally with pnpm dev/i);
  });

  it("omits the hosted demo notice from the strip when hosted mode is false", async () => {
    render(<SiteDelivery source={activated()} pathname="/site" />);
    await screen.findByRole("heading", { name: "Clear ideas, carefully shaped" });
    expect(strip().textContent).not.toContain("Public demo of zudo-composer");
    cleanup();
    render(<SiteDelivery source={working(await workingIntegration())} pathname="/website-preview/about" />);
    await screen.findByRole("heading", { name: "A studio built around useful clarity" });
    expect(strip().textContent).toContain("Live working preview — not activated");
    expect(strip().textContent).not.toContain("Public demo of zudo-composer");
  });

  it("renders the root visitor shape with a strip route picker and no tool navigation", async () => {
    const { container } = render(<SiteDelivery source={activated()} pathname="/site/journal/start-with-the-question" />);
    await screen.findByRole("heading", { name: "Start with the question" });
    expect(container.querySelector("main.site-root__main#main-content")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Skip to main content" })).toHaveAttribute("href", "#main-content");
    expect(screen.queryByRole("navigation", { name: "Primary navigation" })).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).toBeNull();
    expect(container.querySelector(".site-delivery__header, .site-delivery__footer")).toBeNull();
    const picker = stripPicker()!;
    expect([...picker.options].map(({ value }) => value)).toEqual(artifact.build.routes.map(({ pathname }) => toDeliveryHref(pathname, "/site")));
    expect([...picker.options].map(({ text }) => text)).toEqual(artifact.build.routes.map(({ displayTitle }) => displayTitle));
    expect(picker).toHaveValue("/site/journal/start-with-the-question");
    await waitFor(() => expect(document.title).toBe("Start with the question — Sample Studio"));
    cleanup(); render(<SiteDelivery source={activated()} pathname="/site/missing" />);
    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Return to site home" })).toHaveAttribute("href", "/site");
    expect(strip().textContent).toContain("Activated local release — not deployed");
    expect(stripPicker()).toBeNull();
    await waitFor(() => expect(document.title).toBe("Page not found — Sample Studio"));
  });

  it("keeps the strip in every non-ready state and the route picker only in ready", async () => {
    render(<SiteDelivery source={activated()} pathname="/site" />);
    expect(screen.getByRole("heading", { name: "Loading site" })).toBeInTheDocument();
    expect(strip().textContent).toContain("Activated local release — not deployed");
    expect(stripPicker()).toBeNull();
    await screen.findByRole("heading", { name: "Clear ideas, carefully shaped" });
    expect(stripPicker()).not.toBeNull();
    for (const [source, heading] of [
      [activated({ status: "error", message: "offline" }), "Site unavailable"],
      [activated({ status: "ready", artifact: (() => { const invalid = structuredClone(artifact); invalid.project.componentPack.packVersion = "wrong"; return invalid; })() }), "Site data blocked"],
      [activated({ status: "ready", artifact: (() => { const blocked = structuredClone(artifact); blocked.build.projectId = "wrong"; return blocked; })() }), "Site build blocked"],
    ] as const) {
      cleanup(); render(<SiteDelivery source={source} pathname="/site" />);
      expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
      expect(strip().textContent).toContain("Activated local release — not deployed");
      expect(stripPicker()).toBeNull();
    }
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
    const invalid = structuredClone(artifact); invalid.project.componentPack.packVersion = "wrong";
    render(<SiteDelivery source={activated({ status: "ready", artifact: invalid })} pathname="/site" />);
    expect(await screen.findByRole("heading", { name: "Site data blocked" })).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("Site data blocked — Site delivery"));
    cleanup();
    const blocked = structuredClone(artifact); blocked.build.projectId = "wrong";
    render(<SiteDelivery source={activated({ status: "ready", artifact: blocked })} pathname="/site" />);
    expect(await screen.findByRole("heading", { name: "Site build blocked" })).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("Site build blocked — Site delivery"));
    cleanup();
    const staleRuntime = structuredClone(artifact); staleRuntime.toolchain.componentPack.packVersion = "stale";
    render(<SiteDelivery source={activated({ status: "ready", artifact: staleRuntime })} pathname="/site" />);
    expect(await screen.findByText(/does not match the installed component pack/)).toBeInTheDocument();
  });

  it("retries a retryable provider failure and renders the recovered route", async () => {
    let selected: ActivatedDeliverySource = { status: "error", message: "temporary" };
    const source = activated(selected) as Extract<DeliverySourceContract, { kind: "activated" }>;
    source.read = () => selected;
    render(<SiteDelivery source={source} pathname="/site" />);
    const retryButton = await screen.findByRole("button", { name: "Retry loading site" });
    selected = ready(); fireEvent.click(retryButton);
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

  it("re-captures a committed write and swaps the new content in without a remount", async () => {
    const fx = await recapturable();
    render(<SiteDelivery source={working(fx.providers)} pathname="/website-preview/about" />);
    expect(await screen.findByRole("heading", { name: "A studio built around useful clarity" }, SLOW)).toBeInTheDocument();
    await fx.editAboutHeading("Re-captured delivery heading");
    fx.emitChange();
    expect(await screen.findByRole("heading", { name: "Re-captured delivery heading" }, SLOW)).toBeInTheDocument();
  });

  it("does not lose a write that commits between capture start and capture end", async () => {
    const fx = await recapturable();
    const gate = fx.holdNextCapture();
    render(<SiteDelivery source={working(fx.providers)} pathname="/website-preview/about" />);
    // The subscription is what hears a write landing inside the capture
    // window, so it has to exist before the capture that opens that window.
    await waitFor(() => expect(fx.order()).toEqual(["subscribe", "capture"]));
    // The first capture has read the workspace and has not resolved yet: this
    // is the window the subscription must already have been listening through.
    await gate.entered;
    fx.emitChange();
    gate.release();
    expect(await screen.findByRole("heading", { name: "A studio built around useful clarity" }, SLOW)).toBeInTheDocument();
    await waitFor(() => expect(fx.captures()).toBe(2), SLOW);
    await pastDebounce();
    expect(fx.captures()).toBe(2);
  });

  it("coalesces overlapping changes into exactly one trailing re-capture", async () => {
    const fx = await recapturable();
    render(<SiteDelivery source={working(fx.providers)} pathname="/website-preview/about" />);
    await screen.findByRole("heading", { name: "A studio built around useful clarity" }, SLOW);
    await waitFor(() => expect(fx.captures()).toBe(1));
    fx.emitChange(); fx.emitChange(); fx.emitChange();
    await waitFor(() => expect(fx.captures()).toBe(2), SLOW);
    await pastDebounce();
    expect(fx.captures()).toBe(2);
  });

  it("keeps the rendered page up while re-capturing and reports the update in the strip", async () => {
    const fx = await recapturable();
    render(<SiteDelivery source={working(fx.providers)} pathname="/website-preview/about" />);
    await screen.findByRole("heading", { name: "A studio built around useful clarity" }, SLOW);
    const gate = fx.holdNextCapture();
    fx.emitChange();
    await gate.entered;
    expect(screen.getByRole("heading", { name: "A studio built around useful clarity" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Loading site" })).toBeNull();
    await waitFor(() => expect(strip().textContent).toContain(PREVIEW_REFRESHING_COPY));
    gate.release();
    await waitFor(() => expect(strip().textContent).not.toContain(PREVIEW_REFRESHING_COPY), SLOW);
  });

  it("keeps the last good render when a re-capture fails and recovers on the next one", async () => {
    const fx = await recapturable();
    render(<SiteDelivery source={working(fx.providers)} pathname="/website-preview/about" />);
    await screen.findByRole("heading", { name: "A studio built around useful clarity" }, SLOW);
    fx.failNextCapture("Workspace provider offline");
    fx.emitChange();
    await waitFor(() => expect(strip().textContent).toContain("The live working draft could not be loaded. Workspace provider offline"), SLOW);
    expect(screen.getByRole("heading", { name: "A studio built around useful clarity" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Site unavailable" })).toBeNull();
    await fx.editAboutHeading("Recovered delivery heading");
    fx.emitChange();
    expect(await screen.findByRole("heading", { name: "Recovered delivery heading" }, SLOW)).toBeInTheDocument();
    expect(strip().textContent).not.toContain("Workspace provider offline");
  });

  it("keeps a render recovered by Retry when a later re-capture fails", async () => {
    const fx = await recapturable();
    fx.failNextCapture("First capture offline");
    render(<SiteDelivery source={working(fx.providers)} pathname="/website-preview/about" />);
    fireEvent.click(await screen.findByRole("button", { name: "Retry loading site" }, SLOW));
    expect(await screen.findByRole("heading", { name: "A studio built around useful clarity" }, SLOW)).toBeInTheDocument();
    fx.failNextCapture("Second capture offline");
    fx.emitChange();
    await waitFor(() => expect(strip().textContent).toContain("Second capture offline"), SLOW);
    expect(screen.getByRole("heading", { name: "A studio built around useful clarity" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Site unavailable" })).toBeNull();
  });

  it("cancels a capture in flight on unmount and stops listening for changes", async () => {
    const fx = await recapturable();
    const gate = fx.holdNextCapture();
    const { container } = render(<SiteDelivery source={working(fx.providers)} pathname="/website-preview/about" />);
    await gate.entered;
    expect(fx.subscribers()).toBe(1);
    const reported = vi.spyOn(console, "error").mockImplementation(() => undefined);
    cleanup();
    gate.release();
    fx.emitChange(); fx.emitChange();
    await pastDebounce();
    expect(fx.captures()).toBe(1);
    expect(fx.subscribers()).toBe(0);
    expect(container).toBeEmptyDOMElement();
    expect(reported).not.toHaveBeenCalled();
    reported.mockRestore();
  });

  it("reads a new provider snapshot after remount and shows a persisted Content edit", async () => {
    const project = sample();
    // Sample Studio's own project pins its real seeded images (#695), so the
    // aggregate capture path needs a real, seeded Assets provider too.
    const { provider } = await providerFixture({ seedFrom: SAMPLE_ASSETS_STORE_ROOT });
    const providers = createProductionProviderIntegration({ project, sourceRevision: revision(project), assetProvider: provider, createProviders: (await host()).createProviders });
    // Seeding writes real files; readiness is a precondition here, not the assertion.
    await providers.initialization.initialize();
    render(<SiteDelivery source={working(providers)} pathname="/website-preview/about" />);
    expect(await screen.findByRole("heading", { name: "A studio built around useful clarity" })).toBeInTheDocument();
    expect(strip().textContent).toContain("Live working preview — not activated");
    const loaded = await providers.contentProvider.store.getEntry("about-entry");
    if (loaded.status !== "loaded") throw new Error("seed entry unavailable");
    await providers.contentProvider.store.putEntry({ ...loaded.record, updatedAt: "2026-08-31T01:00:00.000Z", values: { ...loaded.record.values, "about-heading-field": "Persisted delivery heading" } });
    cleanup(); render(<SiteDelivery source={working(providers)} pathname="/website-preview/about" />);
    expect(await screen.findByRole("heading", { name: "Persisted delivery heading" })).toBeInTheDocument();
  });
});

/** Mirrors the private `CHANNEL_NAME` in src/shared/pending-broadcast.ts. */
const PENDING_CHANNEL = "zudo-workspace-pending-v1";

/** A same-origin `BroadcastChannel` stand-in: peers sharing a name see each other's posts, never their own. */
class FakePendingChannel {
  static peers = new Set<FakePendingChannel>();
  onmessage: ((event: { data: unknown }) => void) | null = null;
  constructor(readonly name: string) { FakePendingChannel.peers.add(this); }
  postMessage(data: unknown) { for (const peer of FakePendingChannel.peers) if (peer !== this && peer.name === this.name) peer.onmessage?.({ data }); }
  close() { FakePendingChannel.peers.delete(this); }
}

/**
 * One editor tab's announcement, posted and closed without a live publisher
 * behind it, so nothing can answer the reader's own re-query afterwards: a
 * message the reader was not listening for stays lost, which is exactly what
 * the "before the id resolved" case has to prove.
 */
function announcePending(workspaceId: string, value: boolean, sender = "editor-tab"): void {
  const peer = new FakePendingChannel(PENDING_CHANNEL);
  peer.postMessage({ type: "pending", sender, workspaceId, value });
  peer.close();
}

/**
 * A peer that only listens. The reader queries the channel the moment it
 * subscribes, so a counted query is the signal that its effect has run —
 * Preact flushes effects after paint, and a bare `findBy*` can return first.
 */
function observeQueries(): { count(): number; close(): void } {
  const peer = new FakePendingChannel(PENDING_CHANNEL);
  let queries = 0;
  peer.onmessage = ({ data }) => { if ((data as { type?: string }).type === "query") queries += 1; };
  return { count: () => queries, close: () => peer.close() };
}

/**
 * A working-preview integration that withholds its workspace id until its
 * first capture resolves it, as the real one does — the preview document
 * builds its own integration and only `captureWorkspace` initializes it.
 */
async function lateWorkspaceId(): Promise<{ providers: ProductionProviderIntegration; id: string }> {
  const base = await workingIntegration();
  const id = base.workspace.id!;
  let resolved = false;
  const providers = { ...base,
    workspace: { ...base.workspace, get id() { return resolved ? id : undefined; } },
    captureWorkspace: async () => { const outcome = await base.captureWorkspace(); resolved = true; return outcome; },
  } as unknown as ProductionProviderIntegration;
  return { providers, id };
}

describe("SiteDelivery working-preview pending broadcast", () => {
  beforeEach(() => { FakePendingChannel.peers.clear(); vi.stubGlobal("BroadcastChannel", FakePendingChannel); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("reports an editor's unsaved changes for its own workspace and ignores another's", async () => {
    const providers = await workingIntegration();
    const id = providers.workspace.id!;
    const listening = observeQueries();
    render(<SiteDelivery source={working(providers)} pathname="/website-preview/about" />);
    await screen.findByRole("heading", { name: "A studio built around useful clarity" });
    await waitFor(() => expect(listening.count()).toBe(1));
    expect(strip().textContent).not.toContain(PREVIEW_PENDING_COPY);

    await act(async () => { announcePending("another-workspace", true, "foreign-tab"); });
    expect(strip().textContent).not.toContain(PREVIEW_PENDING_COPY);

    await act(async () => { announcePending(id, true); });
    expect(strip().textContent).toContain(PREVIEW_PENDING_COPY);

    await act(async () => { announcePending(id, false); });
    expect(strip().textContent).not.toContain(PREVIEW_PENDING_COPY);
    listening.close();
  });

  it("subscribes once the workspace id resolves rather than staying deaf for the document's life", async () => {
    const { providers, id } = await lateWorkspaceId();
    const listening = observeQueries();
    // Announced while the id is still undefined: nobody is listening yet, and
    // the one-shot peer is gone before the reader's first query goes out.
    announcePending(id, true);
    render(<SiteDelivery source={working(providers)} pathname="/website-preview/about" />);
    await screen.findByRole("heading", { name: "A studio built around useful clarity" });
    // No query until the resolved id re-runs the subscribe effect.
    await waitFor(() => expect(listening.count()).toBe(1));
    expect(strip().textContent).not.toContain(PREVIEW_PENDING_COPY);

    await act(async () => { announcePending(id, true); });
    expect(strip().textContent).toContain(PREVIEW_PENDING_COPY);
    listening.close();
  });
});
