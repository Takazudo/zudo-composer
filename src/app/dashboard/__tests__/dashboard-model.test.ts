import { describe, expect, it } from "vitest";
import type { WorkspaceAttention, WorkspaceCounts, WorkspaceRecent } from "../../workspace-summary";
import {
  attentionView,
  formatByteSize,
  greeting,
  isEmptyWorkspace,
  lastWrite,
  mediaTypeSummary,
  pipelineStages,
  statCards,
} from "../dashboard-model";

const AT = (day: number) => `2026-08-${String(day).padStart(2, "0")}T00:00:00.000Z`;

function counts(overrides: Partial<WorkspaceCounts> = {}): WorkspaceCounts {
  return {
    content: { status: "ok", value: { models: 2, entries: 78, incompleteEntries: 3 } },
    media: { status: "ok", value: { assets: 14, bytes: 8_598_323, byType: { "image/png": 8, "image/jpeg": 3, "application/pdf": 3 } } },
    compositions: { status: "ok", value: { compositions: 6, patterns: 2, globalTemplates: 1 } },
    mappings: { status: "ok", value: { mappings: 3, blockedMappings: 1 } },
    sitemaps: { status: "ok", value: { sitemaps: 2, pages: 19, unassignedPages: 4 } },
    ...overrides,
  };
}

function emptyCounts(): WorkspaceCounts {
  return {
    content: { status: "ok", value: { models: 0, entries: 0, incompleteEntries: 0 } },
    media: { status: "unavailable", error: "No Media provider is connected." },
    compositions: { status: "ok", value: { compositions: 0, patterns: 0, globalTemplates: 0 } },
    mappings: { status: "ok", value: { mappings: 0, blockedMappings: 0 } },
    sitemaps: { status: "ok", value: { sitemaps: 0, pages: 0, unassignedPages: 0 } },
  };
}

describe("statCards", () => {
  it("reads every count off the summary in the prototype's order", () => {
    const cards = statCards(counts());
    expect(cards.map((card) => card.id)).toEqual(["content", "media", "compositions", "mappings", "sitemaps"]);
    expect(cards.map((card) => card.href)).toEqual(["/content", "/media", "/composer", "/mapping", "/sitemapper"]);

    const [content, media, compositions, mappings, sitemaps] = cards;
    expect(content).toMatchObject({ status: "ok", value: 78, unit: "entries", detail: ["2 models"], alert: "3 incomplete" });
    expect(media).toMatchObject({ status: "ok", value: 14, unit: "assets", detail: ["11 images", "3 PDFs", "8.2 MB"] });
    expect(compositions).toMatchObject({ status: "ok", value: 6, detail: ["2 patterns", "1 global template"] });
    expect(mappings).toMatchObject({ status: "ok", value: 3, alert: "1 blocked" });
    expect(sitemaps).toMatchObject({ status: "ok", value: 2, detail: ["19 pages"], alert: "4 unassigned" });
  });

  it("omits the alert chip where the backlog is empty", () => {
    const cards = statCards(counts({ mappings: { status: "ok", value: { mappings: 3, blockedMappings: 0 } } }));
    expect(cards.find((card) => card.id === "mappings")).toMatchObject({ status: "ok", alert: undefined });
  });

  it("carries a failed source through as unavailable rather than as a zero", () => {
    const cards = statCards(counts({ media: { status: "unavailable", error: "No Media provider is connected." } }));
    const media = cards.find((card) => card.id === "media");
    expect(media).toEqual({
      id: "media",
      label: "Media",
      href: "/media",
      icon: expect.anything(),
      status: "unavailable",
      error: "No Media provider is connected.",
    });
    expect(media).not.toHaveProperty("value");
  });

  it("uses singular units for a workspace holding one of a thing", () => {
    const cards = statCards(
      counts({
        content: { status: "ok", value: { models: 1, entries: 1, incompleteEntries: 0 } },
        media: { status: "ok", value: { assets: 1, bytes: 512, byType: { "application/pdf": 1 } } },
      }),
    );
    expect(cards[0]).toMatchObject({ unit: "entry", detail: ["1 model"] });
    expect(cards[1]).toMatchObject({ unit: "asset", detail: ["1 PDF", "512 B"] });
  });
});

describe("mediaTypeSummary", () => {
  it("folds raw media types into the three groups an author recognises", () => {
    expect(mediaTypeSummary({ "image/png": 8, "image/jpeg": 3, "application/pdf": 3, "text/plain": 1 })).toEqual([
      "11 images",
      "3 PDFs",
      "1 other file",
    ]);
  });

  it("lists nothing for an empty library", () => {
    expect(mediaTypeSummary({})).toEqual([]);
  });
});

describe("formatByteSize", () => {
  it("steps from bytes to megabytes", () => {
    expect(formatByteSize(512)).toBe("512 B");
    expect(formatByteSize(2048)).toBe("2.0 KB");
    expect(formatByteSize(8_598_323)).toBe("8.2 MB");
  });
});

describe("isEmptyWorkspace", () => {
  it("is true only once every authoring source has answered with nothing", () => {
    expect(isEmptyWorkspace(emptyCounts())).toBe(true);
    expect(isEmptyWorkspace(counts())).toBe(false);
  });

  it("is false where a source could not be read, because it may hold records", () => {
    const unreadable = { ...emptyCounts(), sitemaps: { status: "unavailable", error: "boom" } } as WorkspaceCounts;
    expect(isEmptyWorkspace(unreadable)).toBe(false);
  });

  it("is false where Media holds assets", () => {
    const withMedia = {
      ...emptyCounts(),
      media: { status: "ok", value: { assets: 2, bytes: 10, byType: { "image/png": 2 } } },
    } as WorkspaceCounts;
    expect(isEmptyWorkspace(withMedia)).toBe(false);
  });
});

describe("attentionView", () => {
  function attention(): WorkspaceAttention {
    return {
      mappings: {
        status: "ok",
        value: [{ kind: "blocked-mapping", id: "m1", label: "Articles → Blog post", detail: "Target prop is gone.", href: "/mapping?provider=p&mapping=m1" }],
      },
      sitemaps: {
        status: "ok",
        value: [
          { kind: "unassigned-page", id: "p1", label: "About", detail: "no source", href: "/sitemapper?sitemap=s1&page=p1" },
          { kind: "unassigned-page", id: "p2", label: "Careers", detail: "no source", href: "/sitemapper?sitemap=s1&page=p2" },
        ],
      },
      content: { status: "unavailable", error: "Content could not be read." },
    };
  }

  it("orders blocking work first and reports the source it could not check", () => {
    const view = attentionView(attention());
    expect(view.rows.map((row) => row.kind)).toEqual(["blocked-mapping", "unassigned-page", "unassigned-page"]);
    expect(view.total).toBe(3);
    expect(view.hidden).toBe(0);
    expect(view.unavailable).toEqual([{ source: "content", error: "Content could not be read." }]);
  });

  it("caps the rendered rows and says how many are left over", () => {
    const view = attentionView(attention(), 2);
    expect(view.rows).toHaveLength(2);
    expect(view.total).toBe(3);
    expect(view.hidden).toBe(1);
  });
});

describe("pipelineStages", () => {
  it("counts each stage from its own source", () => {
    expect(pipelineStages(counts()).map((stage) => [stage.label, stage.count])).toEqual([
      ["Content", "2 models"],
      ["Mapping", "3 mappings"],
      ["Composition", "6 compositions"],
      ["Sitemap", "2 sitemaps"],
    ]);
  });

  it("renders the explainer with no counts before the first read lands", () => {
    expect(pipelineStages(null).every((stage) => stage.count === undefined)).toBe(true);
    expect(pipelineStages(null)).toHaveLength(4);
  });
});

describe("lastWrite", () => {
  const record = { kind: "sitemap", id: "s1", label: "Marketing", updatedAt: AT(26), href: "/sitemapper?sitemap=s1" } as const;

  it("reads the newest record the summary returned", () => {
    expect(lastWrite({ records: [record], unavailable: [] } as WorkspaceRecent)).toEqual({ status: "known", at: AT(26) });
  });

  it("separates an empty workspace from one it could not fully read", () => {
    expect(lastWrite({ records: [], unavailable: [] })).toEqual({ status: "none" });
    expect(lastWrite({ records: [], unavailable: [{ source: "content", error: "boom" }] })).toEqual({ status: "unknown" });
  });
});

describe("greeting", () => {
  it("follows the local clock", () => {
    expect(greeting(new Date(2026, 8, 4, 9))).toBe("Good morning.");
    expect(greeting(new Date(2026, 8, 4, 13))).toBe("Good afternoon.");
    expect(greeting(new Date(2026, 8, 4, 21))).toBe("Good evening.");
  });
});
