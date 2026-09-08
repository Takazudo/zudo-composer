import { WorkspaceContext } from "../workspace-context";
import type { ProductionProviderIntegration } from "../provider-integration";
import { subscribeAuthoringPersistenceChanges } from "../persistence-channels";
import { notifyPersistenceChange } from "../../shared/persistence-generation";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import "../../components/overlay/__tests__/overlay-test-environment";
import type { JSX } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useBreadcrumb, useEditorStatus, type EditorStatus } from "../chrome-context";
import { RAIL_STORAGE_KEY } from "../rail";
import { Shell } from "../shell";
import type { WorkspaceCounts, WorkspaceSummary } from "../workspace-summary";
import { createThemeController, THEME_STORAGE_KEY, type ThemeController } from "../../theme/theme";
import { readFileSync } from "node:fs";

afterEach(() => {
  cleanup();
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
  render(<WorkspaceContext.Provider value={{ integration, navigate: async () => true, reset: async () => true, open: async () => true, busy: false, error: null }}><ShellHarness summary={summary} /></WorkspaceContext.Provider>);
  await waitFor(() => expect(listModels).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(counts).toHaveBeenCalledTimes(1));
  await act(async () => { notifyPersistenceChange("mapping"); hint(); });
  await waitFor(() => expect(counts).toHaveBeenCalledTimes(2));
  expect(listModels).toHaveBeenCalledTimes(1);
  for (const channel of ["content", "workspace"]) {
    listModels.mockClear(); await act(async () => notifyPersistenceChange(channel));
    await waitFor(() => expect(listModels).toHaveBeenCalledTimes(1));
  }
});

it("gives percentage-height editors a definite route slot without clipping long pages", () => {
  const shellStyles = readFileSync("src/app/shell.css", "utf8");
  const route = shellStyles.match(/\.cms-route-content\s*\{([^}]+)\}/)?.[1];
  expect(route).toMatch(/(?:^|;)\s*height:\s*100%\s*;/);
  expect(route).not.toMatch(/overflow\s*:\s*(hidden|clip)/);
  expect(shellStyles).toMatch(/\.cms-shell-main\s*\{[^}]*overflow:\s*auto/);
});

function readyCounts(): WorkspaceCounts {
  return {
    compositions: { status: "ok", value: { compositions: 6, patterns: 1, globalTemplates: 0 } },
    mappings: { status: "ok", value: { mappings: 3, blockedMappings: 0 } },
    sitemaps: { status: "ok", value: { sitemaps: 2, pages: 9, unassignedPages: 0 } },
    content: { status: "ok", value: { models: 2, entries: 5, incompleteEntries: 0 } },
    media: { status: "absent" },
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

interface HarnessProps {
  path?: string;
  summary?: WorkspaceSummary;
  children?: JSX.Element;
}

/** Mirrors how `App` owns the theme controller: created once, then observed. */
function ShellHarness({ path = "/", summary, children }: HarnessProps): JSX.Element {
  const themeController = useMemo<ThemeController>(
    () => createThemeController({ preference: "system", resolved: "light" }, {
      root: document.documentElement,
      storage: window.localStorage,
      matchMedia: null,
      eventTarget: null,
    }),
    [],
  );
  const [themeSnapshot, setThemeSnapshot] = useState(() => themeController.getSnapshot());
  useEffect(() => themeController.subscribe(setThemeSnapshot), [themeController]);
  useEffect(() => () => themeController.dispose(), [themeController]);

  return (
    <Shell
      path={path}
      themeController={themeController}
      themeSnapshot={themeSnapshot}
      {...(summary ? { summary } : {})}
    >
      {children ?? <main>route content</main>}
    </Shell>
  );
}

function PublishingRoute({ crumbs, status }: { crumbs?: { label: string; href?: string }[]; status?: EditorStatus }): JSX.Element {
  useBreadcrumb(crumbs ?? []);
  useEditorStatus(status ?? null);
  return <main>published route</main>;
}

describe("Shell chrome", () => {
  it("preserves the routed input DOM and value across width changes and complete Browse", () => {
    const { container } = render(<ShellHarness><input aria-label="Draft" defaultValue="unsaved draft" /></ShellHarness>);
    const input = screen.getByRole("textbox", { name: "Draft" });
    fireEvent.click(screen.getByRole("button", { name: "Collapse navigation" }));
    const browse = screen.getByRole("button", { name: "Browse navigation" });
    browse.focus(); fireEvent.click(browse);
    const peek = screen.getByRole("dialog", { name: "Browse navigation" });
    expect(within(peek).getByRole("link", { name: "Review & release" })).toBeInTheDocument();
    expect(container.querySelector(".app-shell")).toHaveAttribute("data-rail", "collapsed");
    expect(screen.getByRole("textbox", { name: "Draft" })).toBe(input);
    expect(input).toHaveValue("unsaved draft");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(browse).toHaveFocus();
    expect(localStorage.getItem(RAIL_STORAGE_KEY)).toBe("collapsed");
    fireEvent.click(browse);
    fireEvent.click(screen.getByRole("button", { name: "Keep expanded" }));
    expect(localStorage.getItem(RAIL_STORAGE_KEY)).toBe("expanded");
    expect(screen.getByRole("textbox", { name: "Draft" })).toBe(input);
  });

  it("honors handled/IME/nested shortcuts and outside pointer focus", () => {
    const { container } = render(<ShellHarness><input aria-label="Outside destination" /></ShellHarness>);
    fireEvent.keyDown(document, { key: "\\", ctrlKey: true, isComposing: true });
    const handled = new KeyboardEvent("keydown", { key: "\\", ctrlKey: true, bubbles: true, cancelable: true }); handled.preventDefault(); fireEvent(document, handled);
    expect(container.querySelector(".app-shell")).toHaveAttribute("data-rail", "expanded");
    fireEvent.click(screen.getByRole("button", { name: "Theme: System" }));
    fireEvent.keyDown(document, { key: "\\", metaKey: true });
    expect(container.querySelector(".app-shell")).toHaveAttribute("data-rail", "expanded");
    fireEvent.keyDown(screen.getByRole("menu", { name: "Theme preference" }), { key: "Escape" });
    fireEvent.keyDown(document, { key: "\\", ctrlKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Browse navigation" }));
    const input = screen.getByRole("textbox"); input.focus(); fireEvent.pointerDown(input);
    expect(screen.queryByRole("dialog", { name: "Browse navigation" })).toBeNull();
    expect(input).toHaveFocus();
  });

  it("opens an independent mobile modal, traps focus and cleans up at the breakpoint", () => {
    let listener: (() => void) | undefined;
    const query = { matches: true, addEventListener: (_: string, callback: () => void) => { listener = callback; }, removeEventListener: () => undefined };
    vi.stubGlobal("matchMedia", () => query);
    localStorage.setItem(RAIL_STORAGE_KEY, "collapsed");
    const { container } = render(<ShellHarness><input aria-label="Draft" defaultValue="kept" /></ShellHarness>);
    const input = screen.getByRole("textbox");
    expect(screen.queryByRole("navigation", { name: "Main navigation" })).toBeNull();
    const trigger = screen.getByRole("button", { name: "Expand navigation" }); trigger.focus(); fireEvent.click(trigger);
    const drawer = screen.getByRole("dialog", { name: "Navigation" });
    expect(within(drawer).getByRole("button", { name: "Close navigation" })).toHaveFocus();
    expect(container.querySelector(".cms-frame")).toHaveAttribute("inert");
    const first = within(drawer).getByRole("button", { name: "Close navigation" });
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(within(drawer).getByRole("link", { name: "Website preview — choose preview source" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Tab" }); expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "Escape", isComposing: true }); expect(drawer).toHaveAttribute("open");
    act(() => { query.matches = false; listener?.(); });
    expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull();
    expect(container.querySelector(".cms-frame")).not.toHaveAttribute("inert");
    expect(document.body.style.overflow).toBe("");
    expect(localStorage.getItem(RAIL_STORAGE_KEY)).toBe("collapsed");
    expect(screen.getByRole("textbox")).toBe(input);
  });
  it.each(["Escape", "Close navigation"])("restores mobile focus after inert cleanup on %s", (dismissal) => {
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    // jsdom does not implement inert: model the browser refusing focus into it.
    const focus = HTMLElement.prototype.focus;
    const focusSpy = vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (this: HTMLElement, options) {
      if (!this.closest("[inert]")) focus.call(this, options);
    });
    try {
      const { container } = render(<ShellHarness />);
      const trigger = screen.getByRole("button", { name: "Expand navigation" });
      trigger.focus(); fireEvent.click(trigger);
      const close = within(screen.getByRole("dialog", { name: "Navigation" })).getByRole("button", { name: "Close navigation" });
      expect(container.querySelector(".cms-frame")).toHaveAttribute("inert");
      if (dismissal === "Escape") fireEvent.keyDown(close, { key: "Escape" }); else fireEvent.click(close);
      expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull();
      expect(container.querySelector(".cms-frame")).not.toHaveAttribute("inert");
      expect(trigger).toHaveFocus();
    } finally { focusSpy.mockRestore(); }
  });
  it("renders the rail, the topbar, and the route content", () => {
    const { container } = render(<ShellHarness path="/composer" />);
    expect(container.querySelector(".app-shell")).not.toBeNull();
    expect(screen.getByRole("navigation", { name: "Main navigation" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeInTheDocument();
    expect(screen.getByText("route content")).toBeInTheDocument();
  });

  it.each([
    ["/", "Overview"],
    ["/content", "Content"],
    ["/media", "Media"],
    ["/composer", "Compositions"],
    ["/mapping", "Mappings"],
    ["/sitemapper", "Sitemaps"],
    ["/nowhere", "Not found"],
  ])("falls back to the route's own crumb at %s", (path, label) => {
    render(<ShellHarness path={path} />);
    const crumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(crumb).toHaveTextContent(label);
    expect(crumb.querySelector('[aria-current="page"]')).toHaveTextContent(label);
  });

  it("renders a published trail in place of the fallback, linking every crumb but the last", () => {
    render(
      <ShellHarness path="/content">
        <PublishingRoute crumbs={[{ label: "Content", href: "/content" }, { label: "News" }]} />
      </ShellHarness>,
    );
    const crumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(crumb.querySelector("a")).toHaveAttribute("href", "/content");
    expect(crumb.querySelector("a")).toHaveTextContent("Content");
    expect(crumb.querySelector('[aria-current="page"]')).toHaveTextContent("News");
  });

  it("shows no status chip until a route publishes one", () => {
    render(<ShellHarness path="/content" />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows the published save status, its detail, and its retry action", () => {
    const onRetry = vi.fn();
    render(
      <ShellHarness path="/content">
        <PublishingRoute status={{ state: "failed", detail: "Storage is full.", onRetry }} />
      </ShellHarness>,
    );
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Save failed · Storage is full.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("feeds the rail from the workspace summary and omits an unavailable source", async () => {
    render(<ShellHarness path="/" summary={fakeSummary(readyCounts())} />);
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Compositions" }).querySelector(".cms-rail__count")).toHaveTextContent("6");
    });
    expect(screen.getByRole("link", { name: "Content" }).querySelector(".cms-rail__count")).toHaveTextContent("2");
    expect(screen.getByRole("link", { name: "Media" }).querySelector(".cms-rail__count")).toBeNull();
  });
});

describe("Shell rail collapse", () => {
  it("collapses, persists the choice, and restores it on the next mount", () => {
    const { container, unmount } = render(<ShellHarness />);
    expect(container.querySelector(".app-shell")).toHaveAttribute("data-rail", "expanded");

    fireEvent.click(screen.getByRole("button", { name: "Collapse navigation" }));
    expect(container.querySelector(".app-shell")).toHaveAttribute("data-rail", "collapsed");
    expect(window.localStorage.getItem(RAIL_STORAGE_KEY)).toBe("collapsed");
    unmount();

    const remounted = render(<ShellHarness />);
    expect(remounted.container.querySelector(".app-shell")).toHaveAttribute("data-rail", "collapsed");
    expect(screen.getByRole("button", { name: "Expand navigation" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Expand navigation" }));
    expect(remounted.container.querySelector(".app-shell")).toHaveAttribute("data-rail", "expanded");
    expect(window.localStorage.getItem(RAIL_STORAGE_KEY)).toBe("expanded");
  });
});

describe("Shell theme control", () => {
  it("offers the three preferences as a single-select radio group", () => {
    render(<ShellHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Theme: System" }));

    const options = screen.getAllByRole("menuitemradio");
    expect(options.map((option) => option.textContent)).toEqual(["System", "Light", "Dark"]);
    expect(options.map((option) => option.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);
  });

  it("applies a chosen preference and reflects it on the trigger", () => {
    render(<ShellHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Theme: System" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Light" }));

    expect(document.documentElement.dataset.themePreference).toBe("light");
    expect(screen.queryByRole("menu", { name: "Theme preference" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Theme: Light" })).toHaveFocus();
  });
});

describe("Shell notifications", () => {
  it("keeps the truthful planned-email disclosure and its focus contract", () => {
    render(<ShellHarness />);
    const trigger = screen.getByRole("button", { name: "Notifications" });
    fireEvent.click(trigger);

    expect(screen.getByRole("dialog", { name: "Notifications" })).toBeInTheDocument();
    expect(screen.getByText("Planned")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Send email alerts" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Configure email delivery" })).toBeDisabled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Notifications" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
