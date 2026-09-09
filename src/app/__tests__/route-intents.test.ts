import { describe, expect, it } from "vitest";
import { decodeContentValuePath, encodeContentValuePath, formatIntent, parseIntent, type RouteIntent } from "../route-intents";

describe("strict workspace intents", () => {
  it("round-trips every provider-qualified target and declarative view", () => {
    const intents: RouteIntent[] = [
      { route: "composer", action: "new" },
      { route: "composer", providerId: "files", compositionId: "page" },
      { route: "content", providerId: "editorial", modelId: "people" },
      { route: "content", providerId: "catalog", modelId: "people", entryId: "person", viewId: "contact" },
      { route: "content", providerId: "catalog", modelId: "people", entryId: "person", fieldId: "gallery", valuePath: [2, "caption"] },
      { route: "mapping", providerId: "mapping-filesystem", mappingId: "card" },
      { route: "sitemapper", providerId: "sitemap-filesystem", sitemapId: "site", pageId: "home" },
      { route: "assets", providerId: "asset-files", assetId: "portrait" },
      { route: "review" },
    ];
    for (const intent of intents) expect(parseIntent(formatIntent(intent))).toEqual({ status: "matched", intent });
  });
  it("round-trips typed Content value pointers without confusing numeric field ids and list indexes", () => {
    expect(encodeContentValuePath(["123", 0, "caption"])).toBe("/f:123/i:0/f:caption");
    expect(decodeContentValuePath("/f:123/i:0/f:caption")).toEqual(["123", 0, "caption"]);
  });
  it("does not treat an isolated preview or bare module as a record", () => {
    for (const href of ["/", "/composer/preview?new=1", "/composer", "/content", "/assets", "/mapping", "/sitemapper"]) expect(parseIntent(href)).toEqual({ status: "none" });
  });
  it("rejects missing, duplicated, empty, malformed and unexpected parameters without fallback", () => {
    for (const href of [
      "/content?model=people", "/content?provider=one&provider=two&model=people", "/content?provider=one&model=people&model=other",
      "/content?provider=one&entry=person", "/content?provider=one&model=people&view=", "/content?provider=one&model=people&view=a&view=b",
      "/content?provider=one&model=People", "/content?provider=one&model=people&entry=../private", "/content?provider=../one&model=people",
      "/content?provider=one&model=people&tab=entries", "/composer?new=1&new=1", "/composer?new=0", "/composer?new=1&provider=files",
      "/content?provider=one&model=people&field=title", "/content?provider=one&model=people&entry=person&path=%2Ff%3Atitle",
      "/content?provider=one&model=people&entry=person&field=title&path=title", "/content?provider=one&model=people&entry=person&field=title&path=%2Fi%3A-1",
      "/content?provider=one&model=people&entry=person&field=title&path=%2Ff%3Atitle&path=%2Ff%3Aother",
      "/composer?provider=files", "/composer#/composition/files/page", "/mapping?provider=one&mapping=x&mapping=y", "/assets?provider=one&asset=",
      "/sitemapper?provider=one&page=home", "/review?provider=one",
    ]) expect(parseIntent(href), href).toMatchObject({ status: "invalid" });
  });
  it("accepts locations and URLs, and refuses invalid typed builders at runtime", () => {
    const url = new URL("https://example.test/assets?provider=asset-files&asset=hero");
    expect(parseIntent(url)).toEqual(parseIntent({ pathname: url.pathname, search: url.search }));
    expect(() => formatIntent({ route: "content", providerId: "one", modelId: "../wrong" })).toThrow();
  });
});
