import { render } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import * as packModule from "../components/pack";
import { isCurrentPath } from "../components/chrome";
import { splitEmphasis } from "../components/hero";
import { formatPrice } from "../components/pricing";
import { parseMarkdown } from "../components/prose";
import { manifestOf, renderNode, type TestNode } from "./render-node";

const { componentPack } = packModule;
const html = (node: TestNode) => render(renderNode(node));
const leaf = (componentId: string, props: Record<string, unknown> = {}): TestNode => ({ id: componentId, componentId, props });
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

describe("demo-landing pack", () => {
  const components = componentPack.manifest.components;

  it("ships every component of the spec inventory under the land. prefix", () => {
    expect(components.map((component) => component.id).sort()).toEqual([
      "land.button", "land.comparison-note", "land.contact-form", "land.container", "land.cta-band", "land.demo-note",
      "land.faq-accordion", "land.faq-item", "land.feature-grid", "land.feature-item", "land.footer", "land.grid",
      "land.header", "land.hero", "land.image", "land.logo-strip", "land.nav-link", "land.pricing-table",
      "land.pricing-tier", "land.prose", "land.section", "land.section-heading", "land.signup-form", "land.split",
      "land.stack", "land.stats", "land.step", "land.steps-row", "land.testimonial", "land.testimonials",
    ]);
  });

  it("exports every component from the pack module under its source export name", () => {
    for (const component of components) {
      expect(component.source).toEqual({ module: "demo-landing/components", exportKind: "named", exportName: component.source.exportName });
      expect(packModule[component.source.exportName as keyof typeof packModule], component.id).toBe(componentPack.runtime.components[component.id]!.component);
    }
  });

  it("gives every field a default and never takes a list as a prop", () => {
    for (const component of components) {
      for (const field of component.fields) {
        expect(Object.hasOwn(component.defaults, field.prop), `${component.id}.${field.prop}`).toBe(true);
        expect(["array", "tuple", "object"], `${component.id}.${field.prop}`).not.toContain(field.schema.type);
      }
    }
  });

  it("declares the list slots as many-cardinality slots accepting only their item component", () => {
    const listSlots = Object.fromEntries(components.flatMap((component) => component.slots.filter((slot) => slot.accepts?.length === 1 && slot.cardinality === "many").map((slot) => [`${component.id}#${slot.id}`, slot.accepts![0]])));
    expect(listSlots).toEqual({
      "land.header#nav": "land.nav-link",
      "land.footer#nav": "land.nav-link",
      "land.feature-grid#items": "land.feature-item",
      "land.steps-row#steps": "land.step",
      "land.pricing-table#tiers": "land.pricing-tier",
      "land.testimonials#testimonials": "land.testimonial",
      "land.faq-accordion#items": "land.faq-item",
    });
    const ids = new Set(components.map((component) => component.id));
    for (const slot of components.flatMap((component) => component.slots)) for (const accepted of slot.accepts ?? []) expect(ids.has(accepted)).toBe(true);
  });

  it.each(componentPack.manifest.components.map((component) => component.id))("%s renders from its defaults alone", (id) => {
    const output = html(leaf(id));
    expect(output.length).toBeGreaterThan(0);
    expect(output).not.toMatch(/undefined|NaN|\[object Object\]/);
  });
});

describe("chrome", () => {
  it("renders the header with nav links and one secondary action", () => {
    const output = html({
      id: "header",
      componentId: "land.header",
      slots: {
        nav: [leaf("land.nav-link", { label: "Features", href: "/features" }), leaf("land.nav-link", { label: "Pricing", href: "/pricing" })],
        action: [leaf("land.button", { label: "Start free", href: "/#signup", variant: "secondary" })],
      },
    });
    expect(output).toContain(">Orrery</span>");
    expect(output).toContain('href="/pricing"');
    expect(output).toContain("border-land-border");
    expect(output).not.toContain("bg-land-accent");
  });

  it("styles primary buttons with the accent and secondary ones with a border", () => {
    expect(html(leaf("land.button", { variant: "primary" }))).toContain("bg-land-accent text-land-accent-fg hover:bg-land-accent-strong");
    expect(html(leaf("land.button", { variant: "primary" }))).toContain("rounded-land-pill");
    expect(html(leaf("land.button", { variant: "secondary" }))).toContain("border border-land-border text-land-fg-strong hover:bg-land-surface-2");
  });

  it("credits the tool in the footer", () => {
    const output = html({ id: "footer", componentId: "land.footer", slots: { nav: [leaf("land.nav-link", { label: "Terms", href: "/terms" })] } });
    expect(output).toContain("Built with zudo-composer");
    expect(output).toContain('href="/terms"');
  });

  it("marks a nav link current by path, including under a mount prefix", () => {
    expect(isCurrentPath("/pricing", "/pricing")).toBe(true);
    expect(isCurrentPath("/pricing", "/site/pricing/")).toBe(true);
    expect(isCurrentPath("/", "/")).toBe(true);
    expect(isCurrentPath("/", "/pricing")).toBe(false);
    expect(isCurrentPath("/#signup", "/")).toBe(false);
    expect(isCurrentPath("https://example.com/pricing", "/pricing")).toBe(false);
  });
});

describe("layout", () => {
  it("anchors a section and bands it only on request", () => {
    expect(html(leaf("land.section", { anchor: "pricing" }))).toContain('id="pricing"');
    expect(html(leaf("land.section"))).not.toContain("id=");
    expect(html(leaf("land.section", { band: true }))).toContain("bg-land-surface-2");
    expect(html(leaf("land.section"))).not.toContain("bg-land-surface-2");
  });

  it("renders the section heading at the requested level", () => {
    expect(html(leaf("land.section-heading", { as: "h1", heading: "Pricing" }))).toContain('<h1 class="text-land-h1-compact land-md:text-land-h1 tracking-land-tight text-land-fg-strong">Pricing</h1>');
    expect(html(leaf("land.section-heading", { eyebrow: "Planning" }))).toContain("uppercase tracking-land-caps");
  });

  it("puts a single image into the split media slot", () => {
    const output = html({ id: "split", componentId: "land.split", props: { reverse: true }, slots: { media: [leaf("land.image", { src: "/uploaded-assets/asset-1", alt: "Cards" })], copy: [leaf("land.prose")] } });
    expect(output).toContain('src="/uploaded-assets/asset-1"');
    expect(output).toContain("land-md:order-last");
  });

  it("shows a placeholder instead of a broken image when the source is empty", () => {
    expect(html(leaf("land.image", { src: "", alt: "Cards" }))).toContain('role="img" aria-label="Cards"');
  });
});

describe("marketing sections", () => {
  it("renders the hero with one accent word, one primary button and the only shadow", () => {
    const output = html(leaf("land.hero", { src: "/uploaded-assets/asset-hero" }));
    expect(output).toContain('<span class="text-land-accent">one view</span>');
    expect(count(output, "bg-land-accent ")).toBe(1);
    expect(count(output, "shadow-land-hero")).toBe(1);
    expect(output).toContain('href="/pricing"');
  });

  it("emphasises only a substring of the heading", () => {
    expect(splitEmphasis("Every moving part", "moving")).toEqual(["Every ", "moving", " part"]);
    expect(splitEmphasis("Every moving part", "absent")).toBeNull();
    expect(splitEmphasis("Every moving part", "")).toBeNull();
  });

  it("clamps the logo strip to three to six wordmarks", () => {
    expect(count(html(leaf("land.logo-strip", { count: 10 })), "<svg")).toBe(6);
    expect(count(html(leaf("land.logo-strip", { count: 1 })), "<svg")).toBe(3);
    expect(html(leaf("land.logo-strip"))).toContain('aria-label="Halden &amp; Co"');
  });

  it("gives the accent-soft chip only to the emphasised feature", () => {
    const output = html({
      id: "features",
      componentId: "land.feature-grid",
      slots: { items: [leaf("land.feature-item", { emphasis: true }), leaf("land.feature-item", { icon: "lock" }), leaf("land.feature-item", { icon: "bell" })] },
    });
    expect(count(output, "bg-land-accent-soft")).toBe(1);
    expect(count(output, "<article")).toBe(3);
    expect(output).toContain("land-lg:grid-cols-3");
  });

  it("numbers steps inside an ordered list", () => {
    const output = html({ id: "steps", componentId: "land.steps-row", slots: { steps: [leaf("land.step", { number: 2, title: "Share" })] } });
    expect(output).toMatch(/^<ol/);
    expect(output).toContain(">02</span>");
  });

  it("skips empty stats", () => {
    const output = html(leaf("land.stats", { stat3Value: "" }));
    expect(count(output, "<dd")).toBe(2);
  });

  it("renders testimonials with avatar, name and role", () => {
    const output = html({ id: "t", componentId: "land.testimonials", slots: { testimonials: [leaf("land.testimonial", { src: "/uploaded-assets/asset-mara" })] } });
    expect(output).toContain('src="/uploaded-assets/asset-mara"');
    expect(output).toContain("Mara Lind");
    expect(output).toContain("Operations lead, Quarto");
    expect(output).not.toContain("shadow");
  });

  it("puts exactly one primary button in the CTA band", () => {
    expect(count(html(leaf("land.cta-band")), "bg-land-accent ")).toBe(1);
  });

  it("makes FAQ rows exclusive through a shared details name unless several may open", () => {
    const rows = [leaf("land.faq-item", { question: "One" }), leaf("land.faq-item", { question: "Two", topic: "billing" })];
    const exclusive = html({ id: "faq", componentId: "land.faq-accordion", slots: { items: rows } });
    const names = [...exclusive.matchAll(/<details name="([^"]+)"/g)].map((match) => match[1]);
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(1);
    expect(exclusive).toContain('data-topic="billing"');
    expect(html({ id: "faq", componentId: "land.faq-accordion", props: { allowMultiple: true }, slots: { items: rows } })).not.toContain("<details name=");
  });

  it("formats prices in the tier currency", () => {
    expect(formatPrice(12, "USD")).toBe("$12");
    expect(formatPrice(9.5, "USD")).toBe("$9.50");
    expect(formatPrice(12, "not-a-currency")).toBe("12 not-a-currency");
  });
});

describe("prose", () => {
  it("parses the markdown subset into blocks", () => {
    expect(parseMarkdown("# Title\n\nFirst line\nsecond line\n\n- a\n- b\n\n1. one\n2. two\n\n### Small")).toEqual([
      { kind: "h2", text: "Title" },
      { kind: "p", text: "First line second line" },
      { kind: "ul", items: ["a", "b"] },
      { kind: "ol", items: ["one", "two"] },
      { kind: "h3", text: "Small" },
    ]);
  });

  it("renders inline marks and safe links, and never passes HTML through", () => {
    const output = html(leaf("land.prose", { markdown: "**Bold** and *soft* with [docs](/docs), [bad](javascript:alert(1)) and <script>x</script>" }));
    expect(output).toContain('<strong class="font-land-semibold text-land-fg-strong">Bold</strong>');
    expect(output).toContain("<em>soft</em>");
    expect(output).toContain('<a href="/docs" class="text-land-link underline decoration-land-border');
    expect(output).not.toContain("javascript:");
    expect(output).toContain("&lt;script>");
  });

  it("keeps text links off the accent", () => {
    expect(html(leaf("land.comparison-note"))).not.toContain("land-accent");
    expect(manifestOf("land.comparison-note").fields[0]!.editor).toEqual({ kind: "text", multiline: true, mode: "markdown-source" });
  });
});
