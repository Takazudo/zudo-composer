// The committed site compiled in Node exactly as the static build does it
// (release policy, exact Assets lock from cms/assets), then every route's
// evaluated documents rendered through the pack's own components.
import { resolve } from "node:path";
import { h, type ComponentChildren, type ComponentType } from "preact";
import { renderToString } from "preact-render-to-string";
import { beforeAll, describe, expect, it } from "vitest";
import type { CompositionNode } from "../../../src/composer/model/types";
import type { SiteCompiledRoute } from "../../../src/site-project/compiler";
import { compileStaticSite, type StaticSiteCompilation } from "../../../scripts/site-static/compile";
import { componentPack } from "../components/pack";

const packageRoot = resolve(import.meta.dirname, "..");

const ARTICLES = {
  "a-desk-with-one-thing-on-it": "A desk with one thing on it",
  "choosing-tools-you-can-repair": "Choosing tools you can repair",
  "notes-that-survive-the-week": "Notes that survive the week",
  "reading-slowly-on-purpose": "Reading slowly on purpose",
  "sharpen-before-you-cut": "Sharpen before you cut",
  "the-half-finished-list": "The half-finished list",
  "the-quiet-hour": "The quiet hour",
  "why-drafts-should-look-unfinished": "Why drafts should look unfinished",
};

const H1_BY_ROUTE: Record<string, string> = {
  "/": "Notes from the margin",
  "/articles": "All articles",
  ...Object.fromEntries(Object.entries(ARTICLES).map(([slug, title]) => [`/articles/${slug}`, title])),
  "/craft": "Craft",
  "/attention": "Attention",
  "/tools": "Tools",
  "/authors": "Authors",
  "/authors/mina-okafor": "Mina Okafor",
  "/authors/teodor-lindqvist": "Teodor Lindqvist",
  "/about": "About Margin Notes",
  "/newsletter": "The Sunday note",
};

const manifestById = new Map(componentPack.manifest.components.map((component) => [component.id, component]));

function renderNodes(nodes: readonly CompositionNode[], outlet?: { parentId: string; slotId: string; nodes: readonly CompositionNode[] }): ComponentChildren[] {
  return nodes.map((node) => {
    const manifest = manifestById.get(node.componentId);
    const runtime = componentPack.runtime.components[node.componentId];
    if (!manifest || !runtime) throw new Error(`Unknown component ${node.componentId}`);
    const props: Record<string, unknown> = { ...node.props, key: node.id };
    for (const slot of manifest.slots ?? []) {
      const children = [...(node.slots[slot.id] ?? []), ...(outlet && outlet.parentId === node.id && outlet.slotId === slot.id ? outlet.nodes : [])];
      props[slot.prop] = renderNodes(children, outlet);
    }
    return h(runtime.component as ComponentType, props);
  });
}

function renderRoute(route: SiteCompiledRoute): string {
  const { document, linkedSource } = route.composition;
  const tree = linkedSource
    ? renderNodes(linkedSource.document.root, { ...linkedSource.outlet.target, nodes: document.root })
    : renderNodes(document.root);
  return renderToString(h("div", null, tree));
}

const textOf = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#39;/g, "'").replace(/&amp;/g, "&").trim();
const h1s = (html: string) => [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)].map(([, inner]) => textOf(inner!));
const count = (html: string, pattern: RegExp) => html.match(pattern)?.length ?? 0;

let compiled: StaticSiteCompilation;
const rendered = new Map<string, string>();

beforeAll(async () => {
  compiled = await compileStaticSite({ projectPath: resolve(packageRoot, "site-project.json"), pack: componentPack, assetsStoreRoot: resolve(packageRoot, "cms/assets") });
  for (const route of compiled.build.routes) rendered.set(route.pathname, renderRoute(route));
});

describe("demo-blog compiled site", () => {
  it("compiles exactly the 18 routes of docs/demo-sites/blog.md § 4", () => {
    expect(compiled.build.routes.map((route) => route.pathname).sort()).toEqual(Object.keys(H1_BY_ROUTE).sort());
  });

  it("renders one h1 per route with the expected heading, inside the Margin Notes frame", () => {
    for (const [pathname, heading] of Object.entries(H1_BY_ROUTE)) {
      const html = rendered.get(pathname)!;
      expect(h1s(html), pathname).toEqual([heading]);
      expect(html, pathname).toContain("Margin Notes");
      expect(html, pathname).toContain("Built with zudo-composer");
    }
  });

  it("titles entry routes from their entries", () => {
    const titles = Object.fromEntries(compiled.build.routes.map((route) => [route.pathname, route.displayTitle]));
    expect(titles["/articles/the-quiet-hour"]).toBe("The quiet hour");
    expect(titles["/authors/mina-okafor"]).toBe("Mina Okafor");
  });

  it("materialises all 8 article cards on home and /articles, newest first", () => {
    for (const pathname of ["/", "/articles"]) {
      const html = rendered.get(pathname)!;
      expect(count(html, /<article\b/g), pathname).toBe(8);
      expect([...html.matchAll(/<h3\b[^>]*><a[^>]*>([^<]+)<\/a><\/h3>/g)].map(([, title]) => title)[0], pathname).toBe("Reading slowly on purpose");
    }
  });

  it("gives each tag page only the articles carrying that tag", () => {
    expect(count(rendered.get("/craft")!, /<article\b/g)).toBe(4);
    expect(count(rendered.get("/attention")!, /<article\b/g)).toBe(4);
    expect(count(rendered.get("/tools")!, /<article\b/g)).toBe(3);
  });

  it("builds every article page from its entry: pinned images, body, author link, related cards and comments", () => {
    const html = rendered.get("/articles/sharpen-before-you-cut")!;
    expect(html).toContain("min read");
    expect(html).toContain("Stop sharpening when it cuts");
    expect(html).toContain('href="/authors/teodor-lindqvist"');
    expect(html).toContain('href="/tools"');
    expect(html).not.toContain("/uploaded-assets/asset-");
    expect(count(html, /src="\/uploaded-assets\/sha256-[0-9a-f]{64}\.webp"/g)).toBeGreaterThanOrEqual(3);
    // "Keep reading" is a limit-4 attachment; the card for this page hides itself in the browser.
    expect(count(html, /<article\b/g)).toBe(4);
    // All 12 comments are materialised; each hides itself unless its articleSlug matches the route.
    expect(count(html, /<li class="border-t border-blog-border py-blog-vsp-md"/g)).toBe(12);
  });

  it("lists both authors and lets each author page carry every article for the card filter", () => {
    expect(count(rendered.get("/authors")!, /<aside\b/g)).toBe(2);
    expect(rendered.get("/authors")!).toContain('href="/authors/mina-okafor"');
    expect(count(rendered.get("/authors/mina-okafor")!, /<article\b/g)).toBe(8);
  });

  it("pins every seeded image and delivers the about page's markdown image", () => {
    expect(compiled.assetFiles).toHaveLength(10);
    expect(rendered.get("/about")!).toMatch(/src="\/uploaded-assets\/sha256-[0-9a-f]{64}\.webp"/);
  });
});
