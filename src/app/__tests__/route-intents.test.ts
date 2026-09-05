import { describe, expect, it } from "vitest";
import { formatIntent, parseIntent, type RouteIntent } from "../route-intents";

describe("strict workspace intents", () => {
  it("round-trips every provider-qualified target and declarative view", () => {
    const intents: RouteIntent[] = [
      { route: "composer", action: "new" },
      { route: "composer", providerId: "files", compositionId: "page" },
      { route: "content", providerId: "editorial", modelId: "people" },
      { route: "content", providerId: "catalog", modelId: "people", entryId: "person", viewId: "contact" },
      { route: "mapping", providerId: "mapping-indexeddb", mappingId: "card" },
      { route: "sitemapper", providerId: "sitemap-indexeddb", sitemapId: "site", pageId: "home" },
      { route: "media", providerId: "media-files", assetId: "portrait" },
      { route: "review" },
    ];
    for (const intent of intents) expect(parseIntent(formatIntent(intent))).toEqual({ status: "matched", intent });
  });
  it("does not treat an isolated preview or bare module as a record", () => {
    for (const href of ["/", "/composer/preview?new=1", "/composer", "/content", "/media", "/mapping", "/sitemapper"]) expect(parseIntent(href)).toEqual({ status: "none" });
  });
  it("rejects missing, duplicated, empty, malformed and unexpected parameters without fallback", () => {
    for (const href of [
      "/content?model=people", "/content?provider=one&provider=two&model=people", "/content?provider=one&model=people&model=other",
      "/content?provider=one&entry=person", "/content?provider=one&model=people&view=", "/content?provider=one&model=people&view=a&view=b",
      "/content?provider=one&model=People", "/content?provider=one&model=people&entry=../private", "/content?provider=../one&model=people",
      "/content?provider=one&model=people&tab=entries", "/composer?new=1&new=1", "/composer?new=0", "/composer?new=1&provider=files",
      "/composer?provider=files", "/composer#/composition/files/page", "/mapping?provider=one&mapping=x&mapping=y", "/media?provider=one&asset=",
      "/sitemapper?provider=one&page=home", "/review?provider=one",
    ]) expect(parseIntent(href), href).toMatchObject({ status: "invalid" });
  });
  it("accepts locations and URLs, and refuses invalid typed builders at runtime", () => {
    const url = new URL("https://example.test/media?provider=media-files&asset=hero");
    expect(parseIntent(url)).toEqual(parseIntent({ pathname: url.pathname, search: url.search }));
    expect(() => formatIntent({ route: "content", providerId: "one", modelId: "../wrong" })).toThrow();
  });
});
