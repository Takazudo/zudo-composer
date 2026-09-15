import { describe, expect, it } from "vitest";
import type { ComponentPackManifest } from "@zudo-composer/component-contract";
import { defineSite } from "zudo-composer/authoring";

const manifest = { contractVersion: 2, packId: "t", packVersion: "1.0.0", components: [] } as unknown as ComponentPackManifest;

describe("entry values keyed by field key", () => {
  it("stores nested object values under their nested field ids, including inside lists", () => {
    const site = defineSite({ id: "t", name: "T", componentPack: { manifest } });
    const image = [{ key: "src", kind: "url" as const }, { key: "alt", kind: "text" as const }];
    const model = site.model({ name: "Posts", kind: "collection", fields: [
      { key: "slug", kind: "slug" },
      { key: "cover", kind: "object", fields: image },
      { key: "gallery", kind: "list", item: { kind: "object", fields: [{ id: "posts-gallery-src", key: "src", label: "Src", required: true, kind: "url" }] } },
    ] });
    const entry = site.entry(model, { values: { slug: "a", cover: { src: "/x.webp", alt: "X" }, gallery: [{ src: "/y.webp" }] } });
    expect(entry.record.values).toEqual({ "posts-slug": "a", "posts-cover": { "posts-cover-src": "/x.webp", "posts-cover-alt": "X" }, "posts-gallery": [{ "posts-gallery-src": "/y.webp" }] });
    expect(() => site.entry(model, { values: { slug: "b", cover: { href: "/z" } } })).toThrow(/no nested field "href"/);
  });
});
