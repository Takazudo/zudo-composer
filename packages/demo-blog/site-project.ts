// The authored Margin Notes site (docs/demo-sites/blog.md). `pnpm generate`
// turns this into `site-project.json`; the tests fail when the two disagree.
// Article bodies live in content/articles/<slug>.md; images are looked up by
// file name in the configured Assets store (`pnpm seed` fills it).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineSite, entryRef, node, readAssetUrls } from "zudo-composer/authoring";
import type { CollectionModeInput, Entry, Page } from "zudo-composer/site-project";
import { loadHostContext } from "zudo-composer/vite";
import { componentPack } from "./components/pack";

const packageRoot = import.meta.dirname;
const { composerConfig } = await loadHostContext({ workspaceRoot: packageRoot });
const assetUrls = readAssetUrls(composerConfig);
const assetUrl = (file: string): string => {
  const url = assetUrls[file];
  if (!url) throw new Error(`${composerConfig.paths.assets} has no active asset named ${file}; run \`pnpm seed\`.`);
  return url;
};
const articleBody = (slug: string): string => readFileSync(resolve(packageRoot, "content/articles", `${slug}.md`), "utf8").trim();

const site = defineSite({ id: "demo-blog", name: "Margin Notes", componentPack });

// ── Global frame ────────────────────────────────────────────────────────────

const navLink = (label: string, href: string) => node("blog.nav-link", { label, href });

const frame = site.template({
  name: "Site frame",
  root: [
    node("blog.header", { brand: "Margin Notes", brandHref: "/" }, {
      nav: [navLink("Articles", "/articles"), navLink("Craft", "/craft"), navLink("Attention", "/attention"), navLink("Tools", "/tools"), navLink("About", "/about")],
    }, "frame-header"),
    node("blog.container", { width: "page" }, {}, "frame-main"),
    node("blog.footer", {
      smallPrint: "Margin Notes is a two-author journal about working with attention: short essays on craft, focus and the tools that hold up.",
      creditLabel: "Built with zudo-composer",
      creditHref: "https://zudo-composer.zudolab.dev",
    }, { nav: [navLink("About", "/about"), navLink("Authors", "/authors"), navLink("Newsletter", "/newsletter")] }, "frame-footer"),
  ],
  outlet: { target: { parentId: "frame-main", slotId: "content" } },
});

const DEMO_NOTE = "Demo — no data is sent.";
const demoNote = (id: string) => node("blog.demo-note", { text: DEMO_NOTE }, {}, id);
const newsletterForm = (id: string) => node("blog.newsletter", {
  heading: "The Sunday note",
  lead: "One short letter a week with the newest essay and one thing worth reading slowly. Nothing else.",
  buttonLabel: "Subscribe",
  successText: "Subscribed locally — this demo keeps nothing.",
}, {}, id);

// ── Content models ──────────────────────────────────────────────────────────

const imageFields = [{ key: "src", kind: "url" as const }, { key: "alt", kind: "text" as const }];

const authors = site.model({
  name: "Authors",
  kind: "collection",
  description: "The journal's two writers.",
  fields: [
    { key: "name", kind: "text" },
    { key: "slug", kind: "slug" },
    { key: "bio", kind: "long-text" },
    { key: "avatar", kind: "object", fields: imageFields },
  ],
});

const TAGS = ["craft", "attention", "tools"] as const;
type Tag = typeof TAGS[number];

const articles = site.model({
  name: "Articles",
  kind: "collection",
  description: "Essays. tag1–3 and the author* fields are written by site-project.ts from `tags` and `author` so components can receive them as scalar props.",
  fields: [
    { key: "title", kind: "text" },
    { key: "slug", kind: "slug" },
    { key: "intro", kind: "long-text" },
    { key: "cover", kind: "object", fields: [...imageFields, { key: "caption", kind: "text" }] },
    { key: "body", kind: "markdown" },
    { key: "bodyLength", kind: "number", label: "Body length (characters)" },
    { key: "date", kind: "date" },
    { key: "author", kind: "reference", target: authors },
    { key: "tags", kind: "list", item: { kind: "choice", options: TAGS.map((tag) => ({ value: tag, label: tag.charAt(0).toUpperCase() + tag.slice(1) })) } },
    { key: "tag1", kind: "text", label: "Tag 1" },
    { key: "tag2", kind: "text", label: "Tag 2", required: false },
    { key: "tag3", kind: "text", label: "Tag 3", required: false },
    { key: "authorName", kind: "text" },
    { key: "authorBio", kind: "long-text" },
    { key: "authorAvatar", kind: "object", fields: imageFields },
    { key: "authorSlug", kind: "slug" },
  ],
});

const comments = site.model({
  name: "Comments",
  kind: "collection",
  description: "Prefilled mock comments. The comment form never writes here.",
  fields: [
    { key: "name", kind: "text" },
    { key: "date", kind: "date" },
    { key: "body", kind: "long-text" },
    { key: "article", kind: "reference", target: articles },
    { key: "articleSlug", kind: "slug" },
    { key: "order", kind: "number" },
  ],
});

const about = site.model({
  name: "About",
  kind: "single",
  fields: [
    { key: "heading", kind: "text" },
    { key: "intro", kind: "long-text" },
    { key: "body", kind: "markdown" },
  ],
});

// ── Entries ─────────────────────────────────────────────────────────────────

interface AuthorInput { name: string; slug: string; bio: string; avatar: string; avatarAlt: string }

const authorInputs = {
  mina: {
    name: "Mina Okafor",
    slug: "mina-okafor",
    bio: "Mina writes about attention and the small daily habits that protect it. She keeps one thing on her desk and a pencil in every book.",
    avatar: "avatar-mina-okafor.webp",
    avatarAlt: "Abstract painterly avatar in ochre and cream",
  },
  teodor: {
    name: "Teodor Lindqvist",
    slug: "teodor-lindqvist",
    bio: "Teodor trained as a joiner and now works mostly in text. He writes about tools, maintenance and the craft of doing one thing well.",
    avatar: "avatar-teodor-lindqvist.webp",
    avatarAlt: "Abstract painterly avatar in slate blue and cream",
  },
} satisfies Record<string, AuthorInput>;

const authorEntries = Object.fromEntries(Object.entries(authorInputs).map(([key, author]) => [key, site.entry(authors, {
  id: `author-${author.slug}`,
  values: { name: author.name, slug: author.slug, bio: author.bio, avatar: { src: assetUrl(author.avatar), alt: author.avatarAlt } },
})])) as Record<keyof typeof authorInputs, Entry>;

interface ArticleInput {
  slug: string;
  title: string;
  intro: string;
  author: keyof typeof authorInputs;
  tags: [Tag, ...Tag[]];
  date: string;
  cover: string;
  alt: string;
  caption: string;
}

const articleInputs: ArticleInput[] = [
  {
    slug: "the-half-finished-list", title: "The half-finished list", author: "mina", tags: ["attention"], date: "2026-03-04",
    intro: "Half of every to-do list survives the day. Reading what is left, instead of counting what is done, turns out to be the useful part.",
    cover: "cover-half-finished-list.webp", alt: "A handwritten to-do list with half its items crossed out and a pencil across it",
    caption: "A morning list at six in the evening.",
  },
  {
    slug: "sharpen-before-you-cut", title: "Sharpen before you cut", author: "teodor", tags: ["craft", "tools"], date: "2026-03-18",
    intro: "The first lesson at a woodworking bench was an afternoon at the whetstone. It is still the lesson I use most, and rarely on steel.",
    cover: "cover-sharpen.webp", alt: "A wet whetstone beside a chisel on a wooden bench",
    caption: "Ten minutes at the stone, then back to the wood.",
  },
  {
    slug: "a-desk-with-one-thing-on-it", title: "A desk with one thing on it", author: "mina", tags: ["attention"], date: "2026-04-01",
    intro: "For a month I kept a single object on my desk. The short walk to swap it for another changed how often I switched tasks.",
    cover: "cover-one-thing.webp", alt: "A bare wooden desk with one closed notebook in the centre",
    caption: "One notebook, chosen on purpose.",
  },
  {
    slug: "notes-that-survive-the-week", title: "Notes that survive the week", author: "teodor", tags: ["tools"], date: "2026-04-15",
    intro: "Most notes should be thrown away by Friday. The few that deserve to last have a few things in common, and a box of index cards holds them well.",
    cover: "cover-notes-survive.webp", alt: "A stack of index cards in a binder clip with one card pulled out",
    caption: "The week's keepers, one idea per card.",
  },
  {
    slug: "why-drafts-should-look-unfinished", title: "Why drafts should look unfinished", author: "mina", tags: ["craft"], date: "2026-05-06",
    intro: "How finished a draft looks decides what people will say about it. Early on, pencil and grey boxes invite the conversation that matters.",
    cover: "cover-unfinished-drafts.webp", alt: "Pencil sketch pages with erasing marks and margin notes, fanned out",
    caption: "Crossings-out left in on purpose.",
  },
  {
    slug: "the-quiet-hour", title: "The quiet hour", author: "teodor", tags: ["attention"], date: "2026-05-20",
    intro: "An hour before the day begins, with no task attached to it. It is the most productive hour I have, and I do almost nothing in it.",
    cover: "cover-quiet-hour.webp", alt: "An empty chair beside a window at dawn with a steaming cup on the sill",
    caption: "Seven o'clock, before anyone else has a claim on the day.",
  },
  {
    slug: "choosing-tools-you-can-repair", title: "Choosing tools you can repair", author: "teodor", tags: ["tools", "craft"], date: "2026-06-10",
    intro: "A cracked pen feed, a few coins and an evening at the kitchen table. A tool you can fix is a tool you understand.",
    cover: "cover-repairable-tools.webp", alt: "A fountain pen disassembled into parts on a cloth beside a small screwdriver",
    caption: "Every part of a pen that outlived its first owner.",
  },
  {
    slug: "reading-slowly-on-purpose", title: "Reading slowly on purpose", author: "mina", tags: ["attention", "craft"], date: "2026-06-24",
    intro: "I read fewer books last year than in a decade and remember more of them. The change was a pencil and no page target.",
    cover: "cover-reading-slowly.webp", alt: "An open book with a ribbon bookmark and folded reading glasses on the page",
    caption: "Leave the ribbon at the line where you stopped.",
  },
];

const articleEntries = new Map<string, Entry>(articleInputs.map((article) => {
  const author = authorInputs[article.author];
  const body = articleBody(article.slug);
  return [article.slug, site.entry(articles, {
    id: `article-${article.slug}`,
    values: {
      title: article.title,
      slug: article.slug,
      intro: article.intro,
      cover: { src: assetUrl(article.cover), alt: article.alt, caption: article.caption },
      body,
      bodyLength: body.length,
      date: article.date,
      author: entryRef(authorEntries[article.author]),
      tags: article.tags,
      tag1: article.tags[0],
      tag2: article.tags[1] ?? "",
      tag3: article.tags[2] ?? "",
      authorName: author.name,
      authorBio: author.bio,
      authorAvatar: { src: assetUrl(author.avatar), alt: author.avatarAlt },
      authorSlug: author.slug,
    },
  })];
}));

const commentInputs: { article: string; name: string; date: string; body: string }[] = [
  { article: "the-half-finished-list", name: "Hana", date: "2026-03-05", body: "Asking \"why is this still here?\" instead of counting what got done is such a small change. I tried it last night and found three items that were never mine to do." },
  { article: "the-half-finished-list", name: "Joel P.", date: "2026-03-07", body: "Rewriting leftovers by hand is the part I'll steal. Copy-paste made my list a museum too." },
  { article: "sharpen-before-you-cut", name: "Ruth", date: "2026-03-19", body: "\"Stop sharpening when it cuts\" is going on a card above my desk. I lose far too many afternoons rebuilding my setup instead of using it." },
  { article: "sharpen-before-you-cut", name: "Marco", date: "2026-03-22", body: "The Friday card box for dull edges is a lovely idea. Fixing things mid-task always costs me twice." },
  { article: "sharpen-before-you-cut", name: "Anneke", date: "2026-03-30", body: "As a furniture maker I can confirm the forearm test. The rest of the essay made me look at my inbox rules differently." },
  { article: "a-desk-with-one-thing-on-it", name: "Sol", date: "2026-04-03", body: "The walk across the room is the genius part. Friction in the right place instead of none anywhere." },
  { article: "notes-that-survive-the-week", name: "Priya", date: "2026-04-16", body: "Letting the scrap pad go to the recycling without review sounds terrifying and freeing at the same time. Trying it this Friday." },
  { article: "why-drafts-should-look-unfinished", name: "Dev", date: "2026-05-08", body: "We started sharing wireframes in pencil after reading this, and the feedback moved from button colours to whether the page should exist at all. Exactly right." },
  { article: "the-quiet-hour", name: "Lucia", date: "2026-05-21", body: "Mine is twenty minutes on the balcony after the kids are asleep. Same rules, same effect." },
  { article: "the-quiet-hour", name: "Tom", date: "2026-05-25", body: "No agenda is the hard part. I keep trying to turn it into planning time and it stops working immediately, just as you say." },
  { article: "choosing-tools-you-can-repair", name: "Ines", date: "2026-06-12", body: "\"Can I get my work out in a plain format?\" should be the first question for every piece of software. Thanks for the checklist." },
  { article: "reading-slowly-on-purpose", name: "Kwame", date: "2026-06-26", body: "Saying what a chapter was about before moving on has doubled how much I keep. Five books this year so far, and I can talk about every one." },
];

commentInputs.forEach((comment, index) => {
  const article = articleEntries.get(comment.article);
  if (!article) throw new Error(`Comment ${index + 1} names an unknown article "${comment.article}".`);
  site.entry(comments, {
    id: `comment-${String(index + 1).padStart(2, "0")}`,
    values: { name: comment.name, date: comment.date, body: comment.body, article: entryRef(article), articleSlug: comment.article, order: index + 1 },
  });
});

site.entry(about, {
  id: "about-margin-notes",
  values: {
    heading: "About Margin Notes",
    intro: "A two-author journal about working with attention: short essays on craft, focus and the tools that hold up.",
    body: [
      `![A bare wooden desk with one closed notebook in the centre](${assetUrl("cover-one-thing.webp")} "Where most of these essays start.")`,
      "Margin Notes is written by Mina Okafor and Teodor Lindqvist. Mina writes mostly about attention: the lists, desks and reading habits that decide where a day goes. Teodor writes mostly about tools and craft: sharpening, repairing, and the notes that make work repeatable.",
      "## What we write about",
      "Every essay is short enough to read in one sitting and tries to leave you with one thing to try. The three threads run into each other constantly:",
      "- **Craft** — how good work gets made, slowly and on purpose.\n- **Attention** — where it goes, and the small habits that protect it.\n- **Tools** — choosing, maintaining and repairing the things we work with.",
      "## How often",
      "Roughly one essay a fortnight. If you would rather have them arrive than come looking, [the Sunday note](/newsletter) sends the newest one each week.",
    ].join("\n\n"),
  },
});

// ── Item compositions (detached; one per list kind) ────────────────────────

const articleCard = site.page({ name: "Article card", root: [node("blog.article-card", {}, {}, "article-card")] });
const authorCardItem = site.page({ name: "Author card", root: [node("blog.author-card", { variant: "inline" }, {}, "author-card")] });
const commentItem = site.page({ name: "Comment", root: [node("blog.comment", {}, {}, "comment")] });

const byDateDesc = [{ field: "date", direction: "desc" as const }];

/** One mapping per distinct query: the query lives on the mapping, the card composition is shared. */
const cardMapping = (name: string, mode: Omit<CollectionModeInput, "kind">) => site.mapping({
  name,
  model: articles,
  composition: articleCard,
  mode: { kind: "collection", sort: byDateDesc, ...mode },
  bindings: [
    { field: "title", nodeId: "article-card", prop: "title" },
    { field: "slug", nodeId: "article-card", prop: "href", transform: { kind: "prefix", prefix: "/articles/" } },
    { field: "slug", nodeId: "article-card", prop: "slug" },
    { field: "intro", nodeId: "article-card", prop: "intro" },
    { field: "date", nodeId: "article-card", prop: "date", transform: { kind: "date-medium" } },
    { field: "cover", nodeId: "article-card", prop: "src", projection: { kind: "object-field", fieldIds: [articles.fieldId("cover") + "-src"] } },
    { field: "cover", nodeId: "article-card", prop: "alt", projection: { kind: "object-field", fieldIds: [articles.fieldId("cover") + "-alt"] } },
    { field: "tag1", nodeId: "article-card", prop: "tag1" },
    { field: "tag2", nodeId: "article-card", prop: "tag2" },
    { field: "tag3", nodeId: "article-card", prop: "tag3" },
    { field: "authorSlug", nodeId: "article-card", prop: "authorSlug" },
  ],
});

const allCards = cardMapping("Article cards all", {});
const relatedCards = cardMapping("Article cards related", { limit: 4 });
const tagCards = Object.fromEntries(TAGS.map((tag) => [tag, cardMapping(`Article cards ${tag}`, { conditions: [{ field: "tags", operator: "contains", value: tag }] })])) as Record<Tag, ReturnType<typeof cardMapping>>;

const authorCards = site.mapping({
  name: "Author cards",
  model: authors,
  composition: authorCardItem,
  mode: { kind: "collection", sort: [{ field: "name", direction: "asc" }] },
  bindings: [
    { field: "name", nodeId: "author-card", prop: "name" },
    { field: "slug", nodeId: "author-card", prop: "href", transform: { kind: "prefix", prefix: "/authors/" } },
    { field: "bio", nodeId: "author-card", prop: "bio" },
    { field: "avatar", nodeId: "author-card", prop: "src", projection: { kind: "object-field", fieldIds: [authors.fieldId("avatar") + "-src"] } },
    { field: "avatar", nodeId: "author-card", prop: "alt", projection: { kind: "object-field", fieldIds: [authors.fieldId("avatar") + "-alt"] } },
  ],
});

const commentMapping = site.mapping({
  name: "Comments",
  model: comments,
  composition: commentItem,
  mode: { kind: "collection", sort: [{ field: "order", direction: "asc" }], limit: 100 },
  bindings: [
    { field: "name", nodeId: "comment", prop: "name" },
    { field: "date", nodeId: "comment", prop: "date", transform: { kind: "date-medium" } },
    { field: "body", nodeId: "comment", prop: "body" },
    { field: "articleSlug", nodeId: "comment", prop: "articleSlug" },
  ],
});

// ── Static pages ────────────────────────────────────────────────────────────

const home = site.page({
  name: "Home",
  template: frame,
  root: [
    node("blog.home-hero", {
      heading: "Notes from the margin",
      lead: "Short essays on craft, focus and the tools that hold up — written slowly, by two people who would rather do one thing well.",
      linkLabel: "About the journal",
      linkHref: "/about",
    }, {}, "home-hero"),
    node("blog.section", { rule: true }, {
      content: [
        node("blog.section-heading", { eyebrow: "Latest", heading: "Recent essays", as: "h2" }, {}, "home-latest-heading"),
        node("blog.article-list", { chips: false, columns: "2", mode: "all" }, {}, "home-latest"),
      ],
    }, "home-latest-section"),
    node("blog.section", { rule: true }, { content: [newsletterForm("home-newsletter")] }, "home-newsletter-section"),
    demoNote("home-demo-note"),
  ],
});
site.attach(allCards, { nodeId: "home-latest", slotId: "articles" });

const articlesPage = site.page({
  name: "Articles",
  template: frame,
  root: [
    node("blog.page-heading", { eyebrow: "Archive", heading: "All articles", intro: "Every essay, newest first. Filter by the thread you are following." }, {}, "articles-heading"),
    node("blog.article-list", { chips: true, columns: "3", mode: "all", tagOptions: [...TAGS] }, {}, "articles-all"),
  ],
});
site.attach(allCards, { nodeId: "articles-all", slotId: "articles" });

const tagIntros: Record<Tag, string> = {
  craft: "How good work gets made: sharpening, drafting and reading with a pencil.",
  attention: "Where attention goes, and the small daily habits that protect it.",
  tools: "Choosing, maintaining and repairing the things we work with.",
};

const tagPages = Object.fromEntries(TAGS.map((tag) => {
  const title = tag.charAt(0).toUpperCase() + tag.slice(1);
  const page = site.page({
    name: `Tag ${tag}`,
    template: frame,
    root: [
      node("blog.page-heading", { eyebrow: "Tag", heading: title, intro: tagIntros[tag] }, {}, `tag-${tag}-heading`),
      node("blog.article-list", { chips: false, columns: "2", mode: "all" }, {}, `tag-${tag}-list`),
    ],
  });
  site.attach(tagCards[tag], { nodeId: `tag-${tag}-list`, slotId: "articles" });
  return [tag, page];
})) as Record<Tag, Page>;

const authorsPage = site.page({
  name: "Authors",
  template: frame,
  root: [
    node("blog.page-heading", { eyebrow: "", heading: "Authors", intro: "Margin Notes has two writers. Each essay is signed." }, {}, "authors-heading"),
    node("blog.section", { rule: false }, { content: [node("blog.author-grid", {}, {}, "authors-grid")] }, "authors-section"),
  ],
});
site.attach(authorCards, { nodeId: "authors-grid", slotId: "authors" });

const newsletterPage = site.page({
  name: "Newsletter",
  template: frame,
  root: [
    node("blog.page-heading", { eyebrow: "Newsletter", heading: "The Sunday note", intro: "One short letter a week, on Sunday morning." }, {}, "newsletter-heading"),
    node("blog.prose-body", {
      markdown: [
        "Each Sunday the note brings the newest essay, one passage from a book we are reading slowly, and one small thing to try in the week ahead. It is short enough to read with the first cup of tea.",
        "There is no tracking, no sponsor and no second email. If a week has nothing worth sending, nothing is sent.",
      ].join("\n\n"),
      dropCap: false,
    }, {}, "newsletter-body"),
    newsletterForm("newsletter-form"),
    demoNote("newsletter-demo-note"),
  ],
});

// ── Entry pages (linked to the frame) ───────────────────────────────────────

const articlePage = site.page({
  name: "Article page",
  template: frame,
  root: [
    node("blog.article-header", {}, { avatar: [node("blog.avatar", {}, {}, "article-avatar")] }, "article-header"),
    node("blog.prose-body", { dropCap: true }, {}, "article-body"),
    node("blog.tag-list", { basePath: "/" }, {}, "article-tags"),
    node("blog.author-card", { variant: "inline" }, {}, "article-author"),
    node("blog.section", { rule: true }, {
      content: [
        node("blog.section-heading", { eyebrow: "", heading: "Keep reading", as: "h2" }, {}, "article-related-heading"),
        node("blog.related-articles", { heading: "", limit: 3 }, {}, "article-related"),
      ],
    }, "article-related-section"),
    node("blog.section", { rule: true }, {
      content: [
        node("blog.container", { width: "measure" }, {
          content: [
            node("blog.section-heading", { eyebrow: "", heading: "Comments", as: "h2" }, {}, "article-comments-heading"),
            node("blog.comment-list", { emptyText: "No comments yet. Be the first." }, {}, "article-comments"),
            node("blog.comment-form", { heading: "Leave a comment", buttonLabel: "Post comment", successText: "Posted locally — this demo keeps nothing." }, {}, "article-comment-form"),
            demoNote("article-demo-note"),
          ],
        }, "article-comments-column"),
      ],
    }, "article-comments-section"),
  ],
});
site.attach(relatedCards, { nodeId: "article-related", slotId: "articles" });
site.attach(commentMapping, { nodeId: "article-comments", slotId: "comments" });

const articleAvatar = (prop: "src" | "alt") => ({ kind: "object-field" as const, fieldIds: [`${articles.fieldId("authorAvatar")}-${prop}`] });
const articleCover = (prop: "src" | "alt" | "caption") => ({ kind: "object-field" as const, fieldIds: [`${articles.fieldId("cover")}-${prop}`] });

const articlePageMapping = site.mapping({
  name: "Article page",
  model: articles,
  composition: articlePage,
  mode: { kind: "collection", sort: byDateDesc },
  bindings: [
    { field: "tag1", nodeId: "article-header", prop: "eyebrow" },
    { field: "title", nodeId: "article-header", prop: "title" },
    { field: "intro", nodeId: "article-header", prop: "intro" },
    { field: "authorName", nodeId: "article-header", prop: "authorName" },
    { field: "author", nodeId: "article-header", prop: "authorHref", projection: { kind: "route-link" } },
    { field: "authorAvatar", nodeId: "article-avatar", prop: "src", projection: articleAvatar("src") },
    { field: "authorAvatar", nodeId: "article-avatar", prop: "alt", projection: articleAvatar("alt") },
    { field: "date", nodeId: "article-header", prop: "date", transform: { kind: "date-medium" } },
    { field: "bodyLength", nodeId: "article-header", prop: "bodyLength" },
    { field: "cover", nodeId: "article-header", prop: "src", projection: articleCover("src") },
    { field: "cover", nodeId: "article-header", prop: "alt", projection: articleCover("alt") },
    { field: "cover", nodeId: "article-header", prop: "caption", projection: articleCover("caption") },
    { field: "body", nodeId: "article-body", prop: "markdown" },
    { field: "tag1", nodeId: "article-tags", prop: "tag1" },
    { field: "tag2", nodeId: "article-tags", prop: "tag2" },
    { field: "tag3", nodeId: "article-tags", prop: "tag3" },
    { field: "authorName", nodeId: "article-author", prop: "name" },
    { field: "author", nodeId: "article-author", prop: "href", projection: { kind: "route-link" } },
    { field: "authorBio", nodeId: "article-author", prop: "bio" },
    { field: "authorAvatar", nodeId: "article-author", prop: "src", projection: articleAvatar("src"), id: "article-page-author-card-src" },
    { field: "authorAvatar", nodeId: "article-author", prop: "alt", projection: articleAvatar("alt"), id: "article-page-author-card-alt" },
  ],
});

const authorPage = site.page({
  name: "Author page",
  template: frame,
  root: [
    node("blog.author-card", { variant: "hero" }, {}, "author-hero"),
    node("blog.section", { rule: true }, {
      content: [
        node("blog.section-heading", { eyebrow: "", heading: "Essays", as: "h2" }, {}, "author-articles-heading"),
        node("blog.article-list", { chips: false, columns: "2", mode: "by-route-author" }, {}, "author-articles"),
      ],
    }, "author-articles-section"),
  ],
});
site.attach(allCards, { nodeId: "author-articles", slotId: "articles" });

const authorPageMapping = site.mapping({
  name: "Author page",
  model: authors,
  composition: authorPage,
  mode: { kind: "collection", sort: [{ field: "name", direction: "asc" }] },
  bindings: [
    { field: "name", nodeId: "author-hero", prop: "name" },
    { field: "bio", nodeId: "author-hero", prop: "bio" },
    { field: "avatar", nodeId: "author-hero", prop: "src", projection: { kind: "object-field", fieldIds: [authors.fieldId("avatar") + "-src"] } },
    { field: "avatar", nodeId: "author-hero", prop: "alt", projection: { kind: "object-field", fieldIds: [authors.fieldId("avatar") + "-alt"] } },
  ],
});

const aboutPage = site.page({
  name: "About page",
  template: frame,
  root: [
    node("blog.page-heading", { eyebrow: "About" }, {}, "about-heading"),
    node("blog.prose-body", { dropCap: false }, {}, "about-body"),
    node("blog.callout", { title: "About this site", markdown: "Margin Notes is a demo site built with [zudo-composer](https://zudo-composer.zudolab.dev). The essays are real; the comments, forms and newsletter are mocks that keep nothing.", tone: "soft" }, {}, "about-callout"),
  ],
});

const aboutPageMapping = site.mapping({
  name: "About page",
  model: about,
  composition: aboutPage,
  bindings: [
    { field: "heading", nodeId: "about-heading", prop: "heading" },
    { field: "intro", nodeId: "about-heading", prop: "intro" },
    { field: "body", nodeId: "about-body", prop: "markdown" },
  ],
});

// ── Sitemap ─────────────────────────────────────────────────────────────────

const articlesRoute = {
  id: "articles", title: "Articles", slug: "articles", page: articlesPage,
  children: [{ id: "article", title: "Article", mapping: articlePageMapping, route: "entry-field" as const, field: "slug", titleField: "title" }],
};
const tagRoutes = Object.fromEntries(TAGS.map((tag) => [tag, { id: `tag-${tag}`, title: tag.charAt(0).toUpperCase() + tag.slice(1), slug: tag, page: tagPages[tag] }])) as Record<Tag, { id: string; title: string; slug: string; page: Page }>;
const authorsRoute = {
  id: "authors", title: "Authors", slug: "authors", page: authorsPage,
  children: [{ id: "author", title: "Author", mapping: authorPageMapping, route: "entry-field" as const, field: "slug", titleField: "name" }],
};
const aboutRoute = { id: "about", title: "About", slug: "about", mapping: aboutPageMapping, route: "single" as const };
const newsletterRoute = { id: "newsletter", title: "Newsletter", slug: "newsletter", page: newsletterPage };

site.sitemap({
  name: "Margin Notes sitemap",
  root: { id: "home", title: "Home", page: home, children: [articlesRoute, tagRoutes.craft, tagRoutes.attention, tagRoutes.tools, authorsRoute, aboutRoute, newsletterRoute] },
  navigation: {
    primary: [articlesRoute, tagRoutes.craft, tagRoutes.attention, tagRoutes.tools, aboutRoute].map((route) => ({ route })),
    footer: [aboutRoute, authorsRoute, newsletterRoute].map((route) => ({ route })),
  },
});

export default site;
