// The authored Orrery site (docs/demo-sites/landing.md). `pnpm generate` turns
// this into `site-project.json`; the tests fail when the two disagree.
import { defineSite, node, type JsonObject, type Page } from "demo-tools";
import { componentPack } from "./components/pack";

const site = defineSite({ id: "demo-landing", name: "Orrery", componentPack });

// Asset record ids in this package's committed cms/assets store (`pnpm seed`).
const asset = (id: string) => `/uploaded-assets/asset-${id}`;
const IMAGES = {
  heroApp: asset("assets-465686d0-7f71-43d2-ae46-d8e56a175a30"),
  workflow: asset("assets-c0782606-10cc-42f1-a223-ff461548f313"),
  team: asset("assets-55d857f5-fce8-4c86-827e-1de0a811a209"),
  mara: asset("assets-dc0233ae-9bc8-4a34-b641-e29785e46143"),
  jonah: asset("assets-97c31942-4c4e-4da3-a8d0-c7b0777b29fb"),
  priya: asset("assets-ecb0692c-6286-4cd7-814b-f78f201357c4"),
};

const navLink = (label: string, href: string) => node("land.nav-link", { label, href });
const heading = (props: JsonObject, id?: string) => node("land.section-heading", { eyebrow: "", intro: "", as: "h2", align: "center", ...props }, {}, id);

// Global frame

const frame = site.template({
  name: "Site frame",
  root: [
    node("land.header", { brand: "Orrery", brandHref: "/" }, {
      nav: [navLink("Features", "/features"), navLink("Pricing", "/pricing"), navLink("About", "/about")],
      action: [node("land.button", { label: "Start free", href: "/#signup", variant: "secondary", size: "md" })],
    }),
    node("land.container", { width: "page" }, {}, "frame-main"),
    node("land.footer", {
      smallPrint: "© 2026 Orrery. A fictional product for a demo site.",
      creditLabel: "Built with zudo-composer",
      creditHref: "https://zudo-composer.zudolab.dev",
    }, {
      nav: [
        navLink("Features", "/features"), navLink("Pricing", "/pricing"), navLink("About", "/about"),
        navLink("Privacy", "/privacy"), navLink("Terms", "/terms"),
      ],
    }),
  ],
  outlet: { target: { parentId: "frame-main", slotId: "content" } },
});

// Content models

const TIER_FEATURE_SLOTS = 6;
const tiers = site.model({
  name: "Tiers",
  kind: "collection",
  description: "Pricing tiers. `features` is the real list; feature1…6 are its flattened copy for the tier component.",
  fields: [
    { key: "name", kind: "text" },
    { key: "slug", kind: "slug" },
    { key: "tagline", kind: "text" },
    { key: "priceMonthly", kind: "number", label: "Price per month" },
    { key: "priceYearly", kind: "number", label: "Price per month, billed yearly" },
    { key: "currency", kind: "text" },
    { key: "features", kind: "list", item: { kind: "text" } },
    ...Array.from({ length: TIER_FEATURE_SLOTS }, (_, index) => ({ key: `feature${index + 1}`, kind: "text" as const, required: false })),
    { key: "ctaLabel", kind: "text", label: "Button label" },
    { key: "ctaHref", kind: "text", label: "Button link" },
    { key: "popular", kind: "boolean" },
    { key: "order", kind: "number" },
  ],
});

// README § Lists: a list reaches a component only as fixed scalar fields.
function tierFeatures(features: string[]): JsonObject {
  if (features.length > TIER_FEATURE_SLOTS) throw new Error(`A tier lists at most ${TIER_FEATURE_SLOTS} features.`);
  const flat: JsonObject = { features };
  for (let index = 0; index < TIER_FEATURE_SLOTS; index++) flat[`feature${index + 1}`] = features[index] ?? "";
  return flat;
}

site.entry(tiers, {
  id: "tier-solo",
  values: {
    name: "Solo", slug: "solo", tagline: "For one person planning their own week.",
    priceMonthly: 0, priceYearly: 0, currency: "USD",
    ...tierFeatures([
      "Day, week and month views",
      "Sync two calendars",
      "Focus blocks you set once",
      "Weekly plan email on Sunday",
    ]),
    ctaLabel: "Start free", ctaHref: "/#signup", popular: false, order: 1,
  },
});
site.entry(tiers, {
  id: "tier-studio",
  values: {
    name: "Studio", slug: "studio", tagline: "For teams up to 25 who plan the week together.",
    priceMonthly: 12, priceYearly: 10, currency: "USD",
    ...tierFeatures([
      "Everything in Solo",
      "Shared team calendar",
      "Unlimited calendar sync",
      "Meeting slots that respect focus time",
      "Workload view per person",
      "14-day free trial",
    ]),
    ctaLabel: "Start trial", ctaHref: "/#signup", popular: true, order: 2,
  },
});
site.entry(tiers, {
  id: "tier-org",
  values: {
    name: "Org", slug: "org", tagline: "For companies running many teams on one calendar.",
    priceMonthly: 29, priceYearly: 24, currency: "USD",
    ...tierFeatures([
      "Everything in Studio",
      "Cross-team availability",
      "Single sign-on and SCIM",
      "Audit log with one-year history",
      "A named onboarding contact",
    ]),
    ctaLabel: "Talk to us", ctaHref: "/about", popular: false, order: 3,
  },
});

const testimonials = site.model({
  name: "Testimonials",
  kind: "collection",
  fields: [
    { key: "quote", kind: "long-text" },
    { key: "name", kind: "text" },
    { key: "role", kind: "text" },
    { key: "avatar", kind: "object", fields: [{ key: "src", kind: "url", label: "Image URL" }, { key: "alt", kind: "text", label: "Alt text" }] },
    { key: "order", kind: "number" },
  ],
});
const avatarSrc = testimonials.fieldId("avatar") + "-src";
const avatarAlt = testimonials.fieldId("avatar") + "-alt";
const avatar = (src: string, alt: string) => ({ src, alt });

site.entry(testimonials, {
  id: "testimonial-mara",
  values: {
    quote: "We used to spend Monday morning arguing about when to meet. Now the week is already on one screen when we sit down, and the argument never starts.",
    name: "Mara Lind", role: "Operations lead, Quarto",
    avatar: avatar(IMAGES.mara, "Abstract geometric avatar in grey with a cobalt collar"), order: 1,
  },
});
site.entry(testimonials, {
  id: "testimonial-jonah",
  values: {
    quote: "Focus blocks are the feature I didn't know I needed. Orrery keeps my mornings clear, and meetings land in the afternoon without anyone asking.",
    name: "Jonah Reyes", role: "Staff engineer, Tessera",
    avatar: avatar(IMAGES.jonah, "Abstract geometric avatar on a cobalt disc"), order: 2,
  },
});
site.entry(testimonials, {
  id: "testimonial-priya",
  values: {
    quote: "Forty people across three time zones, and the workload view shows me who is overbooked before they tell me. Planning takes ten minutes instead of an hour.",
    name: "Priya Natarajan", role: "Head of delivery, Brightwater",
    avatar: avatar(IMAGES.priya, "Abstract geometric avatar with cobalt glasses"), order: 3,
  },
});

const faq = site.model({
  name: "FAQ",
  kind: "collection",
  fields: [
    { key: "question", kind: "text" },
    { key: "answer", kind: "markdown" },
    { key: "topic", kind: "choice", options: [{ value: "general", label: "General" }, { value: "billing", label: "Billing" }, { value: "security", label: "Security" }] },
    // The mapping resolver admits only text/slug onto a select prop, not choice (tool gap), so the item's topic is bound from this mirror.
    { key: "topicKey", kind: "text", label: "Topic key (mirrors topic)" },
    { key: "order", kind: "number" },
  ],
});

const FAQ: [id: string, topic: string, question: string, answer: string][] = [
  ["faq-calendars", "general", "Which calendars does Orrery work with?", "Google Calendar, Microsoft 365 and any calendar that publishes an **iCal feed**. Events sync both ways within a minute."],
  ["faq-replace", "general", "Do we have to move off our current calendar?", "No. Orrery sits on top of the calendars you already use. Remove it and every event is still where it was."],
  ["faq-focus", "general", "How do focus blocks work?", "Pick the hours you want protected. Orrery marks them busy for everyone else and suggests meeting slots around them."],
  ["faq-trial", "billing", "Is there a free trial?", "Solo is free for as long as you like. Studio comes with a **14-day trial**, and no card is needed to start it."],
  ["faq-yearly", "billing", "How does yearly billing work?", "Pay for twelve months up front and each month costs about 20% less: $10 instead of $12 on Studio, $24 instead of $29 on Org."],
  ["faq-seats", "billing", "What happens when someone joins or leaves?", "Seats are counted on the first of each month. Add people whenever you like; we charge the difference on the next invoice."],
  ["faq-cancel", "billing", "Can I cancel at any time?", "Yes. Cancel from the billing page and your plan runs to the end of the period you paid for. Export your data first if you want a copy."],
  ["faq-data", "security", "Where is our data stored?", "In the EU or the US — you choose when you create the workspace. Event details are encrypted at rest, and Org adds SSO and an audit log."],
];
FAQ.forEach(([id, topic, question, answer], index) => site.entry(faq, { id, values: { question, answer, topic, topicKey: topic, order: index + 1 } }));

const about = site.model({
  name: "About",
  kind: "single",
  fields: [
    { key: "heading", kind: "text" },
    { key: "intro", kind: "long-text" },
    { key: "body", kind: "markdown" },
  ],
});
site.entry(about, {
  id: "about-orrery",
  values: {
    heading: "We make the week legible",
    intro: "Orrery is a small team building one calendar for the people who have to make everyone else's calendar work.",
    body: [
      "## Why we started",
      "",
      "We ran operations for teams that shipped on time and still lost Monday mornings to scheduling. The information was all there, split across five calendars and a spreadsheet nobody trusted.",
      "",
      "An orrery is a model of the solar system: every part moving on its own orbit, and all of them visible at once. That is what we wanted for a team's week.",
      "",
      "## How we work",
      "",
      "- We are eleven people in Lisbon, Toronto and remote.",
      "- We plan our own week in Orrery, every Monday, in about ten minutes.",
      "- We ship small changes every week and write about them in the changelog.",
    ].join("\n"),
  },
});

// Item compositions (detached) and their mappings

const tierItem = site.page({ name: "Pricing tier", root: [node("land.pricing-tier", {}, {}, "tier")] });
const tierMapping = site.mapping({
  name: "Pricing tier",
  model: tiers,
  composition: tierItem,
  mode: { kind: "collection", sort: [{ field: "order", direction: "asc" }] },
  bindings: [
    ...["name", "tagline", "currency", "ctaLabel", "ctaHref", "priceMonthly", "priceYearly", "popular", "order"].map((field) => ({ field, nodeId: "tier", prop: field })),
    ...Array.from({ length: TIER_FEATURE_SLOTS }, (_, index) => ({ field: `feature${index + 1}`, nodeId: "tier", prop: `feature${index + 1}` })),
  ],
});

const testimonialItem = site.page({ name: "Testimonial", root: [node("land.testimonial", {}, {}, "testimonial")] });
const testimonialMapping = site.mapping({
  name: "Testimonial",
  model: testimonials,
  composition: testimonialItem,
  mode: { kind: "collection", sort: [{ field: "order", direction: "asc" }] },
  bindings: [
    { field: "quote", nodeId: "testimonial", prop: "quote" },
    { field: "name", nodeId: "testimonial", prop: "name" },
    { field: "role", nodeId: "testimonial", prop: "role" },
    { field: "avatar", nodeId: "testimonial", prop: "src", projection: { kind: "object-field", fieldIds: [avatarSrc] } },
    { field: "avatar", nodeId: "testimonial", prop: "alt", projection: { kind: "object-field", fieldIds: [avatarAlt] } },
    { field: "order", nodeId: "testimonial", prop: "order" },
  ],
});

const faqItem = site.page({ name: "FAQ item", root: [node("land.faq-item", {}, {}, "faq-item")] });
const faqBindings = [
  ...["question", "answer", "order"].map((field) => ({ field, nodeId: "faq-item", prop: field })),
  { field: "topicKey", nodeId: "faq-item", prop: "topic" },
];
const faqMapping = site.mapping({
  name: "FAQ item",
  model: faq,
  composition: faqItem,
  mode: { kind: "collection", sort: [{ field: "order", direction: "asc" }] },
  bindings: faqBindings,
});
const billingFaqMapping = site.mapping({
  name: "Billing FAQ item",
  model: faq,
  composition: faqItem,
  mode: { kind: "collection", sort: [{ field: "order", direction: "asc" }], conditions: [{ field: "topic", operator: "equals", value: "billing" }] },
  bindings: faqBindings,
});

// Pages

const pricingTable = (id: string) => node("land.pricing-table", { defaultBilling: "monthly", currency: "USD", yearlyNote: "Save 20% when billed yearly" }, {}, id);
const signupCta = node("land.cta-band", {
  heading: "Plan next week in ten minutes",
  lead: "Free for one person, forever. No card needed.",
  buttonLabel: "Start free",
  buttonHref: "/#signup",
});

// The CTA band sits above the FAQ rather than beside the signup form, so its
// primary button and the form's never share a viewport (landing.md § 2.2).
const home = site.page({
  name: "Home",
  template: frame,
  root: [
    node("land.hero", {
      eyebrow: "Team scheduling",
      heading: "Every moving part of your week, in one view",
      emphasis: "one view",
      lead: "Orrery puts your team's meetings, focus time and deadlines on one calendar, so planning the week takes minutes instead of a meeting about meetings.",
      primaryLabel: "Start free",
      primaryHref: "#signup",
      secondaryLabel: "See pricing",
      secondaryHref: "/pricing",
      src: IMAGES.heroApp,
      alt: "Stylised calendar app window with a week grid and one highlighted block",
    }, {}, "home-hero"),
    node("land.logo-strip", { caption: "Teams planning with Orrery", count: 6 }),
    node("land.section", { anchor: "features", band: false }, {
      content: [
        heading({ eyebrow: "Views", heading: "Three views, one calendar", intro: "Zoom from today's agenda to the quarter without switching tools or losing your place." }),
        node("land.feature-grid", { columns: "3" }, {
          items: [
            node("land.feature-item", { icon: "calendar", title: "Day, week and month", body: "One timeline that zooms. Drag a block from the week view into next month and everyone sees it move.", emphasis: true }),
            node("land.feature-item", { icon: "people", title: "Everyone at a glance", body: "Stack your team's calendars side by side and spot the one hour on Thursday when all six of you are free.", emphasis: false }),
            node("land.feature-item", { icon: "clock", title: "Focus time that holds", body: "Protected blocks turn busy for everyone else, so deep work stops losing to the next invite.", emphasis: false }),
          ],
        }),
      ],
    }),
    node("land.section", { anchor: "how", band: false }, {
      content: [
        heading({ eyebrow: "Setup", heading: "How it works", intro: "Most teams are planning their first week within fifteen minutes." }),
        node("land.steps-row", {}, {
          steps: [
            node("land.step", { number: 1, title: "Connect your calendars", body: "Sign in with Google or Microsoft. Orrery reads your existing events; nothing is copied or moved." }),
            node("land.step", { number: 2, title: "Mark what matters", body: "Set focus hours, working days and the meetings that repeat. Orrery learns the shape of your week." }),
            node("land.step", { number: 3, title: "Plan on Monday, done by 9:15", body: "Open the week view together, move a few blocks, and every calendar underneath updates at once." }),
          ],
        }),
      ],
    }),
    node("land.section", { anchor: "", band: false }, {
      content: [node("land.image", { src: IMAGES.workflow, alt: "Three overlapping cards for day, week and month views connected by arrows", aspect: "16/10" })],
    }),
    node("land.section", { anchor: "pricing", band: false }, {
      content: [
        heading({ eyebrow: "Pricing", heading: "Simple pricing", intro: "Start free on your own. Bring your team when the week gets crowded." }),
        pricingTable("home-pricing"),
      ],
    }),
    node("land.section", { anchor: "", band: false }, {
      content: [node("land.stats", {
        stat1Value: "4 hrs", stat1Label: "saved per person each week",
        stat2Value: "12,000", stat2Label: "teams planning every Monday",
        stat3Value: "98%", stat3Label: "of meetings start on time",
      })],
    }),
    node("land.section", { anchor: "", band: false }, {
      content: [
        heading({ eyebrow: "Customers", heading: "What teams say" }),
        node("land.testimonials", {}, {}, "home-testimonials"),
      ],
    }),
    signupCta,
    node("land.section", { anchor: "faq", band: false }, {
      content: [
        heading({ eyebrow: "FAQ", heading: "Questions" }),
        node("land.faq-accordion", { allowMultiple: false }, {}, "home-faq"),
      ],
    }),
    node("land.section", { anchor: "signup", band: false }, {
      content: [node("land.signup-form", {
        heading: "Start free",
        lead: "Tell us where to send your invite. Solo is free; you can add your team later.",
        buttonLabel: "Create my calendar",
        successHeading: "Check your inbox",
        successText: "Check your inbox — in this demo, nothing was sent.",
      })],
    }),
  ],
});

const pricing = site.page({
  name: "Pricing",
  template: frame,
  root: [
    node("land.section", { anchor: "", band: false }, {
      content: [
        heading({ eyebrow: "Plans", heading: "Pricing", as: "h1", intro: "Every plan includes the full calendar. You pay for sharing it." }),
        pricingTable("pricing-table"),
      ],
    }),
    node("land.section", { anchor: "", band: false }, {
      content: [node("land.comparison-note", {
        markdown: "All plans include **unlimited events**, two-way sync and export to iCal at any time. Prices are per person per month in US dollars, before tax. Need more than 250 seats? [Talk to us](/about).",
      })],
    }),
    node("land.section", { anchor: "", band: false }, {
      content: [
        heading({ eyebrow: "Billing", heading: "Billing questions" }),
        node("land.faq-accordion", { allowMultiple: false }, {}, "pricing-faq"),
      ],
    }),
    signupCta,
  ],
});

const features = site.page({
  name: "Features",
  template: frame,
  root: [
    node("land.section", { anchor: "", band: false }, {
      content: [
        heading({ eyebrow: "Product", heading: "Features", as: "h1", intro: "Six things Orrery does so that nobody on your team has to do them by hand." }),
        node("land.feature-grid", { columns: "3" }, {
          items: [
            node("land.feature-item", { icon: "calendar", title: "One zoomable timeline", body: "Day, week and month are the same surface. Zoom out to see the quarter; zoom in to move a single meeting.", emphasis: true }),
            node("land.feature-item", { icon: "people", title: "Team overlay", body: "Layer any set of calendars and see shared free time highlighted, across time zones.", emphasis: false }),
            node("land.feature-item", { icon: "clock", title: "Protected focus", body: "Focus blocks show as busy to others and move out of the way when a real deadline needs the hour.", emphasis: false }),
            node("land.feature-item", { icon: "bell", title: "Quiet reminders", body: "One summary before the day starts instead of a notification for every event.", emphasis: false }),
            node("land.feature-item", { icon: "layers", title: "Workload view", body: "Hours booked per person, per week. Spot the overloaded before the Friday crunch.", emphasis: false }),
            node("land.feature-item", { icon: "lock", title: "Private by default", body: "Colleagues see busy, not details, unless you share them. Org adds SSO and an audit log.", emphasis: false }),
          ],
        }),
      ],
    }),
    node("land.section", { anchor: "", band: false }, {
      content: [node("land.split", { ratio: "1/1", reverse: false }, {
        media: [node("land.image", { src: IMAGES.workflow, alt: "Three overlapping cards for day, week and month views connected by arrows", aspect: "16/10" })],
        copy: [
          heading({ eyebrow: "Views", heading: "Move a block once, everywhere", align: "start" }),
          node("land.prose", {
            markdown: "Every view reads from the same week. Drag a planning session from Tuesday to Thursday in the week view and it moves in the month view, on your colleague's overlay and in the calendar app on their phone.\n\nNo copies, no duplicate invites, no \"which version is right?\"",
          }),
        ],
      })],
    }),
    signupCta,
  ],
});

const aboutPage = site.page({
  name: "About page",
  template: frame,
  root: [
    node("land.section", { anchor: "", band: false }, {
      content: [
        heading({ eyebrow: "About", heading: "About Orrery", as: "h1", align: "start" }, "about-heading"),
        node("land.split", { ratio: "1/1", reverse: false }, {
          media: [node("land.image", { src: IMAGES.team, alt: "Four abstract figures around a table beneath a large wall calendar", aspect: "4/3" })],
          copy: [node("land.prose", { markdown: "" }, {}, "about-body")],
        }),
      ],
    }),
    node("land.section", { anchor: "contact", band: false }, {
      content: [
        heading({ eyebrow: "Contact", heading: "Contact", intro: "Questions about Org, a partnership or a bug? We answer within one working day." }),
        node("land.contact-form", { heading: "Write to us", successText: "Thanks — in this demo, your message was not sent anywhere." }),
        node("land.demo-note", { text: "Demo — no data is sent." }),
      ],
    }),
  ],
});
const aboutMapping = site.mapping({
  name: "About page",
  model: about,
  composition: aboutPage,
  bindings: [
    { field: "heading", nodeId: "about-heading", prop: "heading" },
    { field: "intro", nodeId: "about-heading", prop: "intro" },
    { field: "body", nodeId: "about-body", prop: "markdown" },
  ],
});

const legalPage = (name: string, title: string, markdown: string): Page => site.page({
  name,
  template: frame,
  root: [
    node("land.section", { anchor: "", band: false }, {
      content: [node("land.container", { width: "narrow" }, {
        content: [
          heading({ eyebrow: "Legal", heading: title, as: "h1", align: "start", intro: "Last updated 1 September 2026." }),
          node("land.prose", { markdown }),
        ],
      })],
    }),
  ],
});

const privacy = legalPage("Privacy", "Privacy", [
  "Orrery is a fictional product, and this is a demo site. Nothing you type on it leaves your browser: the signup and contact forms only pretend to send.",
  "",
  "## What a real Orrery would collect",
  "",
  "- Your name and work email, to create your account.",
  "- Calendar events you connect, to show them in your week. We read titles and times; attachments stay where they are.",
  "- Billing details, handled by our payment processor. We never see full card numbers.",
  "",
  "## What we would never do",
  "",
  "- Sell your data or show you advertising.",
  "- Read the content of events you mark private.",
  "- Keep your data after you delete your workspace. Deletion finishes within 30 days.",
  "",
  "## Contact",
  "",
  "Questions about privacy go to the [contact form](/about), which, on this demo, sends nothing.",
].join("\n"));

const terms = legalPage("Terms", "Terms", [
  "These terms describe a fictional service on a demo site. They are sample copy, not an offer or a contract.",
  "",
  "## Your account",
  "",
  "You are responsible for the calendars you connect and for the people you invite. Keep your password to yourself; Org workspaces can require single sign-on instead.",
  "",
  "## Plans and billing",
  "",
  "- Solo is free. Studio and Org are billed per person, monthly or yearly.",
  "- Yearly plans are paid up front and cost about 20% less per month.",
  "- You can cancel at any time. Your plan runs to the end of the paid period.",
  "",
  "## Your data",
  "",
  "Your events stay yours. You can export everything at any time, and we delete it when you close the workspace.",
  "",
  "## Changes",
  "",
  "If these terms change, we tell workspace owners by email 30 days before the change applies.",
].join("\n"));

// Lists land in their hosts

site.attach(tierMapping, { nodeId: "home-pricing", slotId: "tiers" }, "home-tiers");
site.attach(tierMapping, { nodeId: "pricing-table", slotId: "tiers" }, "pricing-tiers");
site.attach(testimonialMapping, { nodeId: "home-testimonials", slotId: "testimonials" }, "home-testimonials");
site.attach(faqMapping, { nodeId: "home-faq", slotId: "items" }, "home-faq");
site.attach(billingFaqMapping, { nodeId: "pricing-faq", slotId: "items" }, "pricing-faq");

// Sitemap

const featuresRoute = { title: "Features", slug: "features", page: features };
const pricingRoute = { title: "Pricing", slug: "pricing", page: pricing };
const aboutRoute = { title: "About", slug: "about", mapping: aboutMapping, route: "single" as const };
const privacyRoute = { title: "Privacy", slug: "privacy", page: privacy };
const termsRoute = { title: "Terms", slug: "terms", page: terms };
const homeRoute = { title: "Home", page: home, children: [featuresRoute, pricingRoute, aboutRoute, privacyRoute, termsRoute] };

site.sitemap({
  name: "Demo Landing sitemap",
  root: homeRoute,
  navigation: {
    primary: [featuresRoute, pricingRoute, aboutRoute].map((route) => ({ route })),
    footer: [featuresRoute, pricingRoute, aboutRoute, privacyRoute, termsRoute].map((route) => ({ route })),
  },
});

export default site;
