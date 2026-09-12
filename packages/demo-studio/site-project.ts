// Sample Studio is authored here through the public DSL. The fixed identities
// and timestamp preserve its existing portable SiteProject byte for byte.
// Run `pnpm generate` after editing; the JSON and ready CMS are generated.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { componentPack } from "@zudo-sg/ui/composer-pack";
import { defineSite, node } from "zudo-composer/authoring";
import type { RouteInput } from "zudo-composer/site-project";

const readContent = (file: string): string => readFileSync(resolve(import.meta.dirname, "content", file), "utf8").trim();

const site = defineSite({
  id: "sample-studio-site",
  name: "Sample Studio",
  componentPack,
  timestamp: "2026-08-31T00:00:00.000Z",
  compositionOrder: "id",
});

// Global frame and page compositions.

const siteFrame = site.template({
  name: "Site frame",
  root: [
    node("ui.container", {}, {
      content: [
        node("ui.stack", { align: "stretch", direction: "vertical", gap: "xl", justify: "start" }, {
          content: [],
        }, "site-frame-stack"),
      ],
    }, "site-frame-container"),
  ],
  outlet: { id: "main-content", label: "Main content", target: { parentId: "site-frame-stack", slotId: "content" } },
});

const aboutPage = site.page({
  name: "About page",
  template: siteFrame,
  root: [
    node("ui.section-heading", { as: "h1", eyebrow: "Studio note", heading: "Static about heading", intro: "Static about introduction" }, {}, "about-heading"),
    node("ui.prose-md", { markdown: "Static about body" }, {}, "about-body"),
    node("ui.auto-grid", { fill: false, gap: "sm", min: "16rem" }, {
      items: [
        node("ui.card", { padding: "sm", title: "Direction", variant: "muted" }, {
          body: [
            node("ui.prose-p", { children: "We frame the decision before we design anything." }, {}, "about-card-direction-copy"),
          ],
        }, "about-card-direction"),
        node("ui.card", { padding: "sm", title: "Design", variant: "muted" }, {
          body: [
            node("ui.prose-p", { children: "We shape interfaces and words together, in visible drafts." }, {}, "about-card-design-copy"),
          ],
        }, "about-card-design"),
        node("ui.card", { padding: "sm", title: "Delivery", variant: "muted" }, {
          body: [
            node("ui.prose-p", { children: "We build on a fixed rhythm and hand over everything." }, {}, "about-card-delivery-copy"),
          ],
        }, "about-card-delivery"),
      ],
    }, "about-grid"),
    node("ui.callout", { title: "Office hours", tone: "muted" }, {
      body: [
        node("ui.prose-p", { children: "We keep Thursday afternoons open for short calls with teams who are not yet sure what they need." }, {}, "about-callout-copy"),
      ],
    }, "about-callout"),
  ],
});

const homePage = site.page({
  name: "Home page",
  template: siteFrame,
  root: [
    node("ui.hero", { actions: [{ href: "/services", label: "See our services", variant: "primary" }, { href: "/journal", label: "Read the journal", variant: "secondary" }], eyebrow: "Sample Studio", heading: "Clear ideas, carefully shaped", lead: "We are a four-person studio that helps small teams shape websites, tools and content. We work in short, visible cycles so every decision is easy to follow.", variant: "primary" }, {}, "home-hero"),
    node("ui.split-layout", { gap: "lg", ratio: "40/60" }, {
      left: [
        node("ui.placeholder-box", { aspect: "4/3", label: "Studio worktable", size: "lg" }, {}, "home-placeholder"),
      ],
      right: [
        node("ui.stack", { align: "start", direction: "vertical", gap: "sm", justify: "start" }, {
          content: [
            node("ui.prose-p", { children: "We turn open questions into useful systems. Most of our work is for teams of five to fifty people who need a clear next step." }, {}, "home-intro"),
            node("ui.prose-p", { children: "Every project runs in weekly cycles with something concrete to review. You see drafts early, and nothing ships without a shared decision." }, {}, "home-method"),
            node("ui.cta-button", { arrow: true, children: "How we work", href: "/about", variant: "secondary" }, {}, "home-cta"),
          ],
        }, "home-copy-stack"),
      ],
    }, "home-split"),
    node("ui.section-heading", { as: "h2", eyebrow: "Recent notes", heading: "From the journal", intro: "Short essays on the habits that keep our projects calm." }, {}, "home-journal-heading"),
    node("ui.auto-grid", { fill: false, gap: "md", min: "18rem" }, {
      items: [
        node("ui.card", { padding: "md", title: "Start with the question", variant: "accent" }, {
          body: [
            node("ui.prose-p", { children: "Before choosing a format or feature, name the question the work must answer." }, {}, "home-journal-card-question-copy"),
            node("ui.cta-button", { arrow: true, children: "Read about questions", href: "/journal/start-with-the-question", variant: "secondary" }, {}, "home-journal-card-question-link"),
          ],
        }, "home-journal-card-question"),
        node("ui.card", { padding: "md", title: "Map the moving parts", variant: "default" }, {
          body: [
            node("ui.prose-p", { children: "A lightweight map can reveal where timing, ownership, and information need attention." }, {}, "home-journal-card-parts-copy"),
            node("ui.cta-button", { arrow: true, children: "Read about mapping", href: "/journal/map-the-moving-parts", variant: "secondary" }, {}, "home-journal-card-parts-link"),
          ],
        }, "home-journal-card-parts"),
        node("ui.card", { padding: "md", title: "Review in small loops", variant: "default" }, {
          body: [
            node("ui.prose-p", { children: "Small reviews turn abstract agreement into specific, timely feedback." }, {}, "home-journal-card-loops-copy"),
            node("ui.cta-button", { arrow: true, children: "Read about reviews", href: "/journal/review-in-small-loops", variant: "secondary" }, {}, "home-journal-card-loops-link"),
          ],
        }, "home-journal-card-loops"),
      ],
    }, "home-journal-grid"),
    node("ui.callout", { title: "Working with us", tone: "muted" }, {
      body: [
        node("ui.prose-p", { children: "Most engagements begin with a one-hour call about the decision you are facing." }, {}, "home-callout-copy"),
        node("ui.cta-button", { arrow: false, children: "Start a conversation", href: "/about", variant: "secondary" }, {}, "home-callout-link"),
      ],
    }, "home-callout"),
  ],
});

const journalEntryPage = site.page({
  name: "Journal entry page",
  template: siteFrame,
  root: [
    node("ui.section-heading", { as: "h1", eyebrow: "Studio journal", heading: "Static journal heading", intro: "Static journal introduction" }, {}, "journal-entry-heading"),
    node("ui.prose-p", { children: "Static publication date" }, {}, "journal-entry-date"),
    node("ui.prose-md", { markdown: "Static journal body" }, {}, "journal-entry-body"),
    node("ui.callout", { title: "More notes", tone: "muted" }, {
      body: [
        node("ui.cta-button", { arrow: false, children: "Back to the journal", href: "/journal", variant: "secondary" }, {}, "journal-entry-callout-link"),
      ],
    }, "journal-entry-callout"),
  ],
});

const journalIndexPage = site.page({
  name: "Journal index page",
  template: siteFrame,
  root: [
    node("ui.section-heading", { as: "h1", eyebrow: "Journal", heading: "Working notes", intro: "Short essays on how we frame, map and review work, each drawn from a real kind of project." }, {}, "journal-index-heading"),
    node("ui.auto-grid", { fill: false, gap: "md", min: "18rem" }, {
      items: [
        node("ui.card", { padding: "md", title: "Start with the question", variant: "default" }, {
          body: [
            node("ui.prose-p", { children: "Published on 5 August 2026. Before choosing a format or feature, name the question the work must answer." }, {}, "journal-index-card-question-copy"),
            node("ui.cta-button", { arrow: true, children: "Read Start with the question", href: "/journal/start-with-the-question", variant: "secondary" }, {}, "journal-index-card-question-link"),
          ],
        }, "journal-index-card-question"),
        node("ui.card", { padding: "md", title: "Map the moving parts", variant: "accent" }, {
          body: [
            node("ui.prose-p", { children: "Published on 12 August 2026. A lightweight map can reveal where timing, ownership, and information need attention." }, {}, "journal-index-card-parts-copy"),
            node("ui.cta-button", { arrow: true, children: "Read Map the moving parts", href: "/journal/map-the-moving-parts", variant: "secondary" }, {}, "journal-index-card-parts-link"),
          ],
        }, "journal-index-card-parts"),
        node("ui.card", { padding: "md", title: "Review in small loops", variant: "muted" }, {
          body: [
            node("ui.prose-p", { children: "Published on 19 August 2026. Small reviews turn abstract agreement into specific, timely feedback." }, {}, "journal-index-card-loops-copy"),
            node("ui.cta-button", { arrow: true, children: "Read Review in small loops", href: "/journal/review-in-small-loops", variant: "secondary" }, {}, "journal-index-card-loops-link"),
          ],
        }, "journal-index-card-loops"),
      ],
    }, "journal-index-grid"),
    node("ui.callout", { title: "Get the notes", tone: "muted" }, {
      body: [
        node("ui.prose-p", { children: "We publish one note every few weeks and share it with clients in our monthly project letter." }, {}, "journal-index-callout-copy"),
      ],
    }, "journal-index-callout"),
  ],
});

const servicesPage = site.page({
  name: "Services page",
  template: siteFrame,
  root: [
    node("ui.section-heading", { as: "h1", eyebrow: "Services", heading: "Ways to work together", intro: "Three fixed-shape offers, from a two-week framing sprint to a steady delivery rhythm." }, {}, "services-heading"),
    node("ui.split-layout", { gap: "lg", ratio: "60/40" }, {
      left: [
        node("ui.prose-md", { markdown: readContent("services-engagement.md") }, {}, "services-engagement"),
      ],
      right: [
        node("ui.stack", { align: "start", direction: "vertical", gap: "md", justify: "start" }, {
          content: [
            node("ui.prose-p", { children: "Four people: a strategist, a designer, a writer and a developer." }, {}, "services-fact-team"),
            node("ui.prose-p", { children: "Most engagements last between two and twelve weeks." }, {}, "services-fact-length"),
            node("ui.prose-p", { children: "We bill a fixed fee per cycle, agreed before each cycle starts." }, {}, "services-fact-billing"),
          ],
        }, "services-facts"),
      ],
    }, "services-split"),
    node("ui.auto-grid", { fill: true, gap: "split", min: "16rem" }, {
      items: [
        node("ui.card", { padding: "lg", title: "Direction", variant: "accent" }, {
          body: [
            node("ui.prose-p", { children: "A two-week framing sprint that ends in a written brief your team can act on." }, {}, "services-card-direction-copy"),
            node("ui.prose-p", { children: "Starts from two weeks, one fixed fee." }, {}, "services-card-direction-price"),
            node("ui.cta-button", { arrow: true, children: "Ask about Direction", href: "/about", variant: "secondary" }, {}, "services-card-direction-link"),
          ],
        }, "services-card-direction"),
        node("ui.card", { padding: "md", title: "Design", variant: "default" }, {
          body: [
            node("ui.prose-p", { children: "Interface and content design in weekly visible cycles, reviewed with the people who will use it." }, {}, "services-card-design-copy"),
            node("ui.prose-p", { children: "Starts from four weekly cycles." }, {}, "services-card-design-price"),
            node("ui.cta-button", { arrow: true, children: "Ask about Design", href: "/about", variant: "secondary" }, {}, "services-card-design-link"),
          ],
        }, "services-card-design"),
        node("ui.card", { padding: "md", title: "Delivery", variant: "muted" }, {
          body: [
            node("ui.prose-p", { children: "Build, handoff and review points on a fixed rhythm, so your team can maintain the result." }, {}, "services-card-delivery-copy"),
            node("ui.prose-p", { children: "Starts from six weekly cycles." }, {}, "services-card-delivery-price"),
            node("ui.cta-button", { arrow: true, children: "Ask about Delivery", href: "/about", variant: "secondary" }, {}, "services-card-delivery-link"),
          ],
        }, "services-card-delivery"),
      ],
    }, "services-grid"),
    node("ui.callout", { title: "A flexible starting point", tone: "note" }, {
      body: [
        node("ui.prose-p", { children: "Not sure which offer fits? Start with a single Direction sprint. It stands on its own, and nothing after it is assumed." }, {}, "services-callout-copy"),
      ],
    }, "services-callout"),
  ],
});

// Models, entries and mapping field references use explicit persisted field IDs.

const aboutContent = site.model({
  name: "About content",
  kind: "single",
  fields: [
    { id: "about-heading-field", key: "heading", kind: "text", label: "Heading" },
    { id: "about-intro-field", key: "intro", kind: "long-text", label: "Introduction" },
    { id: "about-markdown-field", key: "markdown", kind: "markdown", label: "Body" },
  ],
});

const journalArticles = site.model({
  name: "Journal articles",
  kind: "collection",
  fields: [
    { id: "article-heading-field", key: "heading", kind: "text", label: "Heading" },
    { id: "article-intro-field", key: "intro", kind: "long-text", label: "Introduction" },
    { id: "article-date-field", key: "publishedOn", kind: "date", label: "Published on" },
    { id: "article-body-field", key: "body", kind: "markdown", label: "Body" },
    { id: "article-slug-field", key: "slug", kind: "slug", label: "Slug" },
  ],
});

site.entry(aboutContent, {
  id: "about-entry",
  values: {
    heading: "A studio built around useful clarity",
    intro: "Sample Studio helps small teams make steady progress when the shape of the work is still emerging.",
    markdown: readContent("about.md"),
  },
});

site.entry(journalArticles, {
  id: "article-first-question",
  values: {
    body: readContent("journal/start-with-the-question.md"),
    publishedOn: "2026-08-05",
    heading: "Start with the question",
    intro: "Before choosing a format or feature, name the question the work must answer.",
    slug: "start-with-the-question",
  },
});

site.entry(journalArticles, {
  id: "article-moving-parts",
  values: {
    body: readContent("journal/map-the-moving-parts.md"),
    publishedOn: "2026-08-12",
    heading: "Map the moving parts",
    intro: "A lightweight map can reveal where timing, ownership, and information need attention.",
    slug: "map-the-moving-parts",
  },
});

site.entry(journalArticles, {
  id: "article-small-loops",
  values: {
    body: readContent("journal/review-in-small-loops.md"),
    publishedOn: "2026-08-19",
    heading: "Review in small loops",
    intro: "Small reviews turn abstract agreement into specific, timely feedback.",
    slug: "review-in-small-loops",
  },
});

const aboutPageMapping = site.mapping({
  id: "about-page-mapping",
  name: "About page mapping",
  model: aboutContent,
  composition: aboutPage,
  bindings: [
    { id: "about-heading-binding", field: "heading", nodeId: "about-heading", prop: "heading" },
    { id: "about-intro-binding", field: "intro", nodeId: "about-heading", prop: "intro", transform: { kind: "truncate-160" } },
    { id: "about-body-binding", field: "markdown", nodeId: "about-body", prop: "markdown" },
  ],
});

const journalEntryMapping = site.mapping({
  id: "journal-entry-mapping",
  name: "Journal entry mapping",
  model: journalArticles,
  composition: journalEntryPage,
  mode: { kind: "collection", sort: [{ field: "publishedOn", direction: "desc" }] },
  bindings: [
    { id: "article-heading-binding", field: "heading", nodeId: "journal-entry-heading", prop: "heading" },
    { id: "article-intro-binding", field: "intro", nodeId: "journal-entry-heading", prop: "intro", transform: { kind: "truncate-160" } },
    { id: "article-date-binding", field: "publishedOn", nodeId: "journal-entry-date", prop: "children", transform: { kind: "date-medium" } },
    { id: "article-body-binding", field: "body", nodeId: "journal-entry-body", prop: "markdown" },
  ],
});

// Five authored sitemap rows expand to seven delivery routes.

const aboutNode: RouteInput = { id: "about-node", title: "About", slug: "about", mapping: aboutPageMapping, route: "single" };

const servicesNode: RouteInput = { id: "services-node", title: "Services", slug: "services", page: servicesPage };

const journalEntryNode: RouteInput = { id: "journal-entry-node", title: "Journal entry", mapping: journalEntryMapping, route: "entry-field", field: "slug", titleField: "heading" };

const journalNode: RouteInput = { id: "journal-node", title: "Journal", slug: "journal", page: journalIndexPage, children: [journalEntryNode] };

const homeNode: RouteInput = { id: "home-node", title: "Home", page: homePage, children: [aboutNode, servicesNode, journalNode] };

const navigation = [homeNode, aboutNode, servicesNode, journalNode].map((route) => ({ route }));
site.sitemap({
  name: "Sample Studio sitemap",
  root: homeNode,
  navigation: { primary: navigation, footer: navigation },
});

export default site;
