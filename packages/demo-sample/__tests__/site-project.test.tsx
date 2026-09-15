import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { h, type ComponentType, type VNode } from "preact";
import { render as renderToString } from "preact-render-to-string";
import { componentPack } from "@zudo-sg/ui/composer-pack";
import { beforeAll, describe, expect, it } from "vitest";
import { canonicalStringifyJson, validateSiteProject } from "zudo-composer/authoring";
import { compileStaticSite, type StaticSiteCompilation } from "zudo-composer/site-build";
import type { CompositionNode, SitemapNode } from "zudo-composer/site-project";
import site from "../site-project";
import config from "../zudo-composer.config";

const packageRoot = resolve(import.meta.dirname, "..");
const projectPath = resolve(packageRoot, "site-project.json");
// SHA-256 of the original Sample Studio fixture at conversion. This exact-byte
// assertion keeps the host self-contained, without a second JSON input or a
// dependency on the tool repository's test files.
const originalDigest = "595ac0a346bc2fdb9300968bcab1e2d5c007ce32753be21e763908c0f532ebba";
const headings: Record<string, string> = {
  "/": "Clear ideas, carefully shaped",
  "/about": "A studio built around useful clarity",
  "/services": "Ways to work together",
  "/journal": "Working notes",
  "/journal/map-the-moving-parts": "Map the moving parts",
  "/journal/review-in-small-loops": "Review in small loops",
  "/journal/start-with-the-question": "Start with the question",
};

let compiled: StaticSiteCompilation;
beforeAll(async () => {
  compiled = await compileStaticSite({ projectPath, pack: componentPack, assetsStoreRoot: resolve(packageRoot, "cms/assets") });
});

const route = (pathname: string) => {
  const found = compiled.build.routes.find((candidate) => candidate.pathname === pathname);
  if (!found) throw new Error(`Missing Sample Studio route ${pathname}`);
  return found;
};

// Render the installed pack's components, projecting the declared slots onto
// their runtime props. This exercises the provider's real h1 markup in Node.
function renderNode(node: CompositionNode): VNode {
  const manifest = componentPack.manifest.components.find((component) => component.id === node.componentId);
  if (!manifest) throw new Error(`Missing provider component ${node.componentId}`);
  const Component = componentPack.runtime.components[node.componentId]!.component as ComponentType<Record<string, unknown>>;
  const props: Record<string, unknown> = { ...manifest.defaults, ...node.props };
  for (const slot of manifest.slots) {
    const children = (node.slots[slot.id] ?? []).map(renderNode);
    props[slot.prop] = slot.cardinality === "single" ? children[0] : children;
  }
  return h(Component, { ...props, key: node.id });
}

const countPages = (nodes: readonly SitemapNode[]): number => nodes.reduce((count, node) => count + 1 + countPages(node.children), 0);

describe("Sample Studio host", () => {
  it("generates the original exact bytes through the public DSL and themeset", async () => {
    const bytes = await readFile(projectPath);
    const validation = validateSiteProject(site.toSiteProject(), { componentPack: componentPack.manifest });
    expect(validation.ok, JSON.stringify(validation.diagnostics)).toBe(true);
    if (!validation.ok) return;
    expect(canonicalStringifyJson(validation.project as never)).toBe(bytes.toString("utf8"));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(originalDigest);
    expect(config.pack).toBe("@zudo-sg/ui/composer-pack");
    expect(compiled.project.componentPack).toEqual({ contractVersion: 2, packId: "@zudo-sg/ui", packVersion: "1.0.0" });
    expect(compiled.project.id).toBe("sample-studio-site");
    expect(compiled.project.name).toBe("Sample Studio");
  });

  it("keeps the six compositions, two models, two mappings and five sitemap rows", () => {
    const { providers } = compiled.project;
    expect(providers.compositions[0]!.records.map(({ document }) => document.name)).toEqual([
      "About page", "Home page", "Journal entry page", "Journal index page", "Services page", "Site frame",
    ]);
    expect(providers.content[0]!.models.map(({ document }) => [document.name, document.kind])).toEqual([
      ["About content", "single"], ["Journal articles", "collection"],
    ]);
    expect(providers.content[0]!.entries).toHaveLength(4);
    expect(providers.content[0]!.entries.every((entry) => entry.lifecycle === "published")).toBe(true);
    expect(providers.mappings[0]!.records.map(({ document }) => document.name)).toEqual(["About page mapping", "Journal entry mapping"]);
    const sitemap = providers.sitemaps[0]!.records[0]!.document;
    expect(sitemap.name).toBe("Sample Studio sitemap");
    expect(countPages(sitemap.root)).toBe(5);
    expect(compiled.project.collectionAttachments).toEqual([]);
  });

  it("compiles every delivery route with exactly one expected h1", () => {
    expect(compiled.build.routes.map(({ pathname }) => pathname).sort()).toEqual(Object.keys(headings).sort());
    for (const [pathname, heading] of Object.entries(headings)) {
      const page = route(pathname);
      const html = renderToString(<>{page.composition.document.root.map(renderNode)}</>);
      const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map(([, inner]) => inner!.replace(/<[^>]+>/g, ""));
      expect(h1s, pathname).toEqual([heading]);
      expect(page.composition.linkedSource?.ref.recordId, pathname).toBe("site-frame");
    }
    expect(compiled.build.routes.map(({ pathname }) => `/site${pathname === "/" ? "" : pathname}`)).not.toContain("/site/does-not-exist");
    expect(compiled.assetFiles).toEqual([]);
  });

  it("resolves both mappings with their published content and journal dates", () => {
    expect(route("/about").source).toEqual({ kind: "mapping", ref: { providerId: "mapping-filesystem", recordId: "about-page-mapping" } });
    expect(route("/about").composition.document.root.find((node) => node.id === "about-body")!.props.markdown).toContain("## Who we are");
    const articles = [
      ["map-the-moving-parts", "Draw the relationships", "Aug 12, 2026"],
      ["review-in-small-loops", "Share something concrete", "Aug 19, 2026"],
      ["start-with-the-question", "Begin with purpose", "Aug 5, 2026"],
    ];
    for (const [slug, bodyHeading, date] of articles) {
      const page = route(`/journal/${slug}`);
      expect(page.source).toEqual({ kind: "mapping", ref: { providerId: "mapping-filesystem", recordId: "journal-entry-mapping" } });
      expect(page.displayTitle).toBe(headings[page.pathname]);
      expect(page.composition.document.root.find((node) => node.id === "journal-entry-body")!.props.markdown).toContain(`## ${bodyHeading}`);
      expect(page.composition.document.root.find((node) => node.id === "journal-entry-date")!.props.children).toBe(date);
    }
  });

  it("preserves the primary and footer menus and breadcrumb ancestors", () => {
    const { navigation } = compiled.build;
    expect(navigation.diagnostics).toEqual([]);
    for (const menu of [navigation.primary, navigation.footer]) {
      expect(menu.map(({ label, href }) => [label, href])).toEqual([
        ["Home", "/"], ["About", "/about"], ["Services", "/services"], ["Journal", "/journal"],
      ]);
    }
    expect(route("/").ancestors).toEqual([]);
    for (const pathname of ["/about", "/services", "/journal"]) {
      expect(route(pathname).ancestors.map(({ displayTitle }) => displayTitle)).toEqual(["Home"]);
    }
    for (const pathname of Object.keys(headings).filter((pathname) => pathname.startsWith("/journal/"))) {
      expect(route(pathname).ancestors.map(({ displayTitle }) => displayTitle)).toEqual(["Home", "Journal"]);
    }
  });
});
