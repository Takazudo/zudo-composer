import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  currentRailItem,
  persistRailState,
  Rail,
  RAIL_ITEMS,
  RAIL_STORAGE_KEY,
  railCounts,
  readRailState,
} from "../rail";
import type { WorkspaceCounts } from "../workspace-summary";

afterEach(() => {
  cleanup();
  window.localStorage.removeItem(RAIL_STORAGE_KEY);
});

function counts(overrides: Partial<WorkspaceCounts> = {}): WorkspaceCounts {
  return {
    compositions: { status: "ok", value: { compositions: 6, patterns: 1, globalTemplates: 0 } },
    mappings: { status: "ok", value: { mappings: 3, blockedMappings: 0 } },
    sitemaps: { status: "ok", value: { sitemaps: 2, pages: 9, unassignedPages: 0 } },
    content: { status: "ok", value: { models: 2, entries: 5, incompleteEntries: 0 } },
    media: { status: "ok", value: { assets: 14, bytes: 1024, byType: {} } },
    ...overrides,
  };
}

function renderRail(props: Partial<Parameters<typeof Rail>[0]> = {}) {
  return render(
    <Rail path="/" collapsed={false} onToggleCollapsed={() => undefined} {...props} />,
  );
}

describe("rail navigation model", () => {
  it("groups every authoring route once and adds the delivered site", () => {
    expect(RAIL_ITEMS.map((item) => item.id)).toEqual([
      "home",
      "content",
      "media",
      "composer",
      "mapping",
      "sitemapper",
      "site",
    ]);
  });

  it("resolves the current item for every in-chrome route", () => {
    expect(currentRailItem("/")?.id).toBe("home");
    expect(currentRailItem("")?.id).toBe("home");
    expect(currentRailItem("/composer")?.id).toBe("composer");
    expect(currentRailItem("/media")?.id).toBe("media");
    expect(currentRailItem("/nowhere")).toBeNull();
  });

  it("never resolves a delivery path to the Site entry", () => {
    // `App` returns SiteDelivery before the Shell mounts, so `/site*` can never
    // be the current route of a rendered rail.
    expect(currentRailItem("/site")).toBeNull();
    expect(currentRailItem("/site/about")).toBeNull();
  });
});

describe("rail counts", () => {
  it("maps each readable source onto its rail slot", () => {
    expect(railCounts(counts())).toEqual({
      content: 2,
      media: 14,
      composer: 6,
      mapping: 3,
      sitemapper: 2,
    });
  });

  it("omits a slot whose source is unavailable rather than showing zero", () => {
    const partial = railCounts(counts({ media: { status: "unavailable", error: "The Media database is blocked." } }));
    expect(partial).not.toHaveProperty("media");
    expect(partial.content).toBe(2);
  });

  it("omits a slot whose source is absent rather than showing zero", () => {
    const partial = railCounts(counts({ media: { status: "absent" } }));
    expect(partial).not.toHaveProperty("media");
    expect(partial.content).toBe(2);
  });

  it("has no counts before the summary resolves", () => {
    expect(railCounts(null)).toEqual({});
  });
});

describe("rail collapse persistence", () => {
  it("defaults to expanded and round-trips a stored choice", () => {
    expect(readRailState(window.localStorage)).toBe("expanded");
    persistRailState("collapsed", window.localStorage);
    expect(window.localStorage.getItem(RAIL_STORAGE_KEY)).toBe("collapsed");
    expect(readRailState(window.localStorage)).toBe("collapsed");
  });

  it("discards an unrecognised stored value", () => {
    window.localStorage.setItem(RAIL_STORAGE_KEY, "sideways");
    expect(readRailState(window.localStorage)).toBe("expanded");
    expect(window.localStorage.getItem(RAIL_STORAGE_KEY)).toBeNull();
  });

  it("survives a storage API that throws", () => {
    const throwing = {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
      removeItem: () => { throw new Error("denied"); },
    } as unknown as Storage;
    expect(readRailState(throwing)).toBe("expanded");
    expect(() => persistRailState("collapsed", throwing)).not.toThrow();
  });
});

describe("Rail", () => {
  it("marks only the current route", () => {
    renderRail({ path: "/content" });
    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    const current = nav.querySelectorAll('a[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent("Content");
  });

  it("marks nothing on a route the chrome does not own", () => {
    renderRail({ path: "/nowhere" });
    expect(document.querySelectorAll('[aria-current="page"]')).toHaveLength(0);
  });

  it("names the Site entry as a link out of the CMS and never marks it current", () => {
    renderRail({ path: "/" });
    const site = screen.getByRole("link", { name: "Site — open the delivered site" });
    expect(site).toHaveAttribute("href", "/site");
    expect(site).not.toHaveAttribute("aria-current");
    expect(site.querySelector(".cms-rail__external")).not.toBeNull();
  });

  it("renders a count only where the summary supplied one", () => {
    renderRail({ counts: { content: 2, composer: 6 } });
    const content = screen.getByRole("link", { name: "Content" });
    const media = screen.getByRole("link", { name: "Media" });
    expect(content.querySelector(".cms-rail__count")).toHaveTextContent("2");
    expect(media.querySelector(".cms-rail__count")).toBeNull();
  });

  it("keeps every item accessibly named while collapsed", () => {
    renderRail({ collapsed: true });
    for (const item of RAIL_ITEMS) {
      const name = item.accessibleName ?? item.label;
      expect(screen.getByRole("link", { name })).toHaveAttribute("title", item.label);
    }
  });

  it("labels the collapse control by the action it performs", () => {
    const onToggleCollapsed = vi.fn();
    const { rerender } = renderRail({ onToggleCollapsed });
    const collapse = screen.getByRole("button", { name: "Collapse navigation" });
    expect(collapse).toHaveAttribute("aria-expanded", "true");
    expect(collapse).toHaveAttribute("aria-controls", "cms-rail-nav");
    fireEvent.click(collapse);
    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);

    rerender(<Rail path="/" collapsed onToggleCollapsed={onToggleCollapsed} />);
    expect(screen.getByRole("button", { name: "Expand navigation" })).toHaveAttribute("aria-expanded", "false");
  });
});
