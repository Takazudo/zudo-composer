import { describe, expect, it } from "vitest";
import { buildSitemapOutline, pageOutlineStatus } from "../outline-model";
import { fixtureDocument, page } from "./fixtures";

describe("Sitemap outline model", () => {
  it("makes the root a category and derives every page's authored route", () => {
    const document = fixtureDocument();
    document.root[0]!.children[0]!.slug = "about";
    document.root[0]!.children[0]!.children[0]!.slug = "team";
    const outline = buildSitemapOutline(document);

    expect(outline.nodes).toHaveLength(1);
    expect(outline.nodes[0]).toMatchObject({ id: "home", kind: "category", slug: "/", count: 3 });
    expect(outline.routes.get("home")).toBe("/");
    expect(outline.routes.get("about")).toBe("/about");
    expect(outline.routes.get("team")).toBe("/about/team");
  });

  it("is a group only once a page has children, so a leaf can still become one", () => {
    const outline = buildSitemapOutline(fixtureDocument());
    const [about, contact] = outline.nodes[0]!.children!;
    expect(about).toMatchObject({ id: "about", kind: "group", count: 1 });
    expect(contact).toMatchObject({ id: "contact", kind: "leaf" });
    expect(contact).not.toHaveProperty("count");

    const grown = fixtureDocument();
    grown.root[0]!.children[1]!.children.push(page("support", "Support"));
    const regrown = buildSitemapOutline(grown);
    expect(regrown.nodes[0]!.children![1]).toMatchObject({ id: "contact", kind: "group", count: 1 });
  });

  it("gives every source kind its own dot", () => {
    expect(pageOutlineStatus(page("a"))).toEqual({ tone: "warn", label: "Unassigned" });
    expect(pageOutlineStatus({
      ...page("b"),
      source: { kind: "composition", ref: { providerId: "p", recordId: "c" } },
    })).toEqual({ tone: "ok", label: "Composition" });
    expect(pageOutlineStatus({
      ...page("c"),
      source: { kind: "mapping", ref: { providerId: "p", recordId: "m" }, route: { kind: "single" } },
    })).toEqual({ tone: "accent", label: "Mapping route family" });
  });
});
