# Webshop demo — Nightjar Supply

Package `packages/demo-webshop`, domain `demo-shop.zudolab.dev`, token
namespace `shop-`, component id prefix `shop.`. Lists follow
[README § Lists](./README.md#lists). Spacing axes and ladder pairing follow
`src/styles/README.md`; the `@theme` mechanism is the one in
`src/styles/app-tokens.css` under a different namespace.

## 1. Brand

**Nightjar Supply** sells twelve objects for quiet work — desk tools, carry
goods and small lights — photographed on black and sold without fuss. The
site is a **dark catalog**: near-black ground, square edges, flat surfaces,
white type, and a single brass accent that appears only where the shop needs
to signal stock or focus. Product photography is the only colour on most
screens. Hover is an inversion (light on dark becomes dark on light), never a
colour change. The catalog reads like a well-lit shelf, not a dashboard.

## 2. Non-negotiables

1. Accent (`shop-accent`, brass) ≤ 3 elements per viewport; most viewports 0.
   Max 1 filled-accent element per viewport (the cart count dot).
2. Hover = neutral inversion (`bg-shop-inverse-bg text-shop-inverse-fg`),
   never accent, never opacity, never scale.
3. Primary CTA = inverse fill (`bg-shop-inverse-bg text-shop-inverse-fg`),
   square, 1px border same colour. Secondary CTA = 1px `shop-border` outline.
   No accent-filled buttons anywhere.
4. Radius default 0 on everything. Only exception: the cart count dot
   (`rounded-shop-dot`).
5. Box shadow: none on cards, images, panels, inputs, buttons. Only exception:
   the mobile nav drawer (`shadow-shop-drawer`).
6. Uppercase + tracking only on eyebrows, section labels and the status badge
   (`text-shop-caption uppercase tracking-shop-caps`). Headings and buttons
   are sentence case.
7. Surfaces are `shop-bg` and `shop-surface` only; `shop-surface-2` is for
   hover rows and the active filter chip. No gradients.
8. Product images are square 1:1, `object-cover`, on `shop-surface`, no
   border, no radius, no overlay on hover.
9. Prices use `font-shop-mono` with `tabular-nums`, colour `shop-price`
   (= `shop-fg-strong`), never accent.

Known failure mode: generated output for dark catalogs comes back with brass
links, rounded cards, glowing hover states and coloured badges on every card.
This brand is neutral-dominant and square-first. When in doubt: gray, square,
flat, invert on hover.

## 3. Tokens

`styles/base.css`: `@import "tailwindcss/preflight"; @import
"tailwindcss/utilities";` then the raw tier in `:root`, the semantic tier in
`@theme`, then `@source "../components"`. No default theme, so `p-4`,
`rounded-lg`, `shadow-md`, `text-orange-500` do not exist; every utility below
comes from a token here.

### Raw palette (`:root`, prefix-first, not utilities)

| Token | Value | Note |
| --- | --- | --- |
| `--shop-palette-gray-0` | `oklch(0.14 0.005 70)` | page ground |
| `--shop-palette-gray-1` | `oklch(0.18 0.005 70)` | surface |
| `--shop-palette-gray-2` | `oklch(0.23 0.006 70)` | hover row / active chip |
| `--shop-palette-gray-3` | `oklch(0.32 0.006 70)` | border |
| `--shop-palette-gray-4` | `oklch(0.50 0.008 70)` | faint text, disabled |
| `--shop-palette-gray-5` | `oklch(0.66 0.008 70)` | muted text |
| `--shop-palette-gray-6` | `oklch(0.84 0.008 70)` | body text |
| `--shop-palette-gray-7` | `oklch(0.96 0.006 70)` | strong text, inverse fill |
| `--shop-palette-brass-3` | `oklch(0.78 0.13 85)` | accent on dark (focus ring) |
| `--shop-palette-brass-4` | `oklch(0.70 0.13 85)` | accent |
| `--shop-palette-brass-5` | `oklch(0.58 0.12 85)` | accent pressed |
| `--shop-palette-green-4` | `oklch(0.72 0.14 150)` | success |
| `--shop-palette-red-4` | `oklch(0.66 0.18 25)` | danger |

There is no separate brand ramp: the brand colour is the neutral inversion
(gray-7 on gray-0). Brass is the only chromatic ramp and it is the accent.

### Semantic colours (`@theme`, category-first → `bg-shop-*`, `text-shop-*`, `border-shop-*`)

Usage is part of the table. Rows marked *scarce* count against the budget in
§ 2.

| Token | Value | Use |
| --- | --- | --- |
| `--color-shop-bg` | gray-0 | page background; header and footer share it |
| `--color-shop-surface` | gray-1 | product image ground, cart lines, inputs, FAQ rows |
| `--color-shop-surface-2` | gray-2 | hovered rows, active filter chip, table header |
| `--color-shop-border` | gray-3 | every 1px rule and outline button |
| `--color-shop-faint` | gray-4 | disabled text, placeholder, stepper glyphs |
| `--color-shop-muted` | gray-5 | eyebrows, captions, spec labels, secondary nav |
| `--color-shop-fg` | gray-6 | body text, product subtitles |
| `--color-shop-fg-strong` | gray-7 | headings, product names, nav links at rest |
| `--color-shop-link` | gray-7 | link resting colour; underline `shop-border`. NOT accent |
| `--color-shop-inverse-bg` | gray-7 | primary CTA fill; hover fill for links, chips, cards |
| `--color-shop-inverse-fg` | gray-0 | text on `inverse-bg` |
| `--color-shop-price` | gray-7 | prices, totals. NOT accent |
| `--color-shop-accent` | brass-4 | *scarce* — low-stock badge text, cart count dot fill, active sort underline, one emphasised word on the home hero |
| `--color-shop-accent-fg` | gray-0 | text on a filled accent element (count dot only) |
| `--color-shop-focus` | brass-3 | `:focus-visible` 2px outline, offset 2px — accent's only unbounded use |
| `--color-shop-success` | green-4 | checkout success panel border/title, "Added to cart" text |
| `--color-shop-danger` | red-4 | form errors, "Sold out" badge text, remove-line hover text |

### Spacing (`@theme` → `p-shop-hsp-*`, `gap-shop-vsp-*`, …)

Two axes, no numeric scale. Within-group and between-group gaps come from the
same ladder with the boundary one rung up (`src/styles/README.md`).

| Token | Value | Typical use |
| --- | --- | --- |
| `--spacing-shop-hsp-xs` | `0.5rem` | icon-to-label, chip padding-x |
| `--spacing-shop-hsp-sm` | `0.75rem` | input padding-x, badge padding-x |
| `--spacing-shop-hsp-md` | `1.25rem` | button padding-x, card grid gap at `sm` |
| `--spacing-shop-hsp-lg` | `2rem` | grid gap at `lg`, page inset at `md` |
| `--spacing-shop-hsp-xl` | `3rem` | split-layout column gap |
| `--spacing-shop-hsp-2xl` | `5rem` | page inset at `xl` |
| `--spacing-shop-vsp-xs` | `0.5rem` | name → price on a card |
| `--spacing-shop-vsp-sm` | `0.75rem` | label → input, badge → name |
| `--spacing-shop-vsp-md` | `1.5rem` | within-section stack |
| `--spacing-shop-vsp-lg` | `3rem` | section heading → grid |
| `--spacing-shop-vsp-xl` | `5rem` | between sections |
| `--spacing-shop-vsp-2xl` | `8rem` | hero → first section, footer top |
| `--spacing-shop-control-h` | `2.75rem` | button, input, stepper height |
| `--spacing-shop-nav-h` | `3.5rem` | header row |

Ratio rule: the gap between two sections (`vsp-xl`) is ≥ 3× the gap inside
one (`vsp-md`). If a page squints as one even block, the between-group rung is
wrong.

### Type (`@theme` → `text-shop-*`)

| Token | Size / line-height | Family | Use |
| --- | --- | --- | --- |
| `--font-size-shop-caption` | `0.75rem` / 1.5 | sans | eyebrows, badges, spec labels, footer |
| `--font-size-shop-body` | `0.9375rem` / 1.6 | sans | body, nav, buttons, inputs |
| `--font-size-shop-lead` | `1.125rem` / 1.6 | sans | hero lead, product subtitle |
| `--font-size-shop-h3` | `1.125rem` / 1.35 | sans 600 | card product name, FAQ question |
| `--font-size-shop-h2` | `1.5rem` / 1.25 | sans 600 | section headings, cart total |
| `--font-size-shop-h1` | `2.25rem` / 1.15 | sans 600 | page titles, product name on detail |
| `--font-size-shop-display` | `3.5rem` / 1.02 | sans 600, `tracking-shop-tight` | home hero only; `2.25rem` below `md` |
| `--font-shop-sans` | `"Helvetica Neue", Helvetica, Arial, system-ui, sans-serif` | | everything except prices/specs |
| `--font-shop-mono` | `ui-monospace, "SF Mono", Menlo, Consolas, monospace` | | prices, totals, SKU, spec values |
| `--tracking-shop-caps` | `0.08em` | | with `uppercase` only |
| `--tracking-shop-tight` | `-0.01em` | | display only |
| `--font-weight-shop-normal` / `-semibold` | 400 / 600 | | no 500, no 700 |

No web fonts are loaded; the stack is system-resolved so the static build
ships no font files.

### Radius, shadow, layout, breakpoints

| Token | Value | Only use |
| --- | --- | --- |
| `--radius-shop-dot` | `9999px` | cart count dot in the header |
| `--shadow-shop-drawer` | `-24px 0 48px oklch(0 0 0 / 0.55)` | mobile nav drawer |
| `--container-shop-page` | `80rem` | `shop.container` default |
| `--container-shop-prose` | `40rem` | about / FAQ prose measure |
| `--breakpoint-shop-sm` | `40rem` | 2-column grid |
| `--breakpoint-shop-md` | `48rem` | desktop header, split layouts |
| `--breakpoint-shop-lg` | `64rem` | 3-column grid, gallery beside copy |
| `--breakpoint-shop-xl` | `80rem` | 4-column grid |

Default radius is 0 and there is no `--radius-shop-DEFAULT`, so `rounded`
emits nothing; the tone grep in the pack task counts `rounded-shop-dot` (≤ 1
hit) and any other `rounded-`/`shadow-` hit as a violation.

### Contrastive example

```html
<!-- NG: accent as decoration, rounded card, shadow, accent hover -->
<a class="rounded-lg shadow-md hover:text-shop-accent">
  <span class="text-shop-accent uppercase">Desk</span>
  <span class="rounded-full bg-shop-accent">NEW</span>
</a>

<!-- OK: neutral card; badge only when stock says so; hover inverts -->
<a class="block bg-shop-surface hover:bg-shop-inverse-bg hover:text-shop-inverse-fg">
  <span class="text-shop-caption uppercase tracking-shop-caps text-shop-muted">Desk</span>
  <span class="text-shop-caption uppercase tracking-shop-caps text-shop-accent">Only 3 left</span>
</a>
```

## 4. Page inventory

Routes (21 + the global frame ≈ 22 records). Every route lists its nodes in
order; the frame wraps each.

**Global frame** (composition `site-frame`, `publication.kind:
"global-template"`, outlet → `frame-main.content`):
`shop.header` (nav slot: 5 × `shop.nav-link`, `shop.cart-button`) →
`shop.container#frame-main` (outlet) → `shop.footer` (nav slot: 4 ×
`shop.nav-link`; credit "Built with zudo-composer" → `https://github.com/Takazudo/zudo-composer`).

| Route | Node | Sitemap source | Sections top → bottom |
| --- | --- | --- | --- |
| `/` | `home` | composition | `shop.hero` (image `shop-hero.webp`, eyebrow "Nightjar Supply", display heading, lead, primary "Shop all", secondary "About") · `shop.section` › `shop.section-heading` "New this season" › `shop.product-grid#home-featured` (toolbar off; attachment: featured = true, limit 4) · `shop.section` › `shop.section-heading` "Three shelves" › `shop.grid` (3 × `shop.category-tile`: Desk, Carry, Light) · `shop.section` › `shop.newsletter` |
| `/products` | `catalog` | composition | `shop.section-heading` (h1 "All products") · `shop.product-grid#catalog` (toolbar on: result count, category chips, sort, search, pagination 8/page; attachment: all products) |
| `/products/<slug>` ×12 | `product` (child of `catalog`) | mapping `product-page`, route `entry-field` on `slug`, title `name` | `shop.breadcrumbs` · `shop.product-hero` (left: `shop.product-gallery`; right: eyebrow = category, h1 name, subtitle, `shop.price-tag`, `shop.status-badge`, `shop.add-to-cart`, `shop.prose` short description) · `shop.section` › `shop.section-heading` "Details" › `shop.spec-table` · `shop.section` › `shop.section-heading` "More from the shelf" › `shop.related-products` (attachment: featured = true, limit 4; card hides itself when its slug is the current route) |
| `/desk` | `cat-desk` | composition | `shop.hero` (variant `compact`, image = first product of the category) · `shop.product-grid#desk` (toolbar: sort + search, no chips; attachment: category = desk) |
| `/carry` | `cat-carry` | composition | same shape, attachment: category = carry |
| `/light` | `cat-light` | composition | same shape, attachment: category = light |
| `/cart` | `cart` | composition | `shop.section-heading` (h1 "Your cart") · `shop.cart-page` (lines from the store; empty state links to `/products`) · `shop.cart-summary` (subtotal, shipping flat 8, total, "Checkout" primary) · `shop.demo-note` |
| `/checkout` | `checkout` | composition | `shop.section-heading` (h1 "Checkout") · `shop.split` (left `shop.checkout-form`, right `shop.cart-summary` read-only) · `shop.demo-note` |
| `/about` | `about` | mapping `about-page` (single) | `shop.section-heading` (h1 from content) · `shop.split` (left `shop.image` about photo = `shop-hero.webp` reused, right `shop.prose` body markdown) · `shop.section` › `shop.contact-form` |
| `/faq` | `faq` | composition | `shop.section-heading` (h1 "Questions") · `shop.faq-accordion` (attachment: all FAQ entries, sort order asc) |

Primary navigation: Desk, Carry, Light, All products, About. Footer: About,
FAQ, Cart, Checkout. Unknown routes (`/products/nope`, `/sale`) render the
tool's not-found state; no 404 composition exists.

## 5. Component inventory

Field kinds are the component-contract editors: `text` (optionally
`multiline` or `markdown-source`), `select[a|b]`, `number`, `boolean`,
`color`, `list<…>`, `group{…}`. Image props are `text` named `src` so the
asset pass can pin them. Every component has `defaults` for every field.

### Chrome

| Id | Purpose | Props (kind) | Slots (id · label · cardinality · accepts) |
| --- | --- | --- | --- |
| `shop.header` | Sticky top bar: brand link, nav, cart button; collapses to a drawer below `md` | `brand: text` ("Nightjar Supply"), `brandHref: text` ("/") | `nav` · Navigation · many · [`shop.nav-link`]; `actions` · Actions · single · [`shop.cart-button`] |
| `shop.nav-link` | One link; active when `location.pathname` starts with `href` | `label: text`, `href: text`, `exact: boolean` | — |
| `shop.cart-button` | Reads the cart store item count; count dot is the one accent fill | `label: text` ("Cart"), `href: text` ("/cart") | — |
| `shop.footer` | Three columns: nav, small print, credit | `smallPrint: text (multiline)`, `creditLabel: text` ("Built with zudo-composer"), `creditHref: text` | `nav` · Footer links · many · [`shop.nav-link`] |
| `shop.breadcrumbs` | Home › category › product from static props | `items: list<group{label: text, href: text}>` | — |
| `shop.demo-note` | "Demo — no data is sent." muted caption | `text: text` | — |

### Layout

| Id | Purpose | Props | Slots |
| --- | --- | --- | --- |
| `shop.container` | Centred max-width with responsive inset | `width: select[page\|prose]` | `content` · Content · many · any |
| `shop.stack` | Vertical rhythm | `gap: select[xs\|sm\|md\|lg]`, `align: select[start\|center\|stretch]` | `content` · many · any |
| `shop.grid` | Responsive columns (1 / 2 / 3 / 4 at sm / lg / xl) | `columns: select[2\|3\|4]`, `gap: select[md\|lg]` | `items` · many · any |
| `shop.split` | Two columns from `md` | `ratio: select[1/1\|2/3\|3/2]` | `left` · single · any; `right` · many · any |
| `shop.section` | Block spacing wrapper (`py-shop-vsp-xl`) | `tone: select[bg\|surface]` | `content` · many · any |
| `shop.section-heading` | Eyebrow + heading + optional intro; `as` controls the level | `eyebrow: text`, `heading: text` (inline), `intro: text (multiline)`, `as: select[h1\|h2]` | — |

### Catalog

| Id | Purpose | Props | Slots |
| --- | --- | --- | --- |
| `shop.product-grid` | List host; provides the filter/sort/search/page context and toolbar; the toolbar shows the visible count ("12 products") | `toolbar: boolean`, `chips: boolean`, `pageSize: number` (min 4, max 24, step 4), `defaultSort: select[featured\|price-asc\|price-desc\|name]`, `emptyText: text` | `items` · Products · many · [`shop.product-card`] |
| `shop.product-card` | One product: image, category, name, price, badge; whole card is the link; subscribes to the grid context | `name: text`, `href: text`, `src: text`, `alt: text`, `price: number` (min 0, step 0.01), `currency: text` ("USD"), `category: select[desk\|carry\|light]`, `availability: select[in-stock\|low-stock\|sold-out]`, `stockLabel: text`, `slug: text`, `featured: boolean`, `tag1: text`, `tag2: text`, `tag3: text` | — |
| `shop.category-tile` | Home shelf tile: image + label + count text | `label: text`, `href: text`, `src: text`, `alt: text`, `caption: text` | — |
| `shop.status-badge` | Uppercase caption; colour by availability (`low-stock` accent, `sold-out` danger, `in-stock` muted) | `availability: select[in-stock\|low-stock\|sold-out]`, `label: text` | — |
| `shop.price-tag` | `Intl.NumberFormat` currency in mono | `price: number`, `currency: text`, `size: select[body\|h2]` | — |
| `shop.pagination` | Prev / numbers / next; rendered by the grid, also authorable standalone for the canvas | `page: number`, `pageCount: number` | — |

### Content

| Id | Purpose | Props | Slots |
| --- | --- | --- | --- |
| `shop.hero` | Full-bleed image (16:9, `object-cover`, `max-h 70vh`) with copy below | `src: text`, `alt: text`, `eyebrow: text`, `heading: text` (inline), `lead: text (multiline)`, `primaryLabel: text`, `primaryHref: text`, `secondaryLabel: text`, `secondaryHref: text`, `variant: select[display\|compact]` | — |
| `shop.image` | Plain figure | `src: text`, `alt: text`, `aspect: select[1/1\|4/3\|16/9]`, `caption: text` | — |
| `shop.prose` | Tiny in-pack markdown renderer (h2/h3, p, ul/ol, a, em/strong, hr) | `markdown: text (multiline, markdown-source)` | — |
| `shop.faq-accordion` | List host of `<details>` rows; one open at a time | `allowMultiple: boolean` | `items` · Questions · many · [`shop.faq-item`] |
| `shop.faq-item` | `<details>` with summary; square, 1px bottom rule | `question: text`, `answer: text (multiline, markdown-source)`, `order: number` | — |
| `shop.newsletter` | Mock email form | `heading: text`, `lead: text`, `buttonLabel: text` | — |
| `shop.contact-form` | Mock name/email/message form | `heading: text`, `successText: text` | — |

### Product detail, cart, checkout (task #499)

| Id | Purpose | Props | Slots |
| --- | --- | --- | --- |
| `shop.product-hero` | Split: gallery left (`lg`), copy right | `ratio: select[1/1\|3/2]` | `media` · single · [`shop.product-gallery`]; `copy` · many · any |
| `shop.product-gallery` | Main image + thumbnails (only when ≥ 2 images); arrow keys move selection. Images are child nodes because the Assets pass pins only props named `src`/`href`/`poster`/`url` | — | `images` · Images · many · [`shop.gallery-image`] |
| `shop.gallery-image` | One square image; registers with the gallery, shown when selected; empty `src` renders nothing | `src: text`, `alt: text` | — |
| `shop.spec-table` | Two-column rows in mono; empty pairs skipped | `spec1Label … spec6Label: text`, `spec1Value … spec6Value: text` | — |
| `shop.add-to-cart` | Quantity stepper + primary button; disabled when `sold-out`; writes the store; inline "Added" confirmation for 2 s | `slug: text`, `name: text`, `price: number`, `currency: text`, `src: text`, `availability: select[in-stock\|low-stock\|sold-out]`, `maxQuantity: number` (default 10) | — |
| `shop.related-products` | List host without toolbar; each card hides itself when `slug` = current route's last segment; shows at most `limit` visible | `heading: text`, `limit: number` (default 3) | `items` · many · [`shop.product-card`] |
| `shop.cart-page` | Lines from the store: image, name, unit price, stepper, remove, line total; empty state | `emptyText: text`, `emptyHref: text` | — |
| `shop.cart-summary` | Subtotal / shipping / total; optional checkout button | `shipping: number` (default 8), `currency: text`, `checkoutHref: text`, `readOnly: boolean` | — |
| `shop.checkout-form` | Mock: name, email, address, city, postcode, country select, card number (16 digits, any), expiry, CVC → validate → 600 ms → success panel with fake order `NJ-` + 6 digits → clears cart | `heading: text`, `successHeading: text`, `successText: text (multiline)` | — |

## 6. Content models

Field kinds are `src/content/model/types.ts` kinds.

**products** (collection) — 12 entries

| Key | Kind | Notes |
| --- | --- | --- |
| `name` | text | required |
| `slug` | slug | required; route segment |
| `subtitle` | text | one line |
| `description` | markdown | 2–3 short paragraphs |
| `price` | number | in `currency` units, 2 decimals |
| `currency` | text | `USD` on every entry (guarded by the currency test) |
| `availability` | text `in-stock` / `low-stock` / `sold-out` | drives badge + add-to-cart; text, not choice, because a choice cannot bind to a `select` prop (#510) |
| `stockLabel` | text `In stock` / `Only a few left` / `Sold out` / `Ships in 2 weeks` | display text (text for the same reason) |
| `tags` | list<text> | 1–3 tags; `contains` queries |
| `spec` | object { `material`, `dimensions`, `weight`, `origin`, `care`, `warranty` } each text | rendered by `shop.spec-table` |
| `image1` | object { `src`: url, `alt`: text } | required; `/uploaded-assets/asset-<id>` |
| `image2` | object { `src`: url, `alt`: text } | optional (3 products) |
| `featured` | boolean | home grid + related strip |
| `category` | reference → categories | required |
| `related` | reference-list → products (ordered) | authored data; not bound (README § Lists) |

**categories** (collection) — 3 entries: `desk`, `carry`, `light`

| Key | Kind |
| --- | --- |
| `name` | text |
| `slug` | slug |
| `intro` | long-text |
| `image` | object { `src`: url, `alt`: text } (reuses the first product's `image1` asset) |

**faq** (collection) — 8 entries: `question` text, `answer` markdown, `order`
number.

**about** (single): `heading` text, `intro` long-text, `body` markdown.

Products (id · name · category · price · availability · featured):
`ledger-notebook` Ledger Notebook A5 · desk · 24 · in-stock · yes;
`brass-rule` Brass Rule 30 cm · desk · 38 · in-stock · no;
`field-pen` Field Pen · desk · 42 · low-stock · yes;
`slate-tray` Slate Desk Tray · desk · 56 · in-stock · no;
`sling-pouch` Sling Pouch · carry · 64 · in-stock · yes;
`card-wallet` Card Wallet · carry · 58 · in-stock · no;
`key-loop` Key Loop · carry · 22 · low-stock · no;
`rain-cape` Packable Rain Cape · carry · 96 · sold-out · no;
`wick-lamp` Wick Lamp · light · 148 · in-stock · yes;
`pocket-torch` Pocket Torch · light · 46 · in-stock · no;
`candle-set` Candle Set · light · 28 · in-stock · no;
`clip-light` Clip Reading Light · light · 34 · sold-out · no.

## 7. Mapping and route plan

| Mapping | Model | Mode | Composition | Where it lands |
| --- | --- | --- | --- | --- |
| `product-page` | products | collection (sort `name` asc, limit 100) | `product-page` (linked to the frame) | sitemap node `product`, route `entry-field` on `slug`, `titleFieldId` = `name` → `/products/<slug>` |
| `product-card` | products | collection | `product-card` (detached; root `shop.product-card`) | attachments: `catalog-cards` (no conditions, sort `name`) → `catalog › shop.product-grid#catalog.items`; `home-featured` (`featured equals true`, sort `name`, limit 4) → home grid; `desk-cards` / `carry-cards` / `light-cards` (`category equals {ref}`) → each category grid; `related-cards` (`featured equals true`, limit 4) → `product-page › shop.related-products.items` |
| `category-tile` | categories | collection (sort `slug`) | `category-tile` (detached) | `home-shelves` → home `shop.grid#shelves.items` |
| `faq-item` | faq | collection (sort `order` asc) | `faq-item` (detached) | `faq-items` → `/faq › shop.faq-accordion.items` |
| `about-page` | about | single | `about-page` | sitemap node `about`, route `single` |

Bindings on `product-card` and `product-page` (projection → transform → prop):
`name value→identity→name` / `heading`; `slug value→prefix "/products/"→href`;
`image1 object-field[src]→identity→src` and `[alt]→alt` (gallery: one
`shop.gallery-image` child per image field); `price value→number`; `currency value→text`;
`availability value→select`; `stockLabel value→text`; `category
reference-id→select category` (options are the category record ids);
`featured value→boolean`; `subtitle`, `description value→markdown`; spec
`object-field[material]→spec1Value` … with static `spec1Label` props;
`tags` is flattened by demo-tools into `tag1`–`tag3` text fields on the same
entry (the `list` field stays for `contains` queries). No `asset-ref` and no
`reference-list-ids` bindings exist (README § Lists).

## 8. Mock interaction list

Every mock renders `shop.demo-note` ("Demo — no data is sent.") in view.

| Interaction | Behaviour |
| --- | --- |
| Cart store | Module store `{ lines: [{ slug, name, price, currency, src, qty }] }`; `add`, `remove`, `setQuantity`, `clear`, `subtotal`, `count`; persisted to `localStorage["nightjar-cart-v1"]` in try/catch; header count updates on every page |
| Add to cart | Stepper 1–`maxQuantity`; disabled + "Sold out" when `availability = sold-out`; success text "Added — view cart" for 2 s |
| Cart page | Remove line, change quantity (0 removes), totals recompute; empty state |
| Checkout | Required-field validation (inline `shop-danger` text, `aria-invalid`), card number must be 16 digits, expiry `MM/YY`; submit → 600 ms fake delay with disabled button → success panel with order number → cart cleared |
| Catalog toolbar | Category chips (multi-select), sort select (featured / price ↑ / price ↓ / name), search (substring on name + tags, debounced 150 ms), pagination (`pageSize`); state in the URL query (`?cat=desk&sort=price-asc&q=lamp&page=2`) so links are shareable |
| Newsletter | Email format check → 600 ms → "Thanks — this demo keeps nothing." |
| Contact form | Name, email, message required → 600 ms → success text |
| Mobile nav | Drawer from the right, `shadow-shop-drawer`, Escape closes, focus trapped |

## 9. Image shot list — 16 files

All WebP, ≤ 250 KB, generated with `/codex-imagegen`; product shots 1200 ×
1200 (1:1), hero 1600 × 900 (16:9). Style line shared by every prompt:
"studio product photograph on a matte black background, single soft key light
from upper left, no props, no text, no watermark, photorealistic".

| File | Purpose | Ratio · px | Prompt | Alt |
| --- | --- | --- | --- | --- |
| `shop-hero.webp` | home hero, about image | 16:9 · 1600×900 | "wide shot of a dark walnut workbench at night, a small brass lamp lit, a closed notebook and a pen, matte black background, soft key light, photorealistic" | "A dark workbench at night with a small lit brass lamp, a closed notebook and a pen" |
| `p-ledger-notebook.webp` | product image1 | 1:1 · 1200 | "hardcover A5 notebook in charcoal linen with a black elastic band" + style | "Charcoal linen A5 notebook with a black elastic band" |
| `p-ledger-notebook-2.webp` | product image2 | 1:1 · 1200 | "the same charcoal linen notebook open to blank dotted pages" + style | "The notebook open to blank dotted pages" |
| `p-brass-rule.webp` | product | 1:1 · 1200 | "solid brass 30 cm ruler with engraved millimetre marks" + style | "Solid brass 30 cm ruler with engraved marks" |
| `p-field-pen.webp` | product | 1:1 · 1200 | "matte black machined aluminium fountain pen, capped" + style | "Matte black aluminium fountain pen, capped" |
| `p-field-pen-2.webp` | product image2 | 1:1 · 1200 | "the same matte black pen uncapped showing a steel nib" + style | "The pen uncapped, showing its steel nib" |
| `p-slate-tray.webp` | product | 1:1 · 1200 | "shallow rectangular tray cut from dark slate holding two paper clips" + style | "Shallow dark slate desk tray holding two paper clips" |
| `p-sling-pouch.webp` | product | 1:1 · 1200 | "small black waxed-canvas sling pouch with a matte buckle" + style | "Small black waxed-canvas sling pouch" |
| `p-card-wallet.webp` | product | 1:1 · 1200 | "slim black full-grain leather card wallet with two cards showing" + style | "Slim black leather card wallet" |
| `p-key-loop.webp` | product | 1:1 · 1200 | "black leather key loop with a blackened steel ring" + style | "Black leather key loop with a dark steel ring" |
| `p-rain-cape.webp` | product | 1:1 · 1200 | "folded charcoal packable rain cape beside its small stuff sack" + style | "Folded charcoal rain cape beside its stuff sack" |
| `p-wick-lamp.webp` | product | 1:1 · 1200 | "small brass oil lamp with a glass chimney, lit, warm flame" + style | "Small lit brass oil lamp with a glass chimney" |
| `p-wick-lamp-2.webp` | product image2 | 1:1 · 1200 | "the same brass oil lamp unlit, chimney removed beside it" + style | "The brass lamp unlit with its chimney set beside it" |
| `p-pocket-torch.webp` | product | 1:1 · 1200 | "short black anodised aluminium pocket flashlight" + style | "Short black aluminium pocket flashlight" |
| `p-candle-set.webp` | product | 1:1 · 1200 | "three unscented ivory pillar candles of different heights" + style | "Three ivory pillar candles of different heights" |
| `p-clip-light.webp` | product | 1:1 · 1200 | "small black clip-on reading light with a flexible neck" + style | "Small black clip-on reading light" |

Category tiles reuse the first product image of each category
(`p-ledger-notebook`, `p-sling-pouch`, `p-wick-lamp`); no separate files.

## 10. Chrome and 404

On `demo-shop.zudolab.dev` the pack's own `shop.header` and `shop.footer`
(nodes of the `site-frame` global template) are the only chrome; the tool
renders just the skip link, `<main id="main-content">` and the not-found
state. Nav links are static `shop.nav-link` props (labels + hrefs); the
product-page breadcrumb uses static props plus the mapped `name`. Unknown
routes show the tool-rendered not-found state, so no 404 page is authored.
`/site` and `/website-preview` keep the full tool chrome.

## 11. Canonical page

`/products` (catalog) embodies the tone. Measured facts at 1280 px width,
first viewport:

- Accent elements: ≤ 2 (cart count dot if the cart is non-empty; one
  "Only a few left" badge when a low-stock product is in the first row).
- Radius declarations in the rendered viewport: 1 (`rounded-shop-dot` on the
  count dot; 0 when the cart is empty).
- Box shadows: 0.
- Type sizes used: `caption`, `body`, `h3`, `h1` — four of seven.
- Neutral : accent utility ratio in `components/`: ≥ 20 : 1
  (`text-shop-accent` / `bg-shop-accent` / `border-shop-accent` appear in at
  most 4 components: status badge, cart button, product-grid sort underline,
  hero emphasised word).
