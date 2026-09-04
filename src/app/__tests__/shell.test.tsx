import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import type { JSX } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useBreadcrumb, useEditorStatus, type EditorStatus } from "../chrome-context";
import { RAIL_STORAGE_KEY } from "../rail";
import { Shell } from "../shell";
import type { WorkspaceCounts, WorkspaceSummary } from "../workspace-summary";
import { createThemeController, THEME_STORAGE_KEY, type ThemeController } from "../../theme/theme";

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-theme-preference");
  document.documentElement.removeAttribute("data-theme");
  window.localStorage.removeItem(RAIL_STORAGE_KEY);
  window.localStorage.removeItem(THEME_STORAGE_KEY);
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
  it("renders the rail, the topbar, and the route content", () => {
    const { container } = render(<ShellHarness path="/composer" />);
    expect(container.querySelector(".app-shell")).not.toBeNull();
    expect(screen.getByRole("navigation", { name: "Main navigation" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeInTheDocument();
    expect(screen.getByText("route content")).toBeInTheDocument();
  });

  it.each([
    ["/", "Dashboard"],
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
