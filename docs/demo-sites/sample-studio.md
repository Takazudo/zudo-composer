# Sample Studio polish

The sample SiteProject is authored in `packages/demo-studio/site-project.ts`
and generated into that host's sole `site-project.json`. Tests and the hosted
demo consume this same JSON for the sample served at `/site/*` and on
`zudo-composer.zudolab.dev`. This document says what to improve and within
which walls; task #497 implements it.

## Hard walls (unchanged by this spec)

- Components: only the provider's 12 — `ui.callout`, `ui.card`,
  `ui.prose-md`, `ui.prose-p`, `ui.placeholder-box`, `ui.auto-grid`,
  `ui.container`, `ui.cta-button`, `ui.hero`, `ui.section-heading`,
  `ui.split-layout`, `ui.stack`. No new components, no provider patch, no
  token namespace of its own (the provider sheet is the styling).
- Routes: `/site`, `/site/about`, `/site/services`, `/site/journal`,
  `/site/journal/<slug>` with exactly the three existing slugs
  (`start-with-the-question`, `map-the-moving-parts`,
  `review-in-small-loops`). Sitemap page count stays 5 (home, about,
  services, journal, journal-entry). Nav labels stay `Home, About, Services,
  Journal`. These are asserted in `scripts/routes.mjs`,
  `scripts/check-site-project-boundary.mjs`,
  `scripts/check-standalone-handoff.mjs`,
  `tests/browser/site-project-acceptance.pw.ts` and the README.
- Headings may change; the h1 map in the acceptance spec is updated in the
  same PR.
- Content models keep their ids and field ids (`about-content`,
  `journal-articles`, `about-*-field`, `article-*-field`) so the existing
  Mappings stay valid; adding fields is allowed, renaming is not.

## Non-negotiables for the rewrite

1. Every page has ≥ 3 distinct rhythm blocks (heading → media/copy → cards or
   callout), never heading + one prose block alone.
2. One `ui.hero` on the home page only; sub-pages open with
   `ui.section-heading as="h1"`.
3. `variant: "primary"` CTA ≤ 1 per page (the hero's first action on home;
   none elsewhere — sub-page CTAs are `secondary`).
4. `ui.card variant="accent"` ≤ 1 per grid; the rest `default` / `muted`.
5. `ui.callout` ≤ 1 per page, tone `muted` except one `note` on Services.
6. Copy is written for a real four-person studio: named offers, a story, a
   way of working. No placeholder sentences ("Static about body").
7. Journal articles are 350–600 words each with 2–3 `##` sections and one
   image; the index cards show the real intro (`truncate-160` already applies
   on the entry page; the index cards are static copies of the intro's first
   sentence).

## Image use

`ui.prose-md` renders CommonMark through the provider's sanitised markdown
runtime; the runtime allowlists `img` and `prose-md.css` styles
`.zc-prose-md img`, so markdown images
`![alt](/uploaded-assets/asset-<id>)` are expected to render through
delivery. The asset pass rewrites Markdown destinations (§ README Lists), so
the canonical authoring URL is used in content and pinned at release. #497
verifies this once at runtime:

- **Renders** → use markdown images for the about story image, the services
  lead image and one image per journal article (inside the `markdown` body
  of the Content entry, as the first block after the intro section heading).
  The home page keeps `ui.placeholder-box` in the split layout replaced by a
  `ui.prose-md` node whose markdown is just the image — the one allowed
  single-block prose node, because `ui.hero` has no image prop.
- **Does not render** → keep `ui.placeholder-box` everywhere and file an
  upstream issue on the provider repo with `/dev-upstream-report` asking for
  an Image component. No copying or patching of provider code.

Images are seeded with `pnpm assets:seed-demo` from `scripts/demo-assets/`
(registered in `scripts/seed-demo-assets.ts`) and allowlisted for the hosted
build in `src/hosted-demo/assets.ts`.

## Page-by-page plan

Frame (`site-frame`): unchanged structure — `ui.container` › `ui.stack`
(outlet). Change `gap` from `lg` to `xl` so pages breathe between the tool
chrome and the first heading.

**Home** (`home-page`)
1. `ui.hero` — eyebrow "Sample Studio", heading "Clear ideas, carefully
   shaped", lead rewritten to two sentences about a four-person studio;
   actions: "See our services" (primary, `/services`), "Read the journal"
   (secondary, `/journal`); `variant: "primary"`.
2. `ui.split-layout` ratio `40/60`, gap `lg` — left: studio image
   (`ui.prose-md` with only `![…](…)` if images render, else
   `ui.placeholder-box` 4/3 lg); right: `ui.stack` gap `sm` › `ui.prose-p`
   (what the studio does, 2 sentences) › `ui.prose-p` (how it works, 2
   sentences) › `ui.cta-button` "How we work" (secondary, `/about`, arrow).
3. `ui.section-heading` as `h2`, eyebrow "Recent notes", heading "From the
   journal" › `ui.auto-grid` min `18rem` gap `md` › 3 × `ui.card` (one
   `accent`, two `default`), each: `ui.prose-p` intro sentence +
   `ui.cta-button` secondary arrow to the entry.
4. `ui.callout` tone `muted`, title "Working with us" › `ui.prose-p` one
   sentence + `ui.cta-button` "Start a conversation" (secondary, `/about`).

**About** (`about-page`, mapped from `about-content`)
1. `ui.section-heading` as `h1` (eyebrow "Studio note", heading + intro
   bound).
2. `ui.prose-md` (bound `markdown`) — rewritten to 4 sections: "Who we are"
   (four named roles, no real names), "How we work" (three short working
   cycles), "What we believe" (three principles), "Say hello" (how an
   engagement starts). The story image sits after the first section.
3. `ui.auto-grid` min `16rem` gap `sm` › 3 × `ui.card` `muted` padding `sm`
   titled "Direction", "Design", "Delivery" with one-line `ui.prose-p` each —
   static, mirroring Services.
4. `ui.callout` `muted` "Office hours" › `ui.prose-p`.

**Services** (`services-page`)
1. `ui.section-heading` as `h1` — eyebrow "Services", heading "Ways to work
   together", intro rewritten.
2. `ui.split-layout` `60/40` — left `ui.prose-md` (what an engagement looks
   like, ≈ 120 words, with the services lead image), right `ui.stack` › 3 ×
   `ui.prose-p` (three facts: team size, typical length, how we bill).
3. `ui.auto-grid` min `16rem` gap `split` fill › 3 × `ui.card` (Direction
   `accent`, Design `default`, Delivery `muted`), each with a concrete offer:
   "Direction — a two-week framing sprint that ends in a written brief",
   "Design — interface and content design in weekly visible cycles",
   "Delivery — build, handoff and review points on a fixed rhythm", plus a
   `ui.prose-p` "Starts from…" line and a secondary `ui.cta-button`.
4. `ui.callout` tone `note` "A flexible starting point" — keep, rewrite copy.

**Journal index** (`journal-index-page`)
1. `ui.section-heading` as `h1` — eyebrow "Journal", heading "Working notes",
   intro rewritten.
2. `ui.auto-grid` min `18rem` gap `md` › 3 × `ui.card` (one `accent`),
   each `ui.prose-p` (date line in sentence form + first sentence of the
   intro) › `ui.cta-button` secondary arrow "Read …".
3. `ui.callout` `muted` "Get the notes" › `ui.prose-p` (one sentence pointing
   to the studio's way of sharing; no form — the provider has no form
   component).

**Journal entry** (`journal-entry-page`, mapped from `journal-articles`)
1. `ui.section-heading` as `h1` (eyebrow "Studio journal", heading + intro
   bound).
2. `ui.prose-p` (bound date, `date-medium`).
3. `ui.prose-md` (bound body) — three articles rewritten to 350–600 words,
   each with 2–3 `##` sections and one image after the first section.
4. `ui.callout` `muted` "More notes" › `ui.cta-button` "Back to the journal"
   (secondary, `/journal`) — static.

## Copy direction

- Voice: first person plural, concrete nouns, no superlatives. Sentences ≤ 22
  words. One idea per paragraph.
- Names: the studio is "Sample Studio"; no person names; roles only.
- Articles keep their titles (they are route slugs): "Start with the
  question", "Map the moving parts", "Review in small loops". Each becomes a
  real short essay on that practice with one worked example from a fictional
  engagement.

## Image shot list — 5 files

WebP, ≤ 250 KB, committed to `scripts/demo-assets/`. Shared style: "bright
daylight studio photograph, white walls, pale wood, a few well-chosen objects,
no people, no text, documentary calm".

| File | Purpose | Ratio · px | Prompt | Alt |
| --- | --- | --- | --- | --- |
| `studio-workbench.webp` | home split image | 4:3 · 1600×1200 | "a bright studio worktable with paper sketches, a laptop closed, a pot of pencils, pale wood and white walls" + style | "A bright studio worktable with paper sketches, a closed laptop and a pot of pencils" |
| `studio-wall.webp` | about story image | 16:10 · 1600×1000 | "a white studio wall covered in index cards connected by pencil lines, soft window light" + style | "A white wall covered in index cards connected by pencil lines" |
| `studio-review.webp` | services lead image | 16:10 · 1600×1000 | "two printed interface drafts side by side on a table with a pencil and sticky notes" + style | "Two printed interface drafts side by side with a pencil and sticky notes" |
| `journal-question.webp` | article: Start with the question | 16:10 · 1600×1000 | "a single sheet of paper with one handwritten question mark, centred on a pale wooden desk" + style | "A sheet of paper with a single handwritten question mark on a pale desk" |
| `journal-map.webp` | article: Map the moving parts (also reused in Review in small loops) | 16:10 · 1600×1000 | "a hand-drawn diagram of boxes and arrows on a large sheet, a few boxes circled in pencil" + style | "A hand-drawn diagram of boxes and arrows with a few boxes circled" |

"Review in small loops" reuses `studio-review.webp`.

## Acceptance (for #497)

- `pnpm test`, `pnpm site-project:boundary`, `pnpm handoff:boundary`,
  `pnpm build:hosted-demo && pnpm hosted-demo:verify` green.
- 5 sitemap pages, nav labels unchanged, updated h1 map in the acceptance
  spec.
- Every page satisfies the non-negotiables above; count them by reading the
  fixture: primary CTAs ≤ 1 per page, accent cards ≤ 1 per grid, callouts ≤ 1
  per page.
