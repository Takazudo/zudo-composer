import type { WorkspaceServices } from "../services";
import type { ProductionProviderIntegration } from "../provider-integration";
import { subscribeAuthoringPersistenceChanges } from "../persistence-channels";
import { notifyPersistenceChange } from "../../shared/persistence-generation";
import { getScope, signal, type Child } from "@takazudo/zfb/zudo-react";
import { fireEvent, render, screen, settle, waitFor, within } from "../../test/render";
import "../../components/overlay/__tests__/overlay-test-environment";
import { afterEach, describe, expect, it, vi } from "vitest";
import { storeSignal } from "../../runtime";
import { bindBreadcrumb, bindEditorStatus, createChromeStore, type ChromeStore, type EditorStatus } from "../chrome-context";
import { RAIL_STORAGE_KEY } from "../rail";
import { Shell } from "../shell";
import type { WorkspaceCounts, WorkspaceSummary } from "../workspace-summary";
import { createThemeController, THEME_STORAGE_KEY, type ThemeController } from "../../theme/theme";
import { readFileSync } from "node:fs";

afterEach(() => {
  document.documentElement.removeAttribute("data-theme-preference");
  document.documentElement.removeAttribute("data-theme");
  window.localStorage.removeItem(RAIL_STORAGE_KEY);
  window.localStorage.removeItem(THEME_STORAGE_KEY);
  vi.unstubAllGlobals();
});

it("refreshes rail models only for Content/workspace while summary hints update counts", async () => {
  const listModels = vi.fn(async () => ({ entries: [], failures: [] }));
  const integration = { initialization: { initialize: async () => ({ status: "ready" }) }, contentCatalog: { listModels }, subscribeChanges: (listener: () => void, channels: readonly string[]) => subscribeAuthoringPersistenceChanges(channels, listener) } as unknown as ProductionProviderIntegration;
  let hint!: () => void;
  const summary = { ...fakeSummary(readyCounts()), subscribe: (listener: () => void) => { hint = listener; return () => {}; } };
  const counts = vi.spyOn(summary, "counts");
  render(<ShellHarness summary={summary} workspace={workspaceServices(integration)} />);
  await settle();
  await waitFor(() => expect(listModels).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(counts).toHaveBeenCalledTimes(1));
  notifyPersistenceChange("mapping"); hint();
  await settle();
  await waitFor(() => expect(counts).toHaveBeenCalledTimes(2));
  expect(listModels).toHaveBeenCalledTimes(1);
  for (const channel of ["content", "workspace"]) {
    listModels.mockClear(); notifyPersistenceChange(channel); await settle();
    await waitFor(() => expect(listModels).toHaveBeenCalledTimes(1));
  }
});

it("gives percentage-height editors a definite route slot without clipping long pages", async () => {
  const shellStyles = readFileSync("src/app/shell.css", "utf8");
  const route = shellStyles.match(/\.cms-route-content\s*\{([^}]+)\}/)?.[1];
  expect(route).toMatch(/(?:^|;)\s*flex:\s*1 1 0\s*;/);
  expect(route).toMatch(/(?:^|;)\s*min-height:\s*0\s*;/);
  expect(shellStyles).toMatch(/\.cms-shell-main\s*\{[^}]*display:\s*flex/);
  expect(shellStyles).toMatch(/\.cms-shell-main\s*>\s*:not\(\.cms-route-content\)\s*\{[^}]*flex:\s*0 0 auto/);
  expect(route).not.toMatch(/overflow\s*:\s*(hidden|clip)/);
  expect(shellStyles).toMatch(/\.cms-shell-main\s*\{[^}]*overflow:\s*auto/);
});

function readyCounts(): WorkspaceCounts {
  return {
    compositions: { status: "ok", value: { compositions: 6, patterns: 1, globalTemplates: 0 } },
    mappings: { status: "ok", value: { mappings: 3, blockedMappings: 0 } },
    sitemaps: { status: "ok", value: { sitemaps: 2, pages: 9, unassignedPages: 0 } },
    content: { status: "ok", value: { models: 2, entries: 5, incompleteEntries: 0 } },
    assets: { status: "absent" },
  };
}

function fakeSummary(counts: WorkspaceCounts): WorkspaceSummary {
  return {
    counts: () => Promise.resolve(counts),
    recent: () => Promise.resolve({ records: [], unavailable: [] }),
    attention: () => {
      throw new Error("not used by the shell");
    },
    refresh: () => undefined,
  };
}

function workspaceServices(integration: ProductionProviderIntegration): WorkspaceServices {
  return { integration, navigate: async () => true, reset: async () => true, open: async () => true, busy: signal(false), error: signal(null) };
}

interface HarnessProps {
  path?: string;
  summary?: WorkspaceSummary;
  workspace?: WorkspaceServices;
  children?: Child;
  /** A route that publishes into the harness's chrome store. */
  route?: (chrome: ChromeStore) => Child;
}

/** Mirrors how `App` owns the theme controller and chrome store: created once, then observed. */
function ShellHarness({ path = "/", summary, workspace, children, route }: HarnessProps) {
  const scope = getScope();
  const themeController: ThemeController = createThemeController({ preference: "system", resolved: "light" }, {
    root: document.documentElement,
    storage: window.localStorage,
    matchMedia: null,
    eventTarget: null,
  });
  const themeSnapshot = storeSignal(scope, themeController);
  scope.onCleanup(() => themeController.dispose());
  const chrome = createChromeStore();

  return (
    <Shell
      path={path}
      themeController={themeController}
      themeSnapshot={themeSnapshot}
      chrome={chrome}
      {...(summary ? { summary } : {})}
      {...(workspace ? { workspace } : {})}
    >
      {route ? route(chrome) : children ?? <main>route content</main>}
    </Shell>
  );
}

function PublishingRoute({ chrome, crumbs, status }: { chrome: ChromeStore; crumbs?: { label: string; href?: string }[]; status?: EditorStatus }) {
  bindBreadcrumb(getScope(), chrome, crumbs ?? []);
  bindEditorStatus(getScope(), chrome, status ?? null);
  return <main>published route</main>;
}

describe("Shell chrome", () => {
  it("preserves the routed input DOM and value across width changes and complete Browse", async () => {
    const { container } = render(<ShellHarness><input aria-label="Draft" value="unsaved draft" /></ShellHarness>);
    await settle();
    const input = screen.getByRole("textbox", { name: "Draft" });
    fireEvent.click(screen.getByRole("button", { name: "Collapse navigation" })); await settle();
    const browse = screen.getByRole("button", { name: "Browse navigation" });
    browse.focus(); fireEvent.click(browse); await settle();
    const peek = screen.getByRole("dialog", { name: "Browse navigation" });
    expect(within(peek).getByRole("link", { name: "Review & release" })).toBeInTheDocument();
    expect(container.querySelector(".app-shell")).toHaveAttribute("data-rail", "collapsed");
    expect(screen.getByRole("textbox", { name: "Draft" })).toBe(input);
    expect(input).toHaveValue("unsaved draft");
    fireEvent.keyDown(document, { key: "Escape" }); await settle();
    expect(browse).toHaveFocus();
    expect(localStorage.getItem(RAIL_STORAGE_KEY)).toBe("collapsed");
    fireEvent.click(browse); await settle();
    fireEvent.click(screen.getByRole("button", { name: "Keep expanded" })); await settle();
    expect(localStorage.getItem(RAIL_STORAGE_KEY)).toBe("expanded");
    expect(screen.getByRole("textbox", { name: "Draft" })).toBe(input);
  });

  it("honors handled/IME/nested shortcuts and outside pointer focus", async () => {
    const { container } = render(<ShellHarness><input aria-label="Outside destination" /></ShellHarness>);
    await settle();
    fireEvent.keyDown(document, { key: "\\", ctrlKey: true, isComposing: true }); await settle();
    const handled = new KeyboardEvent("keydown", { key: "\\", ctrlKey: true, bubbles: true, cancelable: true }); handled.preventDefault(); fireEvent(document, handled); await settle();
    expect(container.querySelector(".app-shell")).toHaveAttribute("data-rail", "expanded");
    fireEvent.click(screen.getByRole("button", { name: "Theme: System" })); await settle();
    fireEvent.keyDown(document, { key: "\\", metaKey: true }); await settle();
    expect(container.querySelector(".app-shell")).toHaveAttribute("data-rail", "expanded");
    fireEvent.keyDown(screen.getByRole("menu", { name: "Theme preference" }), { key: "Escape" }); await settle();
    fireEvent.keyDown(document, { key: "\\", ctrlKey: true }); await settle();
    fireEvent.click(screen.getByRole("button", { name: "Browse navigation" })); await settle();
    const input = screen.getByRole("textbox"); input.focus(); fireEvent.pointerDown(input); await settle();
    expect(screen.queryByRole("dialog", { name: "Browse navigation" })).toBeNull();
    expect(input).toHaveFocus();
  });

  it("opens an independent mobile modal, traps focus and cleans up at the breakpoint", async () => {
    let listener: (() => void) | undefined;
    const query = { matches: true, addEventListener: (_: string, callback: () => void) => { listener = callback; }, removeEventListener: () => undefined };
    vi.stubGlobal("matchMedia", () => query);
    localStorage.setItem(RAIL_STORAGE_KEY, "collapsed");
    const { container } = render(<ShellHarness><input aria-label="Draft" value="kept" /></ShellHarness>);
    await settle();
    const input = screen.getByRole("textbox");
    expect(screen.queryByRole("navigation", { name: "Main navigation" })).toBeNull();
    const trigger = screen.getByRole("button", { name: "Expand navigation" }); trigger.focus(); fireEvent.click(trigger); await settle();
    const drawer = screen.getByRole("dialog", { name: "Navigation" });
    expect(within(drawer).getByRole("button", { name: "Close navigation" })).toHaveFocus();
    expect(container.querySelector(".cms-frame")).toHaveAttribute("inert");
    const first = within(drawer).getByRole("button", { name: "Close navigation" });
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true }); await settle();
    expect(within(drawer).getByRole("link", { name: "Website preview — choose preview source" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Tab" }); await settle(); expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "Escape", isComposing: true }); await settle(); expect(drawer).toHaveAttribute("open");
    query.matches = false; listener?.();
    await settle();
    expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull();
    expect(container.querySelector(".cms-frame")).not.toHaveAttribute("inert");
    expect(document.body.style.overflow).toBe("");
    expect(localStorage.getItem(RAIL_STORAGE_KEY)).toBe("collapsed");
    expect(screen.getByRole("textbox")).toBe(input);
  });
  it.each(["Escape", "Close navigation"])("restores mobile focus after inert cleanup on %s", async (dismissal) => {
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    // jsdom does not implement inert: model the browser refusing focus into it.
    const focus = HTMLElement.prototype.focus;
    const focusSpy = vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (this: HTMLElement, options) {
      if (!this.closest("[inert]")) focus.call(this, options);
    });
    try {
      const { container } = render(<ShellHarness />);
      await settle();
      const trigger = screen.getByRole("button", { name: "Expand navigation" });
      trigger.focus(); fireEvent.click(trigger); await settle();
      const close = within(screen.getByRole("dialog", { name: "Navigation" })).getByRole("button", { name: "Close navigation" });
      expect(container.querySelector(".cms-frame")).toHaveAttribute("inert");
      if (dismissal === "Escape") fireEvent.keyDown(close, { key: "Escape" }); else fireEvent.click(close);
      await settle();
      expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull();
      expect(container.querySelector(".cms-frame")).not.toHaveAttribute("inert");
      expect(trigger).toHaveFocus();
    } finally { focusSpy.mockRestore(); }
  });
  it("renders the rail, the topbar, and the route content", async () => {
    const { container } = render(<ShellHarness path="/composer" />);
    await settle();
    expect(container.querySelector(".app-shell")).not.toBeNull();
    expect(screen.getByRole("navigation", { name: "Main navigation" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeInTheDocument();
    expect(screen.getByText("route content")).toBeInTheDocument();
  });

  it.each([
    ["/", "Overview"],
    ["/content", "Content"],
    ["/assets", "Assets"],
    ["/composer", "Compositions"],
    ["/mapping", "Mappings"],
    ["/sitemapper", "Sitemaps"],
    ["/nowhere", "Not found"],
  ])("falls back to the route's own crumb at %s", async (path, label) => {
    render(<ShellHarness path={path} />);
    await settle();
    const crumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(crumb).toHaveTextContent(label);
    expect(crumb.querySelector('[aria-current="page"]')).toHaveTextContent(label);
  });

  it("renders a published trail in place of the fallback, linking every crumb but the last", async () => {
    render(
      <ShellHarness path="/content" route={(chrome) => <PublishingRoute chrome={chrome} crumbs={[{ label: "Content", href: "/content" }, { label: "News" }]} />} />,
    );
    await settle();
    const crumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(crumb.querySelector("a")).toHaveAttribute("href", "/content");
    expect(crumb.querySelector("a")).toHaveTextContent("Content");
    expect(crumb.querySelector('[aria-current="page"]')).toHaveTextContent("News");
  });

  it("shows no status chip until a route publishes one", async () => {
    render(<ShellHarness path="/content" />);
    await settle();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows the published save status, its detail, and its retry action", async () => {
    const onRetry = vi.fn();
    render(
      <ShellHarness path="/content" route={(chrome) => <PublishingRoute chrome={chrome} status={{ state: "failed", detail: "Storage is full.", onRetry }} />} />,
    );
    await settle();
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Save failed · Storage is full.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" })); await settle();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("feeds the rail from the workspace summary and omits an unavailable source", async () => {
    render(<ShellHarness path="/" summary={fakeSummary(readyCounts())} />);
    await settle();
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Compositions" }).querySelector(".cms-rail__count")).toHaveTextContent("6");
    });
    expect(screen.getByRole("link", { name: "Content" }).querySelector(".cms-rail__count")).toHaveTextContent("2");
    expect(screen.getByRole("link", { name: "Assets" }).querySelector(".cms-rail__count")).toBeNull();
  });
});

describe("Shell rail collapse", () => {
  it("collapses, persists the choice, and restores it on the next mount", async () => {
    const { container, unmount } = render(<ShellHarness />);
    await settle();
    expect(container.querySelector(".app-shell")).toHaveAttribute("data-rail", "expanded");

    fireEvent.click(screen.getByRole("button", { name: "Collapse navigation" })); await settle();
    expect(container.querySelector(".app-shell")).toHaveAttribute("data-rail", "collapsed");
    expect(window.localStorage.getItem(RAIL_STORAGE_KEY)).toBe("collapsed");
    unmount();

    const remounted = render(<ShellHarness />);

    await settle();
    expect(remounted.container.querySelector(".app-shell")).toHaveAttribute("data-rail", "collapsed");
    expect(screen.getByRole("button", { name: "Expand navigation" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Expand navigation" })); await settle();
    expect(remounted.container.querySelector(".app-shell")).toHaveAttribute("data-rail", "expanded");
    expect(window.localStorage.getItem(RAIL_STORAGE_KEY)).toBe("expanded");
  });
});

describe("Shell theme control", () => {
  it("offers the three preferences as a single-select radio group", async () => {
    render(<ShellHarness />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Theme: System" })); await settle();

    const options = screen.getAllByRole("menuitemradio");
    expect(options.map((option) => option.textContent)).toEqual(["System", "Light", "Dark"]);
    expect(options.map((option) => option.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);
  });

  it("applies a chosen preference and reflects it on the trigger", async () => {
    render(<ShellHarness />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Theme: System" })); await settle();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Light" })); await settle();

    expect(document.documentElement.dataset.themePreference).toBe("light");
    expect(screen.queryByRole("menu", { name: "Theme preference" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Theme: Light" })).toHaveFocus();
  });
});

describe("Shell notifications", () => {
  it("states that the host owns delivery, offers no email controls, and keeps its focus contract", async () => {
    render(<ShellHarness />);
    await settle();
    const trigger = screen.getByRole("button", { name: "Notifications" });
    fireEvent.click(trigger); await settle();

    const panel = screen.getByRole("dialog", { name: "Notifications" });
    expect(panel).toHaveTextContent("Composer never sends email or other notifications; the host project owns delivery.");
    expect(panel).not.toHaveTextContent(/planned/i);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" }); await settle();
    expect(screen.queryByRole("dialog", { name: "Notifications" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});

it("retries a failed model catalog after same-epoch authoring resume, preserving healthy catalogs", async () => {
  const listModels = vi.fn().mockRejectedValueOnce(Object.assign(new Error("Authoring read did not settle in time."), { name: "TimeoutError" })).mockResolvedValue({ entries: [], failures: [] });
  const integration = { initialization: { initialize: async () => ({ status: "ready" }) }, contentCatalog: { listModels }, subscribeChanges: () => () => {} } as unknown as ProductionProviderIntegration;
  render(<ShellHarness workspace={workspaceServices(integration)} />);
  await settle();
  await waitFor(() => expect(screen.getByText("Authoring read did not settle in time.")).toBeTruthy());
  window.dispatchEvent(new CustomEvent("native-authoring-resumed"));
  await settle();
  await waitFor(() => expect(listModels).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByText("Authoring read did not settle in time.")).toBeNull());
  window.dispatchEvent(new CustomEvent("native-authoring-resumed"));
  await settle();
  expect(listModels).toHaveBeenCalledTimes(2);
});
