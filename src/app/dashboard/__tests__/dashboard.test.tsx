import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceAttention, WorkspaceCounts, WorkspaceRecent, WorkspaceSummary } from "../../workspace-summary";
import { Dashboard } from "../dashboard";

afterEach(cleanup);

const MINUTE_MS = 60_000;
const twelveMinutesAgo = (): string => new Date(Date.now() - 12 * MINUTE_MS).toISOString();

interface Payload {
  counts: WorkspaceCounts;
  recent: WorkspaceRecent;
  attention: WorkspaceAttention;
}

function readyCounts(overrides: Partial<WorkspaceCounts> = {}): WorkspaceCounts {
  return {
    content: { status: "ok", value: { models: 2, entries: 78, incompleteEntries: 3 } },
    media: { status: "ok", value: { assets: 14, bytes: 8_598_323, byType: { "image/png": 11, "application/pdf": 3 } } },
    compositions: { status: "ok", value: { compositions: 6, patterns: 2, globalTemplates: 1 } },
    mappings: { status: "ok", value: { mappings: 3, blockedMappings: 1 } },
    sitemaps: { status: "ok", value: { sitemaps: 2, pages: 19, unassignedPages: 4 } },
    ...overrides,
  };
}

function readyRecent(overrides: Partial<WorkspaceRecent> = {}): WorkspaceRecent {
  return {
    records: [
      {
        kind: "content-entry",
        id: "entry-welcome",
        label: "Welcome to the newsroom",
        updatedAt: twelveMinutesAgo(),
        href: "/content?model=news&entry=entry-welcome",
        intent: { route: "content", modelId: "news", entryId: "entry-welcome" },
      },
      {
        kind: "pattern",
        id: "product-overview",
        label: "Product overview",
        updatedAt: new Date(Date.now() - 90 * MINUTE_MS).toISOString(),
        href: "/composer",
      },
      {
        kind: "sitemap",
        id: "marketing",
        label: "Marketing site",
        updatedAt: new Date(Date.now() - 30 * 60 * MINUTE_MS).toISOString(),
        href: "/sitemapper?sitemap=marketing",
        intent: { route: "sitemapper", sitemapId: "marketing" },
      },
    ],
    unavailable: [],
    ...overrides,
  };
}

function readyAttention(overrides: Partial<WorkspaceAttention> = {}): WorkspaceAttention {
  return {
    mappings: {
      status: "ok",
      value: [
        {
          kind: "blocked-mapping",
          id: "articles-blog",
          label: "Articles → Blog post",
          detail: "Target prop ProseMd.markdown no longer exists.",
          href: "/mapping?provider=mapping-indexeddb&mapping=articles-blog",
        },
      ],
    },
    sitemaps: {
      status: "ok",
      value: [
        {
          kind: "unassigned-page",
          id: "about",
          label: "About",
          detail: '"Marketing site" has a page with no Composition or Mapping source.',
          href: "/sitemapper?sitemap=marketing&page=about",
          intent: { route: "sitemapper", sitemapId: "marketing", pageId: "about" },
        },
      ],
    },
    content: {
      status: "ok",
      value: [
        {
          kind: "incomplete-entry",
          id: "article-41",
          label: "Article 41",
          detail: "Slug is required.",
          href: "/content?model=articles&entry=article-41",
          intent: { route: "content", modelId: "articles", entryId: "article-41" },
        },
      ],
    },
    ...overrides,
  };
}

function ready(overrides: Partial<Payload> = {}): Payload {
  return { counts: readyCounts(), recent: readyRecent(), attention: readyAttention(), ...overrides };
}

function emptyWorkspace(): Payload {
  return {
    counts: {
      content: { status: "ok", value: { models: 0, entries: 0, incompleteEntries: 0 } },
      media: { status: "absent" },
      compositions: { status: "ok", value: { compositions: 0, patterns: 0, globalTemplates: 0 } },
      mappings: { status: "ok", value: { mappings: 0, blockedMappings: 0 } },
      sitemaps: { status: "ok", value: { sitemaps: 0, pages: 0, unassignedPages: 0 } },
    },
    recent: { records: [], unavailable: [] },
    attention: {
      mappings: { status: "ok", value: [] },
      sitemaps: { status: "ok", value: [] },
      content: { status: "ok", value: [] },
    },
  };
}

/** A summary whose next read answers `after` once `refresh()` has been called. */
function fakeSummary(first: Payload, after: Payload = first) {
  let payload = first;
  const refresh = vi.fn(() => {
    payload = after;
  });
  const summary: WorkspaceSummary = {
    counts: () => Promise.resolve(payload.counts),
    recent: () => Promise.resolve(payload.recent),
    attention: () => Promise.resolve(payload.attention),
    refresh,
  };
  return { summary, refresh };
}

function statsRegion(): HTMLElement {
  return screen.getByRole("region", { name: "Workspace status" });
}

describe("Dashboard", () => {
  it("renders every count the read model reported and links each card to its route", async () => {
    render(<Dashboard summary={fakeSummary(ready()).summary} />);

    const cards = within(await screen.findByRole("region", { name: "Workspace status" })).getAllByRole("link");
    expect(cards.map((card) => card.getAttribute("href"))).toEqual(["/content", "/media", "/composer", "/mapping", "/sitemapper"]);

    expect(within(cards[0]).getByText("78")).toBeInTheDocument();
    expect(within(cards[0]).getByText("entries")).toBeInTheDocument();
    expect(within(cards[0]).getByText("2 models")).toBeInTheDocument();
    expect(within(cards[0]).getByText("3 incomplete")).toBeInTheDocument();
    expect(within(cards[1]).getByText("11 images · 3 PDFs · 8.2 MB")).toBeInTheDocument();
    expect(within(cards[2]).getByText("2 patterns · 1 global template")).toBeInTheDocument();
    expect(within(cards[3]).getByText("1 blocked")).toBeInTheDocument();
    expect(within(cards[4]).getByText("4 unassigned")).toBeInTheDocument();
  });

  it("offers the quick actions the workspace can actually serve", async () => {
    render(<Dashboard summary={fakeSummary(ready()).summary} />);

    expect(await screen.findByRole("link", { name: "Upload media" })).toHaveAttribute("href", "/media");
    expect(screen.getByRole("link", { name: "New entry" })).toHaveAttribute("href", "/content");
    // Built through `route-intents`, never hand-rolled.
    expect(screen.getByRole("link", { name: "New composition" })).toHaveAttribute("href", "/composer?new=1");
  });

  it("hides the upload action while no Media provider is configured", async () => {
    const payload = ready({ counts: readyCounts({ media: { status: "absent" } }) });
    render(<Dashboard summary={fakeSummary(payload).summary} />);

    await screen.findByRole("region", { name: "Workspace status" });
    expect(screen.queryByRole("link", { name: "Upload media" })).not.toBeInTheDocument();
  });

  it("hides the upload action while the Media provider has failed", async () => {
    const payload = ready({ counts: readyCounts({ media: { status: "unavailable", error: "The Media database is blocked." } }) });
    render(<Dashboard summary={fakeSummary(payload).summary} />);

    await screen.findByRole("region", { name: "Workspace status" });
    expect(screen.queryByRole("link", { name: "Upload media" })).not.toBeInTheDocument();
  });

  it("follows each recent record to the deep link the read model built", async () => {
    render(<Dashboard summary={fakeSummary(ready()).summary} />);

    const recent = await screen.findByRole("region", { name: "Recent activity" });
    expect(within(recent).getAllByRole("link").map((row) => row.getAttribute("href"))).toEqual([
      "/content?model=news&entry=entry-welcome",
      "/composer",
      "/sitemapper?sitemap=marketing",
    ]);
    expect(within(recent).getByText("Welcome to the newsroom")).toBeInTheDocument();
    expect(within(recent).getByText("Entry")).toBeInTheDocument();
    expect(within(recent).getByText("Pattern")).toBeInTheDocument();
    expect(within(recent).getByText("12 min ago")).toBeInTheDocument();
  });

  it("routes each attention item to the workspace that can resolve it", async () => {
    render(<Dashboard summary={fakeSummary(ready()).summary} />);

    const attention = await screen.findByRole("region", { name: "Needs attention" });
    expect(within(attention).getByRole("link", { name: "Fix Articles → Blog post" })).toHaveAttribute(
      "href",
      "/mapping?provider=mapping-indexeddb&mapping=articles-blog",
    );
    expect(within(attention).getByRole("link", { name: "Assign About" })).toHaveAttribute("href", "/sitemapper?sitemap=marketing&page=about");
    expect(within(attention).getByRole("link", { name: "Review Article 41" })).toHaveAttribute("href", "/content?model=articles&entry=article-41");
    expect(within(attention).getByText("Target prop ProseMd.markdown no longer exists.")).toBeInTheDocument();
  });

  it("degrades one card to Unavailable rather than showing a zero it cannot vouch for, and recovers it on Retry", async () => {
    const failed = ready({ counts: readyCounts({ sitemaps: { status: "unavailable", error: "Sitemaps could not be read." } }) });
    const { summary, refresh } = fakeSummary(failed, ready());
    render(<Dashboard summary={summary} />);

    const chip = await screen.findByText("Unavailable · Sitemaps could not be read.");
    const card = chip.closest(".cms-dash-stat");
    expect(card).not.toBeNull();
    expect(card!.tagName).toBe("DIV");
    expect(within(card as HTMLElement).queryByText("0")).not.toBeInTheDocument();

    // The other four sources are unaffected — the read model resolves each on its own.
    expect(within(statsRegion()).getAllByRole("link")).toHaveLength(4);

    fireEvent.click(within(card as HTMLElement).getByRole("button", { name: "Retry" }));
    expect(refresh).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(within(statsRegion()).getAllByRole("link")).toHaveLength(5));
    expect(screen.queryByText("Unavailable · Sitemaps could not be read.")).not.toBeInTheDocument();

    // The recovered card shows the count it could not vouch for a moment ago.
    const recovered = within(statsRegion()).getAllByRole("link")[4]!;
    expect(within(recovered).getByText("Sitemaps")).toBeInTheDocument();
    expect(within(recovered).getByText("2")).toBeInTheDocument();
    expect(within(recovered).getByText("19 pages")).toBeInTheDocument();
  });

  it("says which sources are missing from the recent list and from the attention check", async () => {
    const degraded = ready({
      recent: readyRecent({ unavailable: [{ source: "media", error: "The Media database is blocked." }] }),
      attention: readyAttention({ content: { status: "unavailable", error: "Content could not be read." } }),
    });
    const { summary, refresh } = fakeSummary(degraded, ready());
    render(<Dashboard summary={summary} />);

    const recent = await screen.findByRole("region", { name: "Recent activity" });
    expect(within(recent).getByText("Records from Media are not in this list.")).toBeInTheDocument();
    const attention = screen.getByRole("region", { name: "Needs attention" });
    expect(within(attention).getByText("Content could not be checked.")).toBeInTheDocument();
    expect(within(attention).queryByRole("link", { name: "Review Article 41" })).not.toBeInTheDocument();

    fireEvent.click(within(attention).getByRole("button", { name: "Retry" }));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(await within(attention).findByRole("link", { name: "Review Article 41" })).toBeInTheDocument();
  });

  it("counts the attention backlog in the card header", async () => {
    render(<Dashboard summary={fakeSummary(ready()).summary} />);

    const attention = await screen.findByRole("region", { name: "Needs attention" });
    expect(within(attention).getByText("3")).toBeInTheDocument();
  });

  it("shows a start-here state instead of five zeroes for an untouched workspace", async () => {
    render(<Dashboard summary={fakeSummary(emptyWorkspace()).summary} />);

    expect(await screen.findByText("Start here")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Workspace status" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Recent activity" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Needs attention" })).not.toBeInTheDocument();
    // The explainer still stands: it is the one card that owes nothing to a provider.
    expect(screen.getByRole("region", { name: "How the pieces connect" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "New composition" })).toHaveAttribute("href", "/composer?new=1");
  });

  it("reports the newest write and the Media provider state on the storage card", async () => {
    render(<Dashboard summary={fakeSummary(ready()).summary} />);

    const storage = await screen.findByRole("region", { name: "Storage" });
    expect(within(storage).getByText("IndexedDB · zudo-composer")).toBeInTheDocument();
    expect(within(storage).getByText("Dev only")).toBeInTheDocument();
    expect(within(storage).getByText("12 min ago")).toBeInTheDocument();
  });

  it("shows an informational chip with no Retry action for an absent Media provider", async () => {
    const payload = ready({ counts: readyCounts({ media: { status: "absent" } }) });
    render(<Dashboard summary={fakeSummary(payload).summary} />);

    const stats = await screen.findByRole("region", { name: "Workspace status" });
    expect(within(stats).getByText("Not connected")).toBeInTheDocument();
    expect(within(stats).queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();

    const storage = screen.getByRole("region", { name: "Storage" });
    expect(within(storage).getByText("Not connected")).toBeInTheDocument();
  });

  it("never calls a failed Media store 'not connected', and offers Retry from the stat card only", async () => {
    const payload = ready({ counts: readyCounts({ media: { status: "unavailable", error: "The Media database is blocked." } }) });
    render(<Dashboard summary={fakeSummary(payload).summary} />);

    const stats = await screen.findByRole("region", { name: "Workspace status" });
    expect(within(stats).getByText("Unavailable · The Media database is blocked.")).toBeInTheDocument();
    expect(within(stats).getByRole("button", { name: "Retry" })).toBeInTheDocument();

    const storage = screen.getByRole("region", { name: "Storage" });
    expect(within(storage).getByText("Unavailable")).toBeInTheDocument();
    expect(within(storage).queryByText("Not connected")).not.toBeInTheDocument();
    expect(within(storage).queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("separates an empty workspace from one whose newest write is unknown", async () => {
    const partial = ready({ recent: { records: [], unavailable: [{ source: "content", error: "Content could not be read." }] } });
    render(<Dashboard summary={fakeSummary(partial).summary} />);

    const storage = await screen.findByRole("region", { name: "Storage" });
    expect(within(storage).getByText("Not known")).toBeInTheDocument();
  });

  it("counts each pipeline stage from its own source and links it to that workspace", async () => {
    render(<Dashboard summary={fakeSummary(ready()).summary} />);

    const pipeline = await screen.findByRole("region", { name: "How the pieces connect" });
    expect(within(pipeline).getAllByRole("link").map((stage) => stage.getAttribute("href"))).toEqual([
      "/content",
      "/mapping",
      "/composer",
      "/sitemapper",
    ]);
    expect(within(pipeline).getByText("2 models")).toBeInTheDocument();
    expect(within(pipeline).getByText("6 compositions")).toBeInTheDocument();
  });

  it("stands on its own hero where no provider graph is mounted", () => {
    render(<Dashboard summary={undefined} now={new Date(2026, 8, 4, 9)} />);

    expect(screen.getByRole("heading", { name: "Good morning." })).toBeInTheDocument();
    expect(screen.getByText("Everything in this workspace lives in this browser.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Workspace status" })).not.toBeInTheDocument();
    // Cards that answer "what changed" say nothing at all rather than reading
    // as "nothing has changed".
    expect(screen.queryByRole("region", { name: "Recent activity" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Needs attention" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "How the pieces connect" })).toBeInTheDocument();
  });

  it("recovers from a read model that rejected outright", async () => {
    const failing: WorkspaceSummary = {
      counts: () => Promise.reject(new Error("Provider initialization failed.")),
      recent: () => Promise.reject(new Error("Provider initialization failed.")),
      attention: () => Promise.reject(new Error("Provider initialization failed.")),
      refresh: vi.fn(),
    };
    render(<Dashboard summary={failing} />);

    expect(await screen.findByText("Provider initialization failed.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Good (morning|afternoon|evening)\./ })).toBeInTheDocument();
  });
});
