// This host's component pack. `pack` and every `source.module` are
// "demo-landing/components": the package's own name plus an exported subpath,
// which Node and Vite both resolve without anything installed. Ids, props and
// slots follow docs/demo-sites/landing.md § 5.
import { defineComponent, defineComponentPack } from "@zudo-composer/component-contract";
import { Button, DemoNote, Footer, Header, NavLink, type ButtonProps, type DemoNoteProps, type FooterProps, type HeaderProps, type NavLinkProps } from "./chrome";
import { FaqAccordion, FaqItem, type FaqAccordionProps, type FaqItemProps } from "./faq";
import { ContactForm, SignupForm, type ContactFormProps, type SignupFormProps } from "./forms";
import { Hero, LogoStrip, type HeroProps, type LogoStripProps } from "./hero";
import {
  Container, Grid, Image, Section, SectionHeading, Split, Stack,
  type ContainerProps, type GridProps, type ImageProps, type SectionHeadingProps, type SectionProps, type SplitProps, type StackProps,
} from "./layout";
import { BillingContext, PricingTable, PricingTier, type PricingTableProps, type PricingTierProps } from "./pricing";
import { ComparisonNote, Prose, type ComparisonNoteProps, type ProseProps } from "./prose";
import {
  CtaBand, FeatureGrid, FeatureItem, Stats, Step, StepsRow, Testimonial, Testimonials,
  type CtaBandProps, type FeatureGridProps, type FeatureItemProps, type StatsProps, type StepProps, type StepsRowProps, type TestimonialProps, type TestimonialsProps,
} from "./sections";

const MODULE = "demo-landing/components";
const source = <const TName extends string>(exportName: TName) => ({ module: MODULE, exportKind: "named", exportName } as const);

const text = <const TProp extends string>(prop: TProp, label: string) => ({ kind: "text", prop, label } as const);
const multiline = <const TProp extends string>(prop: TProp, label: string) =>
  ({ prop, label, schema: { type: "string" }, editor: { kind: "text", multiline: true } } as const);
const markdown = <const TProp extends string>(prop: TProp, label: string) =>
  ({ prop, label, schema: { type: "string" }, editor: { kind: "text", multiline: true, mode: "markdown-source" } } as const);
const inlineHeading = <const TProp extends string>(prop: TProp, label: string) =>
  ({ kind: "text", prop, label, inlineEdit: { multiline: false } } as const);
const select = <const TProp extends string, const TOptions extends readonly string[]>(prop: TProp, label: string, options: TOptions) =>
  ({ kind: "select", prop, label, options } as const);
const bool = <const TProp extends string>(prop: TProp, label: string) => ({ kind: "boolean", prop, label } as const);
const number = <const TProp extends string>(prop: TProp, label: string, min?: number, max?: number) =>
  ({ kind: "number", prop, label, ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }), step: 1 } as const);

const headingElement = (root: HTMLElement) => root.querySelector<HTMLElement>("h1, h2");

// Chrome

const header = defineComponent<HeaderProps>()(Header, {
  id: "land.header",
  schemaVersion: 1,
  title: "Header",
  category: "Chrome",
  description: "Brand wordmark, primary navigation and one secondary button.",
  source: source("Header"),
  defaults: { brand: "Orrery", brandHref: "/" },
  fields: [text("brand", "Brand"), text("brandHref", "Brand link")],
  slots: [
    { id: "nav", prop: "nav", label: "Navigation", accepts: ["land.nav-link"], cardinality: "many" },
    { id: "action", prop: "action", label: "Action", accepts: ["land.button"], cardinality: "single" },
  ],
});

const navLink = defineComponent<NavLinkProps>()(NavLink, {
  id: "land.nav-link",
  schemaVersion: 1,
  title: "Nav link",
  category: "Chrome",
  description: "Navigation link; marks itself current from the page path.",
  source: source("NavLink"),
  defaults: { label: "Features", href: "/features" },
  fields: [text("label", "Label"), text("href", "Link")],
});

const footer = defineComponent<FooterProps>()(Footer, {
  id: "land.footer",
  schemaVersion: 1,
  title: "Footer",
  category: "Chrome",
  description: "Footer navigation, small print and the tool credit.",
  source: source("Footer"),
  defaults: {
    smallPrint: "© 2026 Orrery. A fictional product for a demo site.",
    creditLabel: "Built with zudo-composer",
    creditHref: "https://zudo-composer.zudolab.dev",
  },
  fields: [text("smallPrint", "Small print"), text("creditLabel", "Credit label"), text("creditHref", "Credit link")],
  slots: [{ id: "nav", prop: "nav", label: "Navigation", accepts: ["land.nav-link"], cardinality: "many" }],
});

const button = defineComponent<ButtonProps>()(Button, {
  id: "land.button",
  schemaVersion: 1,
  title: "Button",
  category: "Chrome",
  description: "The only button. Primary is the accent: at most one per viewport.",
  source: source("Button"),
  defaults: { label: "Start free", href: "/#signup", variant: "secondary", size: "md" },
  fields: [text("label", "Label"), text("href", "Link"), select("variant", "Variant", ["primary", "secondary"]), select("size", "Size", ["md", "lg"])],
});

const demoNote = defineComponent<DemoNoteProps>()(DemoNote, {
  id: "land.demo-note",
  schemaVersion: 1,
  title: "Demo note",
  category: "Chrome",
  description: "States that the mock forms send nothing.",
  source: source("DemoNote"),
  defaults: { text: "Demo — no data is sent." },
  fields: [text("text", "Text")],
});

// Layout

const container = defineComponent<ContainerProps>()(Container, {
  id: "land.container",
  schemaVersion: 1,
  title: "Container",
  category: "Layout",
  description: "Centred page or narrow width with the page inset.",
  source: source("Container"),
  defaults: { width: "page" },
  fields: [select("width", "Width", ["page", "narrow"])],
  slots: [{ id: "content", prop: "content", label: "Content", cardinality: "many" }],
});

const stack = defineComponent<StackProps>()(Stack, {
  id: "land.stack",
  schemaVersion: 1,
  title: "Stack",
  category: "Layout",
  description: "Vertical stack on the vertical spacing ladder.",
  source: source("Stack"),
  defaults: { gap: "md", align: "start" },
  fields: [select("gap", "Gap", ["xs", "sm", "md", "lg"]), select("align", "Align", ["start", "center"])],
  slots: [{ id: "content", prop: "content", label: "Content", cardinality: "many" }],
});

const grid = defineComponent<GridProps>()(Grid, {
  id: "land.grid",
  schemaVersion: 1,
  title: "Grid",
  category: "Layout",
  description: "One column, then two from sm and three from lg.",
  source: source("Grid"),
  defaults: { columns: "3", gap: "md" },
  fields: [select("columns", "Columns", ["2", "3"]), select("gap", "Gap", ["md", "lg"])],
  slots: [{ id: "items", prop: "items", label: "Items", cardinality: "many" }],
});

const split = defineComponent<SplitProps>()(Split, {
  id: "land.split",
  schemaVersion: 1,
  title: "Split",
  category: "Layout",
  description: "Image and copy side by side from md, image first.",
  source: source("Split"),
  defaults: { ratio: "1/1", reverse: false },
  fields: [select("ratio", "Ratio", ["1/1", "2/3"]), bool("reverse", "Image on the right")],
  slots: [
    { id: "media", prop: "media", label: "Media", accepts: ["land.image"], cardinality: "single" },
    { id: "copy", prop: "copy", label: "Copy", cardinality: "many" },
  ],
});

const section = defineComponent<SectionProps>()(Section, {
  id: "land.section",
  schemaVersion: 1,
  title: "Section",
  category: "Layout",
  description: "One page section with an optional anchor and grey band.",
  source: source("Section"),
  defaults: { anchor: "", band: false },
  fields: [text("anchor", "Anchor id"), bool("band", "Grey band")],
  slots: [{ id: "content", prop: "content", label: "Content", cardinality: "many" }],
});

const sectionHeading = defineComponent<SectionHeadingProps>()(SectionHeading, {
  id: "land.section-heading",
  schemaVersion: 1,
  title: "Section heading",
  category: "Layout",
  description: "Eyebrow, heading and intro, centred or start-aligned.",
  source: source("SectionHeading"),
  defaults: { eyebrow: "", heading: "Three views, one calendar", intro: "", as: "h2", align: "center" },
  fields: [
    text("eyebrow", "Eyebrow"),
    inlineHeading("heading", "Heading"),
    multiline("intro", "Intro"),
    select("as", "Level", ["h1", "h2"]),
    select("align", "Align", ["start", "center"]),
  ],
  adapters: { inlineEditor: { field: "heading", resolveElement: headingElement } },
});

const image = defineComponent<ImageProps>()(Image, {
  id: "land.image",
  schemaVersion: 1,
  title: "Image",
  category: "Layout",
  description: "Bordered figure image at a fixed ratio.",
  source: source("Image"),
  defaults: { src: "", alt: "", aspect: "16/10" },
  fields: [text("src", "Image URL"), text("alt", "Alt text"), select("aspect", "Aspect", ["16/10", "4/3", "1/1"])],
});

const prose = defineComponent<ProseProps>()(Prose, {
  id: "land.prose",
  schemaVersion: 1,
  title: "Prose",
  category: "Content",
  description: "Headings, paragraphs, lists and links from markdown.",
  source: source("Prose"),
  defaults: { markdown: "## Heading\n\nA paragraph with a [link](/about)." },
  fields: [markdown("markdown", "Markdown")],
});

// Marketing sections

const hero = defineComponent<HeroProps>()(Hero, {
  id: "land.hero",
  schemaVersion: 1,
  title: "Hero",
  category: "Marketing",
  description: "Display heading, lead and two actions beside the product screenshot.",
  source: source("Hero"),
  defaults: {
    eyebrow: "Team scheduling",
    heading: "Every moving part of your week, in one view",
    emphasis: "one view",
    lead: "Orrery puts your team's meetings, focus time and deadlines on one calendar, so planning the week takes minutes.",
    primaryLabel: "Start free",
    primaryHref: "#signup",
    secondaryLabel: "See pricing",
    secondaryHref: "/pricing",
    src: "",
    alt: "Stylised calendar app window with a week grid and one highlighted block",
  },
  fields: [
    text("eyebrow", "Eyebrow"),
    inlineHeading("heading", "Heading"),
    text("emphasis", "Emphasised words"),
    multiline("lead", "Lead"),
    text("primaryLabel", "Primary label"),
    text("primaryHref", "Primary link"),
    text("secondaryLabel", "Secondary label"),
    text("secondaryHref", "Secondary link"),
    text("src", "Screenshot URL"),
    text("alt", "Screenshot alt text"),
  ],
  adapters: { inlineEditor: { field: "heading", resolveElement: headingElement } },
});

const logoStrip = defineComponent<LogoStripProps>()(LogoStrip, {
  id: "land.logo-strip",
  schemaVersion: 1,
  title: "Logo strip",
  category: "Marketing",
  description: "Grey band with a caption and three to six customer wordmarks.",
  source: source("LogoStrip"),
  defaults: { caption: "Teams planning with Orrery", count: 6 },
  fields: [text("caption", "Caption"), number("count", "Logos", 3, 6)],
});

const featureGrid = defineComponent<FeatureGridProps>()(FeatureGrid, {
  id: "land.feature-grid",
  schemaVersion: 1,
  title: "Feature grid",
  category: "Marketing",
  description: "Grid of feature items; at most one may carry the emphasis chip.",
  source: source("FeatureGrid"),
  defaults: { columns: "3" },
  fields: [select("columns", "Columns", ["2", "3"])],
  slots: [{ id: "items", prop: "items", label: "Features", accepts: ["land.feature-item"], cardinality: "many" }],
});

const featureItem = defineComponent<FeatureItemProps>()(FeatureItem, {
  id: "land.feature-item",
  schemaVersion: 1,
  title: "Feature item",
  category: "Marketing",
  description: "Icon chip, title and short copy.",
  source: source("FeatureItem"),
  defaults: { icon: "calendar", title: "Day, week and month", body: "Switch views without losing your place.", emphasis: false },
  fields: [
    select("icon", "Icon", ["calendar", "people", "clock", "bell", "layers", "lock"]),
    text("title", "Title"),
    multiline("body", "Body"),
    bool("emphasis", "Emphasis chip (one per grid)"),
  ],
});

const stepsRow = defineComponent<StepsRowProps>()(StepsRow, {
  id: "land.steps-row",
  schemaVersion: 1,
  title: "Steps row",
  category: "Marketing",
  description: "Numbered row of steps.",
  source: source("StepsRow"),
  slots: [{ id: "steps", prop: "steps", label: "Steps", accepts: ["land.step"], cardinality: "many" }],
});

const step = defineComponent<StepProps>()(Step, {
  id: "land.step",
  schemaVersion: 1,
  title: "Step",
  category: "Marketing",
  description: "Step number, title and copy.",
  source: source("Step"),
  defaults: { number: 1, title: "Connect your calendars", body: "Bring in the calendars your team already uses." },
  fields: [number("number", "Number", 1, 9), text("title", "Title"), multiline("body", "Body")],
});

const pricingTable = defineComponent<PricingTableProps>()(PricingTable, {
  id: "land.pricing-table",
  schemaVersion: 1,
  title: "Pricing table",
  category: "Marketing",
  description: "Monthly/yearly toggle over the pricing tiers in its slot.",
  source: source("PricingTable"),
  defaults: { defaultBilling: "monthly", currency: "USD", yearlyNote: "Save 20% when billed yearly" },
  fields: [select("defaultBilling", "Default billing", ["monthly", "yearly"]), text("currency", "Currency"), text("yearlyNote", "Yearly note")],
  slots: [{ id: "tiers", prop: "tiers", label: "Tiers", accepts: ["land.pricing-tier"], cardinality: "many" }],
});

const pricingTier = defineComponent<PricingTierProps>()(PricingTier, {
  id: "land.pricing-tier",
  schemaVersion: 1,
  title: "Pricing tier",
  category: "Marketing",
  description: "One tier; shows the price for the table's billing choice.",
  source: source("PricingTier"),
  defaults: {
    name: "Studio",
    tagline: "For teams that plan together.",
    priceMonthly: 12,
    priceYearly: 10,
    currency: "USD",
    ctaLabel: "Start trial",
    ctaHref: "/#signup",
    popular: false,
    feature1: "Shared team calendar",
    feature2: "Focus time blocks",
    feature3: "",
    feature4: "",
    feature5: "",
    feature6: "",
    order: 1,
  },
  fields: [
    text("name", "Name"),
    text("tagline", "Tagline"),
    number("priceMonthly", "Price per month", 0),
    number("priceYearly", "Price per month, billed yearly", 0),
    text("currency", "Currency"),
    text("ctaLabel", "Button label"),
    text("ctaHref", "Button link"),
    bool("popular", "Popular"),
    text("feature1", "Feature 1"),
    text("feature2", "Feature 2"),
    text("feature3", "Feature 3"),
    text("feature4", "Feature 4"),
    text("feature5", "Feature 5"),
    text("feature6", "Feature 6"),
    number("order", "Order", 0),
  ],
});

const testimonials = defineComponent<TestimonialsProps>()(Testimonials, {
  id: "land.testimonials",
  schemaVersion: 1,
  title: "Testimonials",
  category: "Marketing",
  description: "Three-up grid of testimonials.",
  source: source("Testimonials"),
  slots: [{ id: "testimonials", prop: "testimonials", label: "Testimonials", accepts: ["land.testimonial"], cardinality: "many" }],
});

const testimonial = defineComponent<TestimonialProps>()(Testimonial, {
  id: "land.testimonial",
  schemaVersion: 1,
  title: "Testimonial",
  category: "Marketing",
  description: "Quote with the speaker's name, role and avatar.",
  source: source("Testimonial"),
  defaults: {
    quote: "We stopped arguing about when to meet. The week is just there, on one screen.",
    name: "Mara Lind",
    role: "Operations lead, Quarto",
    src: "",
    alt: "Abstract geometric avatar in grey with a cobalt collar",
    order: 1,
  },
  fields: [multiline("quote", "Quote"), text("name", "Name"), text("role", "Role"), text("src", "Avatar URL"), text("alt", "Avatar alt text"), number("order", "Order", 0)],
});

const stats = defineComponent<StatsProps>()(Stats, {
  id: "land.stats",
  schemaVersion: 1,
  title: "Stats",
  category: "Marketing",
  description: "Three large figures with labels.",
  source: source("Stats"),
  defaults: {
    stat1Value: "4 hrs",
    stat1Label: "saved per person each week",
    stat2Value: "12k",
    stat2Label: "teams planning weekly",
    stat3Value: "98%",
    stat3Label: "of meetings start on time",
  },
  fields: [
    text("stat1Value", "Stat 1 value"), text("stat1Label", "Stat 1 label"),
    text("stat2Value", "Stat 2 value"), text("stat2Label", "Stat 2 label"),
    text("stat3Value", "Stat 3 value"), text("stat3Label", "Stat 3 label"),
  ],
});

const faqAccordion = defineComponent<FaqAccordionProps>()(FaqAccordion, {
  id: "land.faq-accordion",
  schemaVersion: 1,
  title: "FAQ accordion",
  category: "Marketing",
  description: "Question rows; one open at a time unless multiple are allowed.",
  source: source("FaqAccordion"),
  defaults: { allowMultiple: false },
  fields: [bool("allowMultiple", "Allow several open")],
  slots: [{ id: "items", prop: "items", label: "Questions", accepts: ["land.faq-item"], cardinality: "many" }],
});

const faqItem = defineComponent<FaqItemProps>()(FaqItem, {
  id: "land.faq-item",
  schemaVersion: 1,
  title: "FAQ item",
  category: "Marketing",
  description: "Question with a markdown answer.",
  source: source("FaqItem"),
  defaults: {
    question: "Can I try Orrery before paying?",
    answer: "Yes. The Solo plan is free, and Studio has a 14-day trial.",
    topic: "general",
    order: 1,
  },
  fields: [text("question", "Question"), markdown("answer", "Answer"), select("topic", "Topic", ["general", "billing", "security"]), number("order", "Order", 0)],
});

const ctaBand = defineComponent<CtaBandProps>()(CtaBand, {
  id: "land.cta-band",
  schemaVersion: 1,
  title: "CTA band",
  category: "Marketing",
  description: "Grey band with a heading and the one primary button.",
  source: source("CtaBand"),
  defaults: {
    heading: "Plan next week in ten minutes",
    lead: "Free for one person. No card needed.",
    buttonLabel: "Start free",
    buttonHref: "#signup",
  },
  fields: [text("heading", "Heading"), text("lead", "Lead"), text("buttonLabel", "Button label"), text("buttonHref", "Button link")],
});

const comparisonNote = defineComponent<ComparisonNoteProps>()(ComparisonNote, {
  id: "land.comparison-note",
  schemaVersion: 1,
  title: "Comparison note",
  category: "Marketing",
  description: "Short bordered note under the pricing table.",
  source: source("ComparisonNote"),
  defaults: { markdown: "All plans include calendar sync, **unlimited events** and export at any time." },
  fields: [markdown("markdown", "Markdown")],
});

const signupForm = defineComponent<SignupFormProps>()(SignupForm, {
  id: "land.signup-form",
  schemaVersion: 1,
  title: "Signup form",
  category: "Forms",
  description: "Mock signup: work email and team size, then a success panel. Sends nothing.",
  source: source("SignupForm"),
  defaults: {
    heading: "Start free",
    lead: "Tell us where to send your invite.",
    buttonLabel: "Create my calendar",
    successHeading: "Check your inbox",
    successText: "Check your inbox — in this demo, nothing was sent.",
  },
  fields: [text("heading", "Heading"), text("lead", "Lead"), text("buttonLabel", "Button label"), text("successHeading", "Success heading"), multiline("successText", "Success text")],
});

const contactForm = defineComponent<ContactFormProps>()(ContactForm, {
  id: "land.contact-form",
  schemaVersion: 1,
  title: "Contact form",
  category: "Forms",
  description: "Mock contact form: name, email and message. Sends nothing.",
  source: source("ContactForm"),
  defaults: { heading: "Write to us", successText: "Thanks — in this demo, your message was not sent anywhere." },
  fields: [text("heading", "Heading"), text("successText", "Success text")],
});

export const componentPack = defineComponentPack({
  packId: "demo-landing",
  packVersion: "1.0.0",
  components: [
    header, navLink, footer, button, demoNote,
    container, stack, grid, split, section, sectionHeading, image, prose,
    hero, logoStrip, featureGrid, featureItem, stepsRow, step, pricingTable, pricingTier,
    testimonials, testimonial, stats, faqAccordion, faqItem, ctaBand, comparisonNote,
    signupForm, contactForm,
  ],
});

export {
  BillingContext, Button, ComparisonNote, ContactForm, Container, CtaBand, DemoNote, FaqAccordion, FaqItem, FeatureGrid, FeatureItem,
  Footer, Grid, Header, Hero, Image, LogoStrip, NavLink, PricingTable, PricingTier, Prose, Section, SectionHeading, SignupForm, Split,
  Stack, Stats, Step, StepsRow, Testimonial, Testimonials,
};
export type {
  ButtonProps, ComparisonNoteProps, ContactFormProps, ContainerProps, CtaBandProps, DemoNoteProps, FaqAccordionProps, FaqItemProps,
  FeatureGridProps, FeatureItemProps, FooterProps, GridProps, HeaderProps, HeroProps, ImageProps, LogoStripProps, NavLinkProps,
  PricingTableProps, PricingTierProps, ProseProps, SectionHeadingProps, SectionProps, SignupFormProps, SplitProps, StackProps,
  StatsProps, StepProps, StepsRowProps, TestimonialProps, TestimonialsProps,
};
