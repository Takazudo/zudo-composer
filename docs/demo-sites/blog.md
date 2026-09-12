# Blog demo — Margin Notes

Package `packages/demo-blog`, domain `demo-blog.zudolab.dev`, token namespace
`blog-`, component id prefix `blog.`. Lists follow
[README § Lists](./README.md#lists); spacing axes follow
`src/styles/README.md`; the `@theme` mechanism is the one in
`src/styles/app-tokens.css` under a different namespace.

## 1. Brand

**Margin Notes** is a two-author journal about working with attention: short
essays on craft, focus and the tools that hold up. The site is a **warm light
editorial**: cream ground, near-black ink, a serif display face for titles and
body, sans for metadata and controls, a 38rem reading measure, and one
oxblood accent that lives in prose links and exactly one small chrome element
per viewport. No cards with shadows, no rounded boxes, no coloured tag pills.
Rules are 1px hairlines; images are full-measure rectangles with captions.

## 2. Non-negotiables

1. Accent (`blog-accent`, oxblood) in chrome ≤ 1 element per viewport (the
   current nav item underline, the drop cap, or the comment-form button) —
   never two at once. The active tag chip is neutral (`blog-surface-2` fill,
   `blog-fg-strong` text) because `/articles` already shows the nav underline. Prose links are also accent (underline), but
   prose links are text, not chrome, and are excluded from this count.
2. Hover on prose links = `text-blog-fg-strong` with the underline kept;
   hover on chrome links (nav, card titles, tags) = underline appears, colour
   unchanged. No background fills on hover, no accent hover.
3. Primary button (newsletter, comment submit) = `bg-blog-fg-strong
   text-blog-bg` square; hover = `bg-blog-accent-strong`. It is the one
   accent-family chrome element allowed in its viewport. Secondary = 1px
   `blog-border` outline.
4. Radius default 0. Only exception: avatars (`rounded-blog-avatar`).
5. Box shadow: none. No token exists; any `shadow-` hit is a violation.
6. Serif (`font-blog-serif`) for headings, body, quotes, intros; sans
   (`font-blog-sans`) for eyebrows, dates, tags, bylines, buttons, form
   controls. Nothing else switches family.
7. Reading measure `max-w-blog-measure` (38rem) on article bodies, intros and
   comments; headings on article pages share it. Lists of cards use
   `max-w-blog-page` (64rem).
8. Uppercase + `tracking-blog-caps` only on eyebrows, tag labels and date
   lines. Titles are sentence case.
9. Cover images are 16:10, full measure width on cards and full page width on
   article headers, `object-cover`, no border, no radius, no overlay.

Known failure mode: generated blogs come back with white cards on grey, 8px
corners, drop shadows, coloured tag pills and accent-on-hover everywhere. This
brand is cream, square, hairline-ruled, serif. When in doubt: a 1px rule, not
a card.

## 3. Tokens

`styles/base.css`: preflight + utilities, raw tier in `:root`, semantic tier in
`@theme`, `@source "../components"`. No default theme.

### Raw palette (`:root`)

| Token | Value | Note |
| --- | --- | --- |
| `--blog-palette-gray-0` | `oklch(0.975 0.012 80)` | cream ground |
| `--blog-palette-gray-1` | `oklch(0.955 0.014 80)` | surface (inputs, code, callout) |
| `--blog-palette-gray-2` | `oklch(0.92 0.015 80)` | active chip background |
| `--blog-palette-gray-3` | `oklch(0.85 0.015 80)` | hairline border |
| `--blog-palette-gray-4` | `oklch(0.58 0.015 70)` | faint |
| `--blog-palette-gray-5` | `oklch(0.45 0.018 70)` | muted (meta) |
| `--blog-palette-gray-6` | `oklch(0.25 0.02 60)` | body ink |
| `--blog-palette-gray-7` | `oklch(0.17 0.02 60)` | strong ink, primary button |
| `--blog-palette-oxblood-1` | `oklch(0.93 0.03 25)` | accent-soft (callout tint) |
| `--blog-palette-oxblood-4` | `oklch(0.46 0.13 25)` | accent |
| `--blog-palette-oxblood-5` | `oklch(0.38 0.12 25)` | accent pressed / button hover |
| `--blog-palette-green-4` | `oklch(0.55 0.13 150)` | success |
| `--blog-palette-red-4` | `oklch(0.52 0.17 25)` | danger (distinct lightness from accent; used only on form errors) |

The brand ramp and the accent ramp are the same oxblood ramp.

### Semantic colours (`@theme`)

| Token | Value | Use |
| --- | --- | --- |
| `--color-blog-bg` | gray-0 | page, header, footer |
| `--color-blog-surface` | gray-1 | inputs, inline code, callout, comment body ground |
| `--color-blog-surface-2` | gray-2 | active tag chip background (with `blog-fg-strong` text — the chip spends no accent) |
| `--color-blog-border` | gray-3 | every hairline: header bottom, card top rules, footer top, input border, blockquote bar |
| `--color-blog-faint` | gray-4 | placeholders, disabled |
| `--color-blog-muted` | gray-5 | eyebrows, dates, bylines, tags at rest, reading time |
| `--color-blog-fg` | gray-6 | body, intros, comments |
| `--color-blog-fg-strong` | gray-7 | titles, nav, card titles, primary button fill |
| `--color-blog-link` | oxblood-4 | prose links only (underline `currentColor`, offset 3px); hover `blog-fg-strong` |
| `--color-blog-accent` | oxblood-4 | *scarce* chrome — current nav underline, drop cap on article first paragraph |
| `--color-blog-accent-strong` | oxblood-5 | primary button hover, focus ring |
| `--color-blog-accent-soft` | oxblood-1 | callout background |
| `--color-blog-focus` | oxblood-5 | `:focus-visible` 2px outline |
| `--color-blog-success` | green-4 | comment posted / newsletter success text |
| `--color-blog-danger` | red-4 | form errors |

### Spacing (`@theme`)

| Token | Value | Typical use |
| --- | --- | --- |
| `--spacing-blog-hsp-xs` | `0.5rem` | tag gap, meta separator |
| `--spacing-blog-hsp-sm` | `1rem` | input padding-x, avatar → name |
| `--spacing-blog-hsp-md` | `1.5rem` | button padding-x, card grid gap |
| `--spacing-blog-hsp-lg` | `2.5rem` | card grid gap at `lg`, page inset at `md` |
| `--spacing-blog-hsp-xl` | `4rem` | author card image → text at `lg` |
| `--spacing-blog-hsp-2xl` | `6rem` | page inset at `xl` |
| `--spacing-blog-vsp-xs` | `0.5rem` | date → title on a card |
| `--spacing-blog-vsp-sm` | `1rem` | paragraph gap, title → intro |
| `--spacing-blog-vsp-md` | `1.75rem` | within-section blocks, h2 top margin in prose |
| `--spacing-blog-vsp-lg` | `3rem` | card → card in a single column, body → author card |
| `--spacing-blog-vsp-xl` | `5rem` | between sections, header → article title |
| `--spacing-blog-vsp-2xl` | `7rem` | home hero bottom, footer top |
| `--spacing-blog-control-h` | `2.75rem` | buttons, inputs |
| `--spacing-blog-nav-h` | `3.75rem` | header row |
| `--spacing-blog-avatar-sm` / `-lg` | `2.5rem` / `5rem` | byline / author card |

Ratio rule: section gap (`vsp-xl`) ≥ 2.8× in-section gap (`vsp-md`).

### Type (`@theme`)

| Token | Size / line-height | Family · weight | Use |
| --- | --- | --- | --- |
| `--font-size-blog-caption` | `0.8125rem` / 1.5 | sans 500 | eyebrows, dates, tags, bylines, footer |
| `--font-size-blog-body` | `1.125rem` / 1.7 | serif 400 | article body, comments, card intros |
| `--font-size-blog-lead` | `1.3125rem` / 1.5 | serif 400 | article intro, home hero lead |
| `--font-size-blog-h3` | `1.375rem` / 1.3 | serif 600 | card titles, comment author line, prose h3 |
| `--font-size-blog-h2` | `1.75rem` / 1.25 | serif 600 | prose h2, section headings |
| `--font-size-blog-h1` | `2.5rem` / 1.15 | serif 600 | article title, page titles; `2rem` below `md` |
| `--font-size-blog-display` | `3.5rem` / 1.05 | serif 600 | home hero wordmark line only; `2.5rem` below `md` |
| `--font-blog-serif` | `"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif` | | titles, body, quotes |
| `--font-blog-sans` | `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` | | meta, controls |
| `--font-blog-mono` | `ui-monospace, "SF Mono", Menlo, Consolas, monospace` | | inline code, code blocks (`0.9em`) |
| `--tracking-blog-caps` | `0.08em` | | with `uppercase` only |
| `--font-weight-blog-normal` / `-medium` / `-semibold` | 400 / 500 / 600 | | no 700 |

No web fonts are loaded.

### Radius, shadow, layout, breakpoints

| Token | Value | Only use |
| --- | --- | --- |
| `--radius-blog-avatar` | `9999px` | avatars |
| (no shadow token) | | any `shadow-` utility is a violation |
| `--container-blog-measure` | `38rem` | article body, intro, comments, forms |
| `--container-blog-page` | `64rem` | card lists, header, footer |
| `--breakpoint-blog-sm` | `40rem` | 2-column card grid |
| `--breakpoint-blog-md` | `48rem` | h1/display full size, author card side-by-side |
| `--breakpoint-blog-lg` | `64rem` | 3-column card grid on `/articles` |

### Contrastive example

```html
<!-- NG: card on grey, rounded, shadow, accent pills, accent hover title -->
<article class="rounded-lg bg-white shadow-md">
  <span class="rounded-full bg-blog-accent text-white">Craft</span>
  <h3 class="hover:text-blog-accent">Sharpen before you cut</h3>
</article>

<!-- OK: hairline-ruled entry, muted tag, title underlines on hover -->
<article class="border-t border-blog-border pt-blog-vsp-sm">
  <p class="font-blog-sans text-blog-caption uppercase tracking-blog-caps text-blog-muted">Craft · Mar 4, 2026</p>
  <h3 class="font-blog-serif text-blog-h3 text-blog-fg-strong hover:underline">Sharpen before you cut</h3>
</article>
```

## 4. Page inventory

18 routes plus the global frame.

**Global frame** (`site-frame`, global template, outlet → `frame-main.content`):
`blog.header` (wordmark "Margin Notes", nav: Articles, Craft, Attention, Tools,
About) → `blog.container#frame-main` → `blog.footer` (nav: About, Authors,
Newsletter; small print; credit "Built with zudo-composer").

| Route | Node | Source | Sections top → bottom |
| --- | --- | --- | --- |
| `/` | `home` | composition | `blog.home-hero` (display line "Notes from the margin", lead, one inline link to `/about`) · `blog.article-list#latest` (filter chips off; attachment: all 8 articles sort `date` desc) · `blog.section` › `blog.newsletter` · `blog.demo-note` |
| `/articles` | `articles` | composition | `blog.page-heading` (h1 "All articles") · `blog.article-list#all` (filter chips on: All / Craft / Attention / Tools; attachment: all articles sort `date` desc) |
| `/articles/<slug>` ×8 | `article` (child of `articles`) | mapping `article-page`, route `entry-field` on `slug`, title `title` | `blog.article-header` (eyebrow = tag1, h1 title, intro, byline: avatar + author name → author route via `route-link`, date, reading time from `bodyLength`; cover below) · `blog.prose-body` (markdown) · `blog.tag-list` (tag1–3 → `/craft` …) · `blog.author-card` (mapped from the article's author fields: name, bio, avatar, href) · `blog.section` › `blog.section-heading` "Keep reading" › `blog.related-articles` (attachment: articles sort `date` desc, limit 4; card hides itself on its own route, shows 3) · `blog.section` › `blog.section-heading` "Comments" › `blog.comment-list` (attachment: all comments; each hides itself unless its `articleSlug` matches the route — § 7) · `blog.comment-form` · `blog.demo-note` |
| `/craft` | `tag-craft` | composition | `blog.page-heading` (eyebrow "Tag", h1 "Craft", intro) · `blog.article-list#craft` (chips off; attachment: `tags contains "craft"`) |
| `/attention` | `tag-attention` | composition | same shape; `tags contains "attention"` |
| `/tools` | `tag-tools` | composition | same shape; `tags contains "tools"` |
| `/authors` | `authors` | composition | `blog.page-heading` (h1 "Authors") · `blog.author-grid` (attachment: authors sort `name`) |
| `/authors/<slug>` ×2 | `author` (child of `authors`) | mapping `author-page`, route `entry-field` on `slug`, title `name` | `blog.author-card` (variant `hero`: large avatar, name as h1, bio) · `blog.article-list#by-author` (mode `by-route-author`; attachment: all articles sort `date` desc) |
| `/about` | `about` | mapping `about-page` (single) | `blog.page-heading` (h1 from content) · `blog.prose-body` (body) · `blog.callout` (static: "Margin Notes is a demo site built with zudo-composer") |
| `/newsletter` | `newsletter` | composition | `blog.page-heading` (h1 "The Sunday note") · `blog.prose-body` (static) · `blog.newsletter` · `blog.demo-note` |

Primary navigation: Articles, Craft, Attention, Tools, About. Footer: About,
Authors, Newsletter.

## 5. Component inventory

Kinds as in the other docs. Image props are `text` named `src`.

### Chrome and layout

| Id | Purpose | Props | Slots |
| --- | --- | --- | --- |
| `blog.header` | Hairline-ruled header: serif wordmark, sans nav; current item gets a 2px accent underline | `brand: text`, `brandHref: text` | `nav` · Navigation · many · [`blog.nav-link`] |
| `blog.nav-link` | Link; active from `location.pathname` | `label: text`, `href: text` | — |
| `blog.footer` | Hairline top rule, nav, small print, credit | `smallPrint: text`, `creditLabel: text`, `creditHref: text` | `nav` · many · [`blog.nav-link`] |
| `blog.container` | Centred width | `width: select[page\|measure]` | `content` · many · any |
| `blog.stack` | Vertical stack | `gap: select[xs\|sm\|md\|lg]` | `content` · many · any |
| `blog.section` | `py-blog-vsp-xl` wrapper with optional top hairline | `rule: boolean` | `content` · many · any |
| `blog.section-heading` | Small serif h2 with eyebrow | `eyebrow: text`, `heading: text` (inline), `as: select[h2\|h3]` | — |
| `blog.page-heading` | h1 + eyebrow + intro at measure width | `eyebrow: text`, `heading: text` (inline), `intro: text (multiline)` | — |
| `blog.home-hero` | Display wordmark line + lead with one inline link | `heading: text` (inline), `lead: text (multiline)`, `linkLabel: text`, `linkHref: text` | — |
| `blog.callout` | Accent-soft box with title and markdown | `title: text`, `markdown: text (multiline, markdown-source)`, `tone: select[soft\|surface]` | — |
| `blog.demo-note` | "Demo — no data is sent." | `text: text` | — |

### Articles

| Id | Purpose | Props | Slots |
| --- | --- | --- | --- |
| `blog.article-list` | List host; 1 / 2 / 3 columns; provides the tag-filter context and optional chips; `mode` adds a route rule every card applies (`by-route-author`: show only cards whose `authorSlug` equals the route's last segment; `exclude-route`: hide the card whose `slug` equals it); counts visible children | `chips: boolean`, `columns: select[1\|2\|3]`, `mode: select[all\|by-route-author\|exclude-route]`, `emptyText: text`, `tagOptions: list<text>` (chip labels; default craft, attention, tools) | `articles` · Articles · many · [`blog.article-card`] |
| `blog.article-card` | Cover, date · tag, title, intro; subscribes to the list context; hides when the tag filter excludes its tags or the list's route rule excludes it | `title: text`, `href: text`, `intro: text (multiline)`, `date: text` (display), `src: text`, `alt: text`, `tag1: text`, `tag2: text`, `tag3: text`, `authorSlug: text`, `slug: text` | — |
| `blog.article-header` | Eyebrow, h1, intro, byline, cover | `eyebrow: text`, `title: text` (inline), `intro: text (multiline)`, `authorName: text`, `authorHref: text`, `date: text`, `bodyLength: number` (characters; reading time = ceil(length / 1100) min), `src: text`, `alt: text`, `caption: text` | `avatar` · Byline avatar · single · [`blog.avatar`] |
| `blog.avatar` | Small round byline avatar. A slot child rather than an `authorAvatarSrc` prop because the release asset pass pins managed URLs only in props named `src` / `href` / `poster` / `url` | `src: text`, `alt: text` | — |
| `blog.prose-body` | Markdown → HTML at measure width (h2/h3, p, ul/ol, blockquote, code/pre, a, em/strong, hr, img with `figcaption` from title); first paragraph drop cap in accent when `dropCap` | `markdown: text (multiline, markdown-source)`, `dropCap: boolean` | — |
| `blog.tag-list` | Sans caption tags linking to tag pages; empty strings skipped | `tag1: text`, `tag2: text`, `tag3: text`, `basePath: text` ("/") | — |
| `blog.author-card` | Avatar + name + bio + link; `hero` variant is the author page header | `name: text`, `href: text`, `bio: text (multiline)`, `src: text`, `alt: text`, `variant: select[inline\|hero]` | — |
| `blog.author-grid` | List host for author cards | — | `authors` · Authors · many · [`blog.author-card`] |
| `blog.related-articles` | List host without chips, fixed `exclude-route` rule; single row of up to `limit` visible cards | `heading: text`, `limit: number` (default 3) | `articles` · many · [`blog.article-card`] |

### Comments and forms

| Id | Purpose | Props | Slots |
| --- | --- | --- | --- |
| `blog.comment-list` | List host; renders prefilled comment children, then locally added ones from the form (session state, not persisted) | `emptyText: text` | `comments` · Comments · many · [`blog.comment`] |
| `blog.comment` | Name, date, body; hairline rule between | `name: text`, `date: text`, `body: text (multiline)`, `articleSlug: text` (hidden unless it equals the current route's last segment; empty = always shown) | — |
| `blog.comment-form` | Mock: name, email, comment → validate → 600 ms → appends a `blog.comment` to the nearest list + success text | `heading: text`, `buttonLabel: text`, `successText: text` | — |
| `blog.newsletter` | Mock email form at measure width | `heading: text`, `lead: text`, `buttonLabel: text`, `successText: text` | — |

## 6. Content models

**articles** (collection) — 8 entries

| Key | Kind | Notes |
| --- | --- | --- |
| `title` | text | required |
| `slug` | slug | required |
| `intro` | long-text | 1–2 sentences |
| `cover` | object { `src`: url, `alt`: text, `caption`: text } | required |
| `body` | markdown | 400–800 words |
| `bodyLength` | number | character count, written by demo-tools for reading time |
| `date` | date | `YYYY-MM-DD`; `date-medium` for display |
| `author` | reference → authors | required |
| `tags` | list<text> | 1–3 of `craft` / `attention` / `tools`; flattened to `tag1…3` |
| `authorName`, `authorBio`, `authorAvatar` (object { src, alt }), `authorSlug` | text / long-text / object / slug | denormalised copies written by demo-tools from the referenced author so the article page can render `blog.author-card` and the card can filter by author (see § 7) |

**authors** (collection) — 2 entries: `name` text, `slug` slug, `bio`
long-text, `avatar` object { `src` url, `alt` text }.
Mina Okafor (`mina-okafor`) and Teodor Lindqvist (`teodor-lindqvist`).

**comments** (collection) — 12 prefilled entries: `name` text, `date` date,
`body` long-text, `article` reference → articles, `articleSlug` slug
(denormalised), `order` number. No comment is ever written to storage.

**about** (single): `heading` text, `intro` long-text, `body` markdown.

Articles (slug · title · author · tags · date):
`the-half-finished-list` The half-finished list · mina · attention · 2026-03-04;
`sharpen-before-you-cut` Sharpen before you cut · teodor · craft, tools · 2026-03-18;
`a-desk-with-one-thing-on-it` A desk with one thing on it · mina · attention · 2026-04-01;
`notes-that-survive-the-week` Notes that survive the week · teodor · tools · 2026-04-15;
`why-drafts-should-look-unfinished` Why drafts should look unfinished · mina · craft · 2026-05-06;
`the-quiet-hour` The quiet hour · teodor · attention · 2026-05-20;
`choosing-tools-you-can-repair` Choosing tools you can repair · teodor · tools, craft · 2026-06-10;
`reading-slowly-on-purpose` Reading slowly on purpose · mina · attention, craft · 2026-06-24.

## 7. Mapping and route plan

| Mapping | Model | Mode | Composition | Lands in |
| --- | --- | --- | --- | --- |
| `article-page` | articles | collection (sort `date` desc) | `article-page` (linked to the frame) | node `article` under `articles`, route `entry-field` on `slug`, title `title` → `/articles/<slug>` |
| `article-card` | articles | collection | `article-card` (detached; root `blog.article-card`) | attachments `home-latest` (sort `date` desc, all 8) → `home › blog.article-list#latest.articles`; `all-articles` → `/articles` list; `craft-cards` / `attention-cards` / `tools-cards` (`tags contains "<tag>"`) → tag pages; `related-cards` (sort `date` desc, limit 4) → `article-page › blog.related-articles.articles`; `author-cards` (all, sort `date` desc) → `author-page › blog.article-list#by-author.articles` |
| `author-page` | authors | collection (sort `name`) | `author-page` (linked) | node `author` under `authors`, route `entry-field` on `slug`, title `name` → `/authors/<slug>` |
| `author-card` | authors | collection (sort `name`) | `author-card` (detached; root `blog.author-card`) | `authors-grid` → `/authors › blog.author-grid.authors` |
| `comment` | comments | collection (sort `order` asc, limit 100) | `comment` (detached; root `blog.comment`) | `article-comments` → `article-page › blog.comment-list.comments` |
| `about-page` | about | single | `about-page` | node `about`, route `single` |

Bindings: `title`, `intro value→identity`; `slug value→prefix "/articles/"→href`;
`date value→date-medium→date`; `cover object-field[src]→src`, `[alt]→alt`,
`[caption]→caption`; `body value→identity→markdown`; `bodyLength
value→number`; `author route-link→identity→authorHref` (resolves to the
author's `entry-field` route — this is why `/authors/<slug>` exists);
`authorName`, `authorBio`, `authorSlug` → denormalised text props;
`authorAvatar[src|alt]` → the byline `blog.avatar` and the author card's `src`/`alt`; `tags` flattened to `tag1…3`; `articleSlug` on
comments → `blog.comment.articleSlug`.

Per-route comment filtering: a collection query's conditions are static per
Mapping, so one attachment cannot select "comments for *this* article". The
`comment` attachment therefore materialises all 12 comments into every
article page and each `blog.comment` hides itself unless its `articleSlug`
equals the current route's last segment (1–3 comments remain visible per
article). The same self-hide rule powers the author page's article list and the
"Keep reading" strip. No `asset-ref` or `reference-list-ids` bindings exist.

## 8. Mock interaction list

Every mock shows `blog.demo-note`.

| Interaction | Behaviour |
| --- | --- |
| Tag filter | Chips on `/articles`: All / Craft / Attention / Tools (single select); cards hide when none of `tag1…3` matches; the active chip is neutral (`blog-surface-2` fill, `aria-pressed`) so the header's nav underline stays the viewport's one accent chrome element; state in `?tag=` |
| Comment form | Name (required), email (format), comment (≥ 10 chars) → 600 ms disabled → a new `blog.comment` appears at the end of the list for this page session; success text "Posted locally — this demo keeps nothing." |
| Newsletter | Email format → 600 ms → success text |
| Reading time | `ceil(bodyLength / 1100)` minutes, rendered "6 min read" in the byline |
| Header current item | 2px accent underline on the nav item whose `href` prefixes `location.pathname` |

## 9. Image shot list — 10 files

WebP, ≤ 250 KB. Covers 16:10 · 1600×1000. Shared style: "warm natural-light
photograph, cream and wood tones, shallow depth of field, no people, no text,
no logos, quiet still-life composition".

| File | Purpose | Ratio · px | Prompt | Alt |
| --- | --- | --- | --- | --- |
| `cover-half-finished-list.webp` | article 1 cover | 16:10 · 1600×1000 | "a paper to-do list with half the items crossed out, pencil resting across it, morning window light" + style | "A handwritten to-do list with half its items crossed out and a pencil across it" |
| `cover-sharpen.webp` | article 2 cover | 16:10 | "a whetstone with a few drops of water beside a chisel on a wooden bench" + style | "A wet whetstone beside a chisel on a wooden bench" |
| `cover-one-thing.webp` | article 3 cover | 16:10 | "a plain wooden desk with a single closed notebook centred on it, empty wall behind" + style | "A bare wooden desk with one closed notebook in the centre" |
| `cover-notes-survive.webp` | article 4 cover | 16:10 | "a stack of index cards held by a binder clip, one card pulled out, soft light" + style | "A stack of index cards in a binder clip with one card pulled out" |
| `cover-unfinished-drafts.webp` | article 5 cover | 16:10 | "pencil sketch pages with visible erasing and margin notes, fanned on a table" + style | "Pencil sketch pages with erasing marks and margin notes, fanned out" |
| `cover-quiet-hour.webp` | article 6 cover | 16:10 | "an empty chair by a window at dawn, a cup of tea steaming on the sill" + style | "An empty chair beside a window at dawn with a steaming cup on the sill" |
| `cover-repairable-tools.webp` | article 7 cover | 16:10 | "a disassembled fountain pen laid out in parts on a cloth with a small screwdriver" + style | "A fountain pen disassembled into parts on a cloth beside a small screwdriver" |
| `cover-reading-slowly.webp` | article 8 cover | 16:10 | "an open hardback book with a ribbon bookmark, reading glasses folded on the page" + style | "An open book with a ribbon bookmark and folded reading glasses on the page" |
| `avatar-mina-okafor.webp` | author avatar | 1:1 · 400 | "painterly abstract portrait avatar, warm ochre and cream brushstrokes, circle crop ready, no facial detail" | "Abstract painterly avatar in ochre and cream" |
| `avatar-teodor-lindqvist.webp` | author avatar | 1:1 · 400 | "painterly abstract portrait avatar, slate blue and cream brushstrokes, circle crop ready, no facial detail" | "Abstract painterly avatar in slate blue and cream" |

The about page reuses `cover-one-thing.webp`; no separate file.

## 10. Chrome and 404

On `demo-blog.zudolab.dev` the pack's `blog.header` and `blog.footer` (global
template nodes) are the only chrome; the tool renders the skip link,
`<main id="main-content">` and the not-found state. Nav links are static
`blog.nav-link` props; the byline's author link is a `route-link` projection.
Unknown routes (`/articles/nope`, `/feed`) show the tool-rendered not-found
state; no 404 page is authored.

## 11. Canonical page

`/articles/sharpen-before-you-cut` (an article) at 1280 px:

- Accent chrome elements per viewport: ≤ 1 (current nav underline in the
  first viewport; the drop cap in the second; the comment button in the last).
  Prose links are accent text and excluded.
- Radius declarations: 1 (byline avatar) in the header viewport; 1 (author
  card avatar) further down; 0 elsewhere.
- Box shadows: 0 site-wide.
- Type sizes used on the page: `caption`, `body`, `lead`, `h3`, `h2`, `h1` —
  six of seven; `display` appears only on `/`.
- Families: serif on 100 % of headings and body; sans on 100 % of meta lines
  and controls; body measure 38rem (≈ 66 characters at 1.125rem).
