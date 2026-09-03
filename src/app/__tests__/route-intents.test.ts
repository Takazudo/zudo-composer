import { describe, expect, it } from "vitest";
import { formatIntent, parseIntent, type RouteIntent } from "../route-intents";

function matched(input: string): RouteIntent {
  const outcome = parseIntent(input);
  expect(outcome.status).toBe("matched");
  return (outcome as { status: "matched"; intent: RouteIntent }).intent;
}

function invalidMessage(input: string): string {
  const outcome = parseIntent(input);
  expect(outcome.status).toBe("invalid");
  return (outcome as { status: "invalid"; message: string }).message;
}

describe("parseIntent", () => {
  it("ignores routes that carry no intent and bare intent routes", () => {
    for (const input of ["/", "/mapping?provider=indexeddb&mapping=news", "/composer", "/content", "/sitemapper", "/media", "/composer/preview?new=1"]) {
      expect(parseIntent(input)).toEqual({ status: "none" });
    }
  });

  it("ignores unrecognized parameters on an intent route", () => {
    expect(parseIntent("/content?tab=entries")).toEqual({ status: "none" });
  });

  it("reads every supported intent", () => {
    expect(matched("/composer?new=1")).toEqual({ route: "composer", action: "new" });
    expect(matched("/content?model=news-collection")).toEqual({ route: "content", modelId: "news-collection" });
    expect(matched("/content?model=news-collection&entry=news-entry-welcome")).toEqual({ route: "content", modelId: "news-collection", entryId: "news-entry-welcome" });
    expect(matched("/sitemapper?sitemap=studio-map")).toEqual({ route: "sitemapper", sitemapId: "studio-map" });
    expect(matched("/sitemapper?sitemap=studio-map&page=page-1")).toEqual({ route: "sitemapper", sitemapId: "studio-map", pageId: "page-1" });
    expect(matched("/media?asset=hero-image")).toEqual({ route: "media", assetId: "hero-image" });
  });

  it("accepts a URL and a location record as well as a string", () => {
    expect(matched(new URL("https://zudo-composer.zudolab.dev/media?asset=hero-image").toString())).toEqual({ route: "media", assetId: "hero-image" });
    expect(parseIntent(new URL("https://zudo-composer.zudolab.dev/media?asset=hero-image"))).toEqual({ status: "matched", intent: { route: "media", assetId: "hero-image" } });
    expect(parseIntent({ pathname: "/media", search: "?asset=hero-image" })).toEqual({ status: "matched", intent: { route: "media", assetId: "hero-image" } });
  });

  it("rejects a malformed id rather than opening the plain route", () => {
    expect(invalidMessage("/content?model=News%20Collection")).toBe("The Content model id is malformed.");
    expect(invalidMessage("/content?model=news-collection&entry=Welcome")).toBe("The Content Entry id is malformed.");
    expect(invalidMessage("/sitemapper?sitemap=studio.map")).toBe("The Sitemap id is malformed.");
    expect(invalidMessage("/sitemapper?sitemap=studio-map&page=..")).toBe("The Sitemap page id is malformed.");
    expect(invalidMessage("/media?asset=%2Fetc%2Fpasswd")).toBe("The Media asset id is malformed.");
  });

  it("rejects a repeated or empty parameter", () => {
    expect(invalidMessage("/content?model=a&model=b")).toBe("This link must include one Content model id.");
    expect(invalidMessage("/content?model=")).toBe("This link must include one Content model id.");
    expect(invalidMessage("/media?asset=&asset=hero-image")).toBe("This link must include one Media asset id.");
    expect(invalidMessage("/composer?new=1&new=1")).toBe("This Composer link must include one new-Composition flag.");
  });

  it("rejects a dependent parameter without its owner", () => {
    expect(invalidMessage("/content?entry=news-entry-welcome")).toBe("This Content link must include one Content model id.");
    expect(invalidMessage("/sitemapper?page=page-1")).toBe("This Sitemapper link must include one Sitemap id.");
  });

  it("keeps the Composer new-Composition flag exact", () => {
    expect(invalidMessage("/composer?new=0")).toBe("The Composer new-Composition flag must be 1.");
    expect(invalidMessage("/composer?new=true")).toBe("The Composer new-Composition flag must be 1.");
  });
});

describe("formatIntent", () => {
  it("round-trips every intent through parseIntent", () => {
    const intents: readonly RouteIntent[] = [
      { route: "composer", action: "new" },
      { route: "content", modelId: "news-collection" },
      { route: "content", modelId: "news-collection", entryId: "news-entry-welcome" },
      { route: "sitemapper", sitemapId: "studio-map" },
      { route: "sitemapper", sitemapId: "studio-map", pageId: "page-1" },
      { route: "media", assetId: "hero-image" },
    ];
    for (const intent of intents) expect(matched(formatIntent(intent))).toEqual(intent);
  });

  it("builds the canonical parameter order", () => {
    expect(formatIntent({ route: "composer", action: "new" })).toBe("/composer?new=1");
    expect(formatIntent({ route: "content", modelId: "news-collection", entryId: "news-entry-welcome" })).toBe("/content?model=news-collection&entry=news-entry-welcome");
    expect(formatIntent({ route: "sitemapper", sitemapId: "studio-map", pageId: "page-1" })).toBe("/sitemapper?sitemap=studio-map&page=page-1");
    expect(formatIntent({ route: "media", assetId: "hero-image" })).toBe("/media?asset=hero-image");
  });
});
