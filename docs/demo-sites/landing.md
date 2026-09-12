# Landing demo — Orrery

Package `packages/demo-landing`, domain `demo-landing.zudolab.dev`, token
namespace `land-`, component id prefix `land.`. Lists follow
[README § Lists](./README.md#lists); spacing axes follow
`src/styles/README.md`; the `@theme` mechanism is the one in
`src/styles/app-tokens.css` under a different namespace.

## 1. Brand

**Orrery** is a fictional team-scheduling app: "see every moving part of your
week". The landing site is **bright and spacious**: a near-white ground,
generous vertical whitespace between sections, very large display type, and
one bold cobalt accent reserved for the primary call to action and one
emphasised element per section. Cards are bordered, not shadowed; the only
shadow in the site sits under the hero product screenshot. Rounded corners
are allowed here (unlike the webshop) but at one radius for boxes and pill for
buttons — no mixing.

## 2. Non-negotiables

1. Accent (`land-accent`, cobalt) ≤ 2 elements per viewport: the primary CTA
   plus at most one emphasised element (a highlighted word, the "Popular" tier
   frame, or one icon chip). Never on body links, never on headings as a
   whole, never as a section background.
2. Primary CTA = `bg-land-accent text-land-accent-fg rounded-land-pill`;
   hover = `bg-land-accent-strong` (one rung darker), no scale, no shadow.
   Secondary CTA = `border-land-border text-land-fg-strong rounded-land-pill`;
   hover = `bg-land-surface-2`. Max 1 primary CTA per viewport.
3. Links in text: `text-land-fg-strong underline decoration-land-border`;
   hover = `decoration-land-fg-strong` (thicker/darker underline). Not accent.
4. Radius: boxes (cards, inputs, images, FAQ rows, tier panels) =
   `rounded-land-md` (0.75rem); buttons and the billing toggle =
   `rounded-land-pill`. Nothing else, no `rounded-sm`, no per-corner radii.
5. Shadow: none on cards, tiers, testimonials, inputs. Only exception: the
   hero screenshot (`shadow-land-hero`).
6. Between-section gap `vsp-xl` (6rem) or `vsp-2xl` (9rem); inside a section
   `vsp-md` (2rem) or smaller. Sections never share a background band except
   the logo strip and the CTA band (`land-surface-2`).
7. Display and h1 use `tracking-land-tight`; uppercase + `tracking-land-caps`
   only on eyebrows and the logo-strip caption.
8. Icons are single-colour line icons in `land-muted`; one icon per feature may
   sit in an accent-soft chip (counts as the section's emphasised element).

Known failure mode: generated landing pages come back with gradient hero
backgrounds, accent-tinted section bands, three shadows per card and a primary
button in every section. This brand is white, bordered, one-accent. When in
doubt: white ground, 1px border, one blue button.

## 3. Tokens

`styles/base.css`: preflight + utilities, raw tier in `:root`, semantic tier in
`@theme`, `@source "../components"`. No default theme.

### Raw palette (`:root`)

| Token | Value | Note |
| --- | --- | --- |
| `--land-palette-gray-0` | `oklch(0.995 0.002 250)` | page ground |
| `--land-palette-gray-1` | `oklch(0.975 0.004 250)` | surface (cards, inputs) |
| `--land-palette-gray-2` | `oklch(0.935 0.006 250)` | band (logo strip, CTA band), hover |
| `--land-palette-gray-3` | `oklch(0.865 0.008 250)` | border |
| `--land-palette-gray-4` | `oklch(0.62 0.012 250)` | faint / placeholder |
| `--land-palette-gray-5` | `oklch(0.48 0.015 250)` | muted text, icons |
| `--land-palette-gray-6` | `oklch(0.26 0.02 250)` | body text |
| `--land-palette-gray-7` | `oklch(0.16 0.02 250)` | headings |
| `--land-palette-cobalt-1` | `oklch(0.95 0.03 262)` | accent-soft chip |
| `--land-palette-cobalt-4` | `oklch(0.52 0.22 262)` | accent |
| `--land-palette-cobalt-5` | `oklch(0.44 0.20 262)` | accent pressed/hover |
| `--land-palette-green-4` | `oklch(0.60 0.15 150)` | success |
| `--land-palette-red-4` | `oklch(0.55 0.19 25)` | danger |

The brand ramp and the accent ramp are the same cobalt ramp: Orrery has one
colour. No second hue exists in the palette.

### Semantic colours (`@theme`)

| Token | Value | Use |
| --- | --- | --- |
| `--color-land-bg` | gray-0 | page, header, footer |
| `--color-land-surface` | gray-1 | cards, tiers, testimonials, inputs, FAQ rows |
| `--color-land-surface-2` | gray-2 | logo strip band, CTA band, hover on secondary buttons and FAQ rows, inactive toggle track |
| `--color-land-border` | gray-3 | every 1px rule, card border, input border |
| `--color-land-faint` | gray-4 | placeholders, disabled, strike-through yearly price |
| `--color-land-muted` | gray-5 | eyebrows, captions, icons, footer links at rest |
| `--color-land-fg` | gray-6 | body, lead |
| `--color-land-fg-strong` | gray-7 | headings, prices, nav links, link resting colour |
| `--color-land-link` | gray-7 | text links; underline `land-border`. NOT accent |
| `--color-land-accent` | cobalt-4 | *scarce* — primary CTA fill, "Popular" tier border + label, one emphasised word, active toggle thumb, check icons on the popular tier only |
| `--color-land-accent-strong` | cobalt-5 | primary CTA hover, focus ring |
| `--color-land-accent-soft` | cobalt-1 | one icon chip per feature section (counts as the emphasised element) |
| `--color-land-accent-fg` | `oklch(0.99 0 0)` | text on accent |
| `--color-land-focus` | cobalt-5 | `:focus-visible` 2px outline offset 2px |
| `--color-land-success` | green-4 | form success panel border/title |
| `--color-land-danger` | red-4 | form errors |

### Spacing (`@theme`)

| Token | Value | Typical use |
| --- | --- | --- |
| `--spacing-land-hsp-xs` | `0.5rem` | icon-to-label, chip padding-x |
| `--spacing-land-hsp-sm` | `1rem` | input padding-x, card padding at `sm` |
| `--spacing-land-hsp-md` | `1.5rem` | button padding-x, card padding, grid gap |
| `--spacing-land-hsp-lg` | `2.5rem` | tier padding, split gap at `md` |
| `--spacing-land-hsp-xl` | `4rem` | split gap at `lg`, page inset at `lg` |
| `--spacing-land-hsp-2xl` | `6rem` | hero columns gap at `xl` |
| `--spacing-land-vsp-xs` | `0.5rem` | eyebrow → heading, label → input |
| `--spacing-land-vsp-sm` | `1rem` | heading → lead, list items |
| `--spacing-land-vsp-md` | `2rem` | within-section blocks, card stack |
| `--spacing-land-vsp-lg` | `4rem` | section heading → grid |
| `--spacing-land-vsp-xl` | `6rem` | between sections |
| `--spacing-land-vsp-2xl` | `9rem` | hero top/bottom, around the CTA band |
| `--spacing-land-control-h` | `3rem` | buttons, inputs, toggle |
| `--spacing-land-nav-h` | `4rem` | header row |

Ratio rule: between sections ≥ 3× the within-section gap. The long home page
has 9 sections; it must read as 9 separate blocks when squinted.

### Type (`@theme`)

| Token | Size / line-height | Weight | Use |
| --- | --- | --- | --- |
| `--font-size-land-caption` | `0.875rem` / 1.5 | 500 | eyebrows, logo caption, footer, form hints |
| `--font-size-land-body` | `1.0625rem` / 1.65 | 400 | body, feature copy, FAQ answers, nav |
| `--font-size-land-lead` | `1.25rem` / 1.55 | 400 | hero lead, section intros, testimonial quote |
| `--font-size-land-h3` | `1.375rem` / 1.3 | 600 | feature titles, tier names, FAQ questions |
| `--font-size-land-h2` | `2.25rem` / 1.15 | 600 | section headings; `1.75rem` below `md` |
| `--font-size-land-h1` | `3rem` / 1.08 | 700 | page titles on sub-pages; `2.25rem` below `md` |
| `--font-size-land-display` | `4.5rem` / 1.0 | 700 | home hero only; `2.75rem` below `md` |
| `--font-size-land-price` | `3rem` / 1 | 700 | tier price, `tabular-nums` |
| `--font-land-sans` | `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` | | everything |
| `--tracking-land-tight` | `-0.02em` | | display, h1, h2, price |
| `--tracking-land-caps` | `0.06em` | | with `uppercase` only |
| `--font-weight-land-normal` / `-medium` / `-semibold` / `-bold` | 400 / 500 / 600 / 700 | | |

### Radius, shadow, layout, breakpoints

| Token | Value | Only use |
| --- | --- | --- |
| `--radius-land-md` | `0.75rem` | cards, tiers, testimonials, inputs, images, FAQ rows, logo chips |
| `--radius-land-pill` | `9999px` | buttons, billing toggle track + thumb, "Popular" label |
| `--shadow-land-hero` | `0 24px 64px -24px oklch(0.15 0.02 262 / 0.35)` | hero screenshot only |
| `--container-land-page` | `72rem` | `land.container` default |
| `--container-land-narrow` | `44rem` | prose pages (privacy, terms), FAQ |
| `--breakpoint-land-sm` | `40rem` | 2-column features |
| `--breakpoint-land-md` | `48rem` | hero two columns, 3 tiers in a row |
| `--breakpoint-land-lg` | `64rem` | 3-column features, display size |
| `--breakpoint-land-xl` | `80rem` | max inset |

### Contrastive example

```html
<!-- NG: gradient band, three accent elements, shadowed rounded-xl card -->
<section class="bg-gradient-to-r from-land-accent to-land-accent-soft">
  <h2 class="text-land-accent">Plan together</h2>
  <div class="rounded-xl shadow-lg"><a class="text-land-accent">Learn more →</a></div>
</section>

<!-- OK: white ground, bordered card, one accent CTA per viewport -->
<section class="bg-land-bg py-land-vsp-xl">
  <p class="text-land-caption uppercase tracking-land-caps text-land-muted">Planning</p>
  <h2 class="text-land-h2 tracking-land-tight text-land-fg-strong">Plan together</h2>
  <div class="rounded-land-md border border-land-border bg-land-surface p-land-hsp-md">
    <a class="text-land-fg-strong underline decoration-land-border">Learn more</a>
  </div>
  <a class="rounded-land-pill bg-land-accent text-land-accent-fg">Start free</a>
</section>
```

## 4. Page inventory

Six routes plus the global frame.

**Global frame** (`site-frame`, global template, outlet → `frame-main.content`):
`land.header` (nav: Features, Pricing, About; action: `land.button` "Start
free" → `/#signup`, variant **secondary** — the header never carries the
primary, so the hero and the CTA band stay the only primaries and no viewport
shows two) → `land.container#frame-main` → `land.footer` (nav: Features,
Pricing, About, Privacy, Terms; credit "Built with zudo-composer").

| Route | Node | Source | Sections top → bottom |
| --- | --- | --- | --- |
| `/` | `home` | composition | `land.hero` (display heading "Every moving part of your week, in one view", lead, primary "Start free" → `#signup`, secondary "See pricing" → `/pricing`, screenshot `land-hero-app.webp` with `shadow-land-hero`) · `land.logo-strip` (caption "Teams planning with Orrery", 6 inline SVG wordmarks) · `land.section#features` › `land.section-heading` "Three views, one calendar" › `land.feature-grid` (3 static `land.feature-item`) · `land.section#how` › `land.section-heading` "How it works" › `land.steps-row` (3 static `land.step`) · `land.section` › `land.image` `land-workflow.webp` · `land.section#pricing` › `land.section-heading` "Simple pricing" › `land.pricing-table` (attachment: tiers, sort `order`) · `land.section` › `land.stats` (3 static values) · `land.section` › `land.section-heading` "What teams say" › `land.testimonials` (attachment: testimonials, sort `order`) · `land.section#faq` › `land.section-heading` "Questions" › `land.faq-accordion` (attachment: faq) · `land.cta-band` (heading, primary "Start free" → `#signup`) · `land.section#signup` › `land.signup-form` · `land.demo-note` |
| `/pricing` | `pricing` | composition | `land.section-heading` (h1 "Pricing") · `land.pricing-table` (attachment: tiers) · `land.section` › `land.comparison-note` (static prose) · `land.faq-accordion` (attachment: faq with condition `topic equals billing`) · `land.cta-band` |
| `/features` | `features` | composition | `land.section-heading` (h1 "Features") · `land.feature-grid` (6 static `land.feature-item`) · `land.section` › `land.split` (image `land-workflow.webp` + prose) · `land.cta-band` |
| `/about` | `about` | mapping `about-page` (single) | `land.section-heading` (h1 from content) · `land.split` (image `land-team.webp`, prose body) · `land.section` › `land.section-heading` "Contact" › `land.contact-form` · `land.demo-note` |
| `/privacy` | `privacy` | composition | `land.container` (narrow) › `land.section-heading` (h1 "Privacy") › `land.prose` |
| `/terms` | `terms` | composition | `land.container` (narrow) › `land.section-heading` (h1 "Terms") › `land.prose` |

Primary navigation: Features, Pricing, About. Footer: Features, Pricing,
About, Privacy, Terms.

## 5. Component inventory

Kinds as in the webshop doc (`text`, `select[…]`, `number`, `boolean`,
`list<…>`, `group{…}`). Image props are `text` named `src`.

### Chrome and layout

| Id | Purpose | Props | Slots |
| --- | --- | --- | --- |
| `land.header` | Brand wordmark (inline SVG), nav, one secondary button | `brand: text`, `brandHref: text` | `nav` · Navigation · many · [`land.nav-link`]; `action` · Action · single · [`land.button`] |
| `land.nav-link` | Link with active state from `location.pathname` | `label: text`, `href: text` | — |
| `land.footer` | Two rows: nav + small print with credit | `smallPrint: text`, `creditLabel: text`, `creditHref: text` | `nav` · many · [`land.nav-link`] |
| `land.button` | The only button component; `primary` is the accent | `label: text`, `href: text`, `variant: select[primary\|secondary]`, `size: select[md\|lg]` | — |
| `land.container` | Centred width | `width: select[page\|narrow]` | `content` · many · any |
| `land.stack` | Vertical stack | `gap: select[xs\|sm\|md\|lg]`, `align: select[start\|center]` | `content` · many · any |
| `land.grid` | 1 / 2 / 3 columns at sm / lg | `columns: select[2\|3]`, `gap: select[md\|lg]` | `items` · many · any |
| `land.split` | Two columns from `md`, media first | `ratio: select[1/1\|2/3]`, `reverse: boolean` | `media` · single · [`land.image`]; `copy` · many · any |
| `land.section` | `py-land-vsp-xl`, optional `id` anchor and band | `anchor: text`, `band: boolean` | `content` · many · any |
| `land.section-heading` | Eyebrow + heading + intro, centred or start | `eyebrow: text`, `heading: text` (inline), `intro: text (multiline)`, `as: select[h1\|h2]`, `align: select[start\|center]` | — |
| `land.image` | Figure with `rounded-land-md` | `src: text`, `alt: text`, `aspect: select[16/10\|4/3\|1/1]` | — |
| `land.prose` | Tiny markdown renderer (h2/h3, p, ul/ol, a, em/strong) | `markdown: text (multiline, markdown-source)` | — |
| `land.demo-note` | "Demo — no data is sent." | `text: text` | — |

### Marketing sections

| Id | Purpose | Props | Slots |
| --- | --- | --- | --- |
| `land.hero` | Two columns from `md`: copy left, screenshot right with the one shadow | `eyebrow: text`, `heading: text` (inline), `emphasis: text` (substring of heading rendered in accent; empty = none), `lead: text (multiline)`, `primaryLabel`, `primaryHref`, `secondaryLabel`, `secondaryHref: text`, `src: text`, `alt: text` | — |
| `land.logo-strip` | Band with caption and 6 grey wordmarks (inline SVG, fictional: Pelican Labs, Northfield, Quarto, Halden & Co, Tessera, Brightwater) | `caption: text`, `count: number` (min 3, max 6) | — |
| `land.feature-grid` | Grid host for feature items | `columns: select[2\|3]` | `items` · Features · many · [`land.feature-item`] |
| `land.feature-item` | Icon chip + title + copy | `icon: select[calendar\|people\|clock\|bell\|layers\|lock]`, `title: text`, `body: text (multiline)`, `emphasis: boolean` (accent-soft chip; max 1 true per grid) | — |
| `land.steps-row` | Numbered 3-step row | — | `steps` · Steps · many · [`land.step`] |
| `land.step` | Number, title, copy | `number: number` (min 1, max 9), `title: text`, `body: text (multiline)` | — |
| `land.pricing-table` | List host; provides the billing context + toggle (Monthly / Yearly, "save 20%") | `defaultBilling: select[monthly\|yearly]`, `currency: text` ("USD"), `yearlyNote: text` | `tiers` · Tiers · many · [`land.pricing-tier`] |
| `land.pricing-tier` | One tier; subscribes to billing; `popular` gets the accent frame + label and is the viewport's emphasised element; every tier button is `secondary` | `name: text`, `tagline: text`, `priceMonthly: number`, `priceYearly: number` (per month, billed yearly), `currency: text`, `ctaLabel: text`, `ctaHref: text`, `popular: boolean`, `feature1 … feature6: text` (empty = absent), `order: number` | — |
| `land.testimonials` | List host, 3-up grid | — | `testimonials` · Testimonials · many · [`land.testimonial`] |
| `land.testimonial` | Quote, name, role, avatar | `quote: text (multiline)`, `name: text`, `role: text`, `src: text`, `alt: text`, `order: number` | — |
| `land.stats` | Three big numbers | `stat1Value`, `stat1Label`, `stat2Value`, `stat2Label`, `stat3Value`, `stat3Label: text` | — |
| `land.faq-accordion` | List host of `<details>` rows | `allowMultiple: boolean` | `items` · many · [`land.faq-item`] |
| `land.faq-item` | Question + markdown answer | `question: text`, `answer: text (multiline, markdown-source)`, `topic: select[general\|billing\|security]`, `order: number` | — |
| `land.cta-band` | `land-surface-2` band, heading, one primary button | `heading: text`, `lead: text`, `buttonLabel: text`, `buttonHref: text` | — |
| `land.comparison-note` | Short prose under pricing ("All plans include…") | `markdown: text (multiline, markdown-source)` | — |
| `land.signup-form` | Mock: work email + team size select → 600 ms → success panel | `heading: text`, `lead: text`, `buttonLabel: text`, `successHeading: text`, `successText: text (multiline)` | — |
| `land.contact-form` | Mock: name, email, message | `heading: text`, `successText: text` | — |

## 6. Content models

**tiers** (collection) — 3 entries

| Key | Kind | Notes |
| --- | --- | --- |
| `name` | text | Solo / Studio / Org |
| `slug` | slug | |
| `tagline` | text | |
| `priceMonthly` | number | 0 / 12 / 29 |
| `priceYearly` | number | per month when billed yearly: 0 / 10 / 24 |
| `currency` | text | `USD` (currency test) |
| `features` | list<text> | 4–6 bullets; flattened to `feature1…6` by demo-tools |
| `ctaLabel` | text | "Start free" / "Start trial" / "Talk to us" |
| `ctaHref` | text | `/#signup` or `/about` |
| `popular` | boolean | exactly one true (Studio) |
| `order` | number | 1–3 |

**testimonials** (collection) — 3 entries: `quote` long-text, `name` text,
`role` text, `avatar` object { `src` url, `alt` text }, `order` number.

**faq** (collection) — 8 entries: `question` text, `answer` markdown, `topic`
choice `general` / `billing` / `security`, `order` number.

**about** (single): `heading` text, `intro` long-text, `body` markdown.

Privacy and terms are static compositions (`land.prose` props), not content
entries.

## 7. Mapping and route plan

| Mapping | Model | Mode | Composition | Lands in |
| --- | --- | --- | --- | --- |
| `pricing-tier` | tiers | collection (sort `order` asc) | `pricing-tier` (detached; root `land.pricing-tier`) | attachments `home-tiers` → `home › land.pricing-table#home-pricing.tiers`; `pricing-tiers` → `/pricing › land.pricing-table#pricing.tiers` |
| `testimonial` | testimonials | collection (sort `order`) | `testimonial` (detached) | `home-testimonials` → `home › land.testimonials.testimonials` |
| `faq-item` | faq | collection (sort `order`) | `faq-item` (detached) | `home-faq` (no condition) → home accordion; `pricing-faq` (`topic equals billing`) → `/pricing` accordion |
| `about-page` | about | single | `about-page` | node `about`, route `single` |

Bindings: `name`, `tagline`, `ctaLabel`, `ctaHref`, `currency` → `value →
identity → text`; `priceMonthly`, `priceYearly`, `order` → `number`;
`popular` → `boolean`; `features` flattened to `feature1…6` text fields by
demo-tools; `avatar object-field[src] → src`, `[alt] → alt`; `topic value →
identity → select topic`. No `entry-field` routes exist on this site.

## 8. Mock interaction list

Every mock shows `land.demo-note`.

| Interaction | Behaviour |
| --- | --- |
| Billing toggle | `land.pricing-table` context `{ billing }`; toggle is a `role="switch"` pill; tiers swap `priceMonthly` / `priceYearly` and the caption "per month" / "per month, billed yearly"; choice persisted in `localStorage["orrery-billing"]` |
| Signup form | Work email format check, team size select required → 600 ms disabled state → success panel "Check your inbox — in this demo, nothing was sent." |
| Contact form | Name, email, message required → 600 ms → success text |
| FAQ accordion | `<details>`; one open at a time unless `allowMultiple` |
| Anchors | `#features`, `#how`, `#pricing`, `#faq`, `#signup` with `scroll-margin-top` = `nav-h` |

## 9. Image shot list — 6 files

WebP, ≤ 250 KB. Shared style: "clean flat-vector illustration, white
background, cobalt blue (#2E4FD8-like) as the only saturated colour, light
grey line work, no text, no logos".

| File | Purpose | Ratio · px | Prompt | Alt |
| --- | --- | --- | --- | --- |
| `land-hero-app.webp` | hero screenshot | 16:10 · 1600×1000 | "a stylised app window showing a weekly calendar grid with a few blocks, one block highlighted in cobalt blue, soft grey UI lines, white background, flat vector, no text" | "Stylised calendar app window with a week grid and one highlighted block" |
| `land-workflow.webp` | home and features split image | 16:10 · 1600×1000 | "three overlapping rounded cards representing day, week and month views connected by thin grey arrows, one cobalt accent dot, flat vector, white background" | "Three overlapping cards for day, week and month views connected by arrows" |
| `land-team.webp` | about page image | 4:3 · 1600×1200 | "four abstract figures around a table with a large shared calendar on the wall, flat vector, muted greys with one cobalt highlight, no faces, no text" | "Four abstract figures around a table beneath a large wall calendar" |
| `avatar-mara.webp` | testimonial 1 | 1:1 · 400 | "abstract geometric portrait avatar, circle crop ready, soft grey shapes with a cobalt collar, flat vector, no facial detail" | "Abstract geometric avatar in grey with a cobalt collar" |
| `avatar-jonah.webp` | testimonial 2 | 1:1 · 400 | "abstract geometric portrait avatar, circle crop ready, warm grey shapes, cobalt background disc, flat vector, no facial detail" | "Abstract geometric avatar on a cobalt disc" |
| `avatar-priya.webp` | testimonial 3 | 1:1 · 400 | "abstract geometric portrait avatar, circle crop ready, light grey shapes with cobalt glasses outline, flat vector, no facial detail" | "Abstract geometric avatar with cobalt glasses" |

Logo-strip wordmarks are inline SVG in `land.logo-strip` (fictional names,
text converted to paths), not image files.

## 10. Chrome and 404

On `demo-landing.zudolab.dev` the pack's `land.header` and `land.footer`
(global template nodes) are the only chrome; the tool renders the skip link,
`<main id="main-content">` and the not-found state. Nav links are static
`land.nav-link` props. Unknown routes (`/signup`, `/docs`) show the
tool-rendered not-found state; no 404 page is authored.

## 11. Canonical page

`/` (home) at 1280 px, hero viewport:

- Accent elements: 2 (primary "Start free" button; the emphasised word in the
  display heading). The header button is secondary.
- Radius declarations visible: 3 (two pill buttons, the screenshot's
  `rounded-land-md`).
- Box shadows: 1 (`shadow-land-hero`).
- Type sizes used in the hero: `caption`, `display`, `lead`, `body`.
- Whole page: 9 sections, between-section gap 6rem or 9rem, 1 primary CTA per
  viewport at every scroll position, 1 shadow total, 0 gradients.
