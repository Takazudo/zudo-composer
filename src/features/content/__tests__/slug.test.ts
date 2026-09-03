import { describe, expect, it } from "vitest";
import { deriveSlug } from "../slug";

describe("deriveSlug", () => {
  it("lowercases words and joins them with single hyphens", () => {
    expect(deriveSlug("Welcome to the Newsroom")).toBe("welcome-to-the-newsroom");
    expect(deriveSlug("Hello,   World!")).toBe("hello-world");
    expect(deriveSlug("Release 2.0 — what changed?")).toBe("release-2-0-what-changed");
  });

  it("trims the hyphens a leading or trailing separator would leave", () => {
    expect(deriveSlug("  spaced  ")).toBe("spaced");
    expect(deriveSlug("--- ---")).toBe("");
    expect(deriveSlug("")).toBe("");
  });

  it("keeps non-Latin letters as themselves rather than transliterating them", () => {
    // Content stores non-ASCII slugs verbatim, and folding "ガ" to "カ" — which
    // stripping combining marks after NFKD would do — changes the word.
    expect(deriveSlug("東京タワー")).toBe("東京タワー");
    expect(deriveSlug("ガイド 01")).toBe("ガイド-01");
    expect(deriveSlug("Café Zudo")).toBe("café-zudo");
  });

  it("treats underscores and repeated punctuation as one separator", () => {
    expect(deriveSlug("snake_case__title")).toBe("snake-case-title");
    expect(deriveSlug("a/b\\c")).toBe("a-b-c");
  });

  it("is a pure function of its argument", () => {
    const title = "Same Title";
    expect(deriveSlug(title)).toBe(deriveSlug(title));
  });
});
