// This host's component pack. `pack` and every `source.module` are
// "demo-blog/components": the package's own name plus an exported subpath,
// which Node and Vite both resolve without anything installed. Ids, props and
// slots follow docs/demo-sites/blog.md § 5.
import { defineComponent, defineComponentPack } from "@zudo-composer/component-contract";
import { ArticleCard, ArticleHeader, ArticleList, AuthorCard, AuthorGrid, Avatar, RelatedArticles, TagList } from "./articles";
import type { ArticleCardProps, ArticleHeaderProps, ArticleListProps, AuthorCardProps, AuthorGridProps, AvatarProps, RelatedArticlesProps, TagListProps } from "./articles";
import { Callout, Container, DemoNote, Footer, Header, HomeHero, NavLink, PageHeading, Section, SectionHeading, Stack } from "./chrome";
import type { CalloutProps, ContainerProps, DemoNoteProps, FooterProps, HeaderProps, HomeHeroProps, NavLinkProps, PageHeadingProps, SectionHeadingProps, SectionProps, StackProps } from "./chrome";
import { Comment, CommentForm, CommentList, Newsletter } from "./comments";
import type { CommentFormProps, CommentListProps, CommentProps, NewsletterProps } from "./comments";
import { ProseBody, type ProseBodyProps } from "./prose";

const MODULE = "demo-blog/components";
const source = (exportName: string) => ({ module: MODULE, exportKind: "named" as const, exportName });

const text = <P extends string>(prop: P, label: string) => ({ prop, label, kind: "text" as const });
const multiline = <P extends string>(prop: P, label: string) => ({ prop, label, schema: { type: "string" as const }, editor: { kind: "text" as const, multiline: true } });
const markdown = <P extends string>(prop: P, label: string) => ({ prop, label, schema: { type: "string" as const }, editor: { kind: "text" as const, multiline: true, mode: "markdown-source" as const } });
const inline = <P extends string>(prop: P, label: string) => ({ prop, label, schema: { type: "string" as const }, editor: { kind: "text" as const }, inlineEdit: true as const });
const bool = <P extends string>(prop: P, label: string) => ({ prop, label, kind: "boolean" as const });
const num = <P extends string>(prop: P, label: string, min = 0) => ({ prop, label, kind: "number" as const, min, step: 1 });

/** Inline-editable headings carry `data-blog-inline`; the Composer edits that element in place. */
const inlineTarget = (root: Element): Element | null => (root.matches("[data-blog-inline]") ? root : root.querySelector("[data-blog-inline]"));
const inlineEditor = <P extends string>(field: P) => ({ inlineEditor: { field, resolveElement: inlineTarget } });

const header = defineComponent<HeaderProps>()(Header, {
  id: "blog.header",
  schemaVersion: 1,
  title: "Header",
  category: "Chrome",
  description: "Hairline-ruled header with the serif wordmark and sans nav; the current item gets the accent underline.",
  source: source("Header"),
  defaults: { brand: "Margin Notes", brandHref: "/" },
  fields: [text("brand", "Brand"), text("brandHref", "Brand link")],
  slots: [{ id: "nav", prop: "nav", label: "Navigation", accepts: ["blog.nav-link"], cardinality: "many" }],
});

const navLink = defineComponent<NavLinkProps>()(NavLink, {
  id: "blog.nav-link",
  schemaVersion: 1,
  title: "Nav link",
  category: "Chrome",
  description: "Navigation link; inside the header it is marked current when its href prefixes the page path.",
  source: source("NavLink"),
  defaults: { label: "Articles", href: "/articles" },
  fields: [text("label", "Label"), text("href", "Link")],
});

const footer = defineComponent<FooterProps>()(Footer, {
  id: "blog.footer",
  schemaVersion: 1,
  title: "Footer",
  category: "Chrome",
  description: "Hairline top rule, footer nav, small print and the credit link.",
  source: source("Footer"),
  defaults: { smallPrint: "Margin Notes is a journal about working with attention.", creditLabel: "Built with zudo-composer", creditHref: "https://zudo-composer.zudolab.dev" },
  fields: [multiline("smallPrint", "Small print"), text("creditLabel", "Credit label"), text("creditHref", "Credit link")],
  slots: [{ id: "nav", prop: "nav", label: "Navigation", accepts: ["blog.nav-link"], cardinality: "many" }],
});

const container = defineComponent<ContainerProps>()(Container, {
  id: "blog.container",
  schemaVersion: 1,
  title: "Container",
  category: "Layout",
  description: "Centred width: the 64rem page or the 38rem reading measure.",
  source: source("Container"),
  defaults: { width: "page" },
  fields: [{ prop: "width", label: "Width", kind: "select", options: ["page", "measure"] }],
  slots: [{ id: "content", prop: "content", label: "Content", cardinality: "many" }],
});

const stack = defineComponent<StackProps>()(Stack, {
  id: "blog.stack",
  schemaVersion: 1,
  title: "Stack",
  category: "Layout",
  description: "Vertical stack on the vsp ladder.",
  source: source("Stack"),
  defaults: { gap: "md" },
  fields: [{ prop: "gap", label: "Gap", kind: "select", options: ["xs", "sm", "md", "lg"] }],
  slots: [{ id: "content", prop: "content", label: "Content", cardinality: "many" }],
});

const section = defineComponent<SectionProps>()(Section, {
  id: "blog.section",
  schemaVersion: 1,
  title: "Section",
  category: "Layout",
  description: "Section-gap wrapper with an optional top hairline.",
  source: source("Section"),
  defaults: { rule: false },
  fields: [bool("rule", "Top hairline")],
  slots: [{ id: "content", prop: "content", label: "Content", cardinality: "many" }],
});

const sectionHeading = defineComponent<SectionHeadingProps>()(SectionHeading, {
  id: "blog.section-heading",
  schemaVersion: 1,
  title: "Section heading",
  category: "Layout",
  description: "Small serif heading with an optional eyebrow.",
  source: source("SectionHeading"),
  defaults: { eyebrow: "", heading: "Keep reading", as: "h2" },
  fields: [text("eyebrow", "Eyebrow"), inline("heading", "Heading"), { prop: "as", label: "Level", kind: "select", options: ["h2", "h3"] }],
  adapters: inlineEditor("heading"),
});

const pageHeading = defineComponent<PageHeadingProps>()(PageHeading, {
  id: "blog.page-heading",
  schemaVersion: 1,
  title: "Page heading",
  category: "Layout",
  description: "Page h1 with eyebrow and intro at the reading measure.",
  source: source("PageHeading"),
  defaults: { eyebrow: "", heading: "All articles", intro: "" },
  fields: [text("eyebrow", "Eyebrow"), inline("heading", "Heading"), multiline("intro", "Intro")],
  adapters: inlineEditor("heading"),
});

const homeHero = defineComponent<HomeHeroProps>()(HomeHero, {
  id: "blog.home-hero",
  schemaVersion: 1,
  title: "Home hero",
  category: "Layout",
  description: "Display line and lead with one inline prose link.",
  source: source("HomeHero"),
  defaults: { heading: "Notes from the margin", lead: "Short essays on craft, focus and the tools that hold up.", linkLabel: "About the journal", linkHref: "/about" },
  fields: [inline("heading", "Heading"), multiline("lead", "Lead"), text("linkLabel", "Link label"), text("linkHref", "Link")],
  adapters: inlineEditor("heading"),
});

const callout = defineComponent<CalloutProps>()(Callout, {
  id: "blog.callout",
  schemaVersion: 1,
  title: "Callout",
  category: "Content",
  description: "Accent-soft or surface box with a title and short markdown.",
  source: source("Callout"),
  defaults: { title: "Note", markdown: "Margin Notes is a demo site built with zudo-composer.", tone: "soft" },
  fields: [text("title", "Title"), markdown("markdown", "Markdown"), { prop: "tone", label: "Tone", kind: "select", options: ["soft", "surface"] }],
});

const demoNote = defineComponent<DemoNoteProps>()(DemoNote, {
  id: "blog.demo-note",
  schemaVersion: 1,
  title: "Demo note",
  category: "Content",
  description: "States that the page's forms are mocks.",
  source: source("DemoNote"),
  defaults: { text: "Demo — no data is sent." },
  fields: [text("text", "Text")],
});

const articleList = defineComponent<ArticleListProps>()(ArticleList, {
  id: "blog.article-list",
  schemaVersion: 1,
  title: "Article list",
  category: "Articles",
  description: "Hosts article cards in 1–3 columns; optional tag chips filter them, and the mode adds a route rule every card applies.",
  source: source("ArticleList"),
  defaults: { chips: false, columns: "2", mode: "all", emptyText: "No articles here yet.", tagOptions: ["craft", "attention", "tools"] },
  fields: [
    bool("chips", "Tag filter chips"),
    { prop: "columns", label: "Columns", kind: "select", options: ["1", "2", "3"] },
    { prop: "mode", label: "Route rule", kind: "select", options: ["all", "by-route-author", "exclude-route"] },
    text("emptyText", "Empty text"),
    { prop: "tagOptions", label: "Chip tags", schema: { type: "array", items: { schema: { type: "string" }, editor: { kind: "text" } } }, editor: { kind: "list" } },
  ],
  slots: [{ id: "articles", prop: "articles", label: "Articles", accepts: ["blog.article-card"], cardinality: "many" }],
});

const articleCard = defineComponent<ArticleCardProps>()(ArticleCard, {
  id: "blog.article-card",
  schemaVersion: 1,
  title: "Article card",
  category: "Articles",
  description: "Hairline-ruled entry: cover, date · tag, title, intro. Hides itself when its list's tag filter or route rule excludes it.",
  source: source("ArticleCard"),
  defaults: { title: "Sharpen before you cut", href: "/articles/sharpen-before-you-cut", intro: "", date: "Mar 18, 2026", src: "", alt: "", tag1: "craft", tag2: "", tag3: "", authorSlug: "", slug: "" },
  fields: [
    text("title", "Title"), text("href", "Link"), multiline("intro", "Intro"), text("date", "Date"),
    text("src", "Cover image URL"), text("alt", "Cover alt text"),
    text("tag1", "Tag 1"), text("tag2", "Tag 2"), text("tag3", "Tag 3"),
    text("authorSlug", "Author slug"), text("slug", "Slug"),
  ],
});

const articleHeader = defineComponent<ArticleHeaderProps>()(ArticleHeader, {
  id: "blog.article-header",
  schemaVersion: 1,
  title: "Article header",
  category: "Articles",
  description: "Eyebrow, title, intro, byline with avatar, date and reading time, then the full-width cover.",
  source: source("ArticleHeader"),
  defaults: { eyebrow: "", title: "Article title", intro: "", authorName: "", authorHref: "", date: "", bodyLength: 0, src: "", alt: "", caption: "" },
  fields: [
    text("eyebrow", "Eyebrow"), inline("title", "Title"), multiline("intro", "Intro"),
    text("authorName", "Author name"), text("authorHref", "Author link"),
    text("date", "Date"), num("bodyLength", "Body length (characters)"),
    text("src", "Cover image URL"), text("alt", "Cover alt text"), text("caption", "Cover caption"),
  ],
  slots: [{ id: "avatar", prop: "avatar", label: "Byline avatar", accepts: ["blog.avatar"], cardinality: "single" }],
  adapters: inlineEditor("title"),
});

const avatar = defineComponent<AvatarProps>()(Avatar, {
  id: "blog.avatar",
  schemaVersion: 1,
  title: "Avatar",
  category: "Articles",
  description: "Small round byline avatar for the article header.",
  source: source("Avatar"),
  defaults: { src: "", alt: "" },
  fields: [text("src", "Image URL"), text("alt", "Alt text")],
});

const proseBody = defineComponent<ProseBodyProps>()(ProseBody, {
  id: "blog.prose-body",
  schemaVersion: 1,
  title: "Prose body",
  category: "Articles",
  description: "Markdown at the reading measure; optional accent drop cap on the first paragraph.",
  source: source("ProseBody"),
  defaults: { markdown: "Write the article here.", dropCap: false },
  fields: [markdown("markdown", "Markdown"), bool("dropCap", "Drop cap")],
});

const tagList = defineComponent<TagListProps>()(TagList, {
  id: "blog.tag-list",
  schemaVersion: 1,
  title: "Tag list",
  category: "Articles",
  description: "Caption tags linking to their tag pages; empty tags are skipped.",
  source: source("TagList"),
  defaults: { tag1: "craft", tag2: "", tag3: "", basePath: "/" },
  fields: [text("tag1", "Tag 1"), text("tag2", "Tag 2"), text("tag3", "Tag 3"), text("basePath", "Base path")],
});

const authorCard = defineComponent<AuthorCardProps>()(AuthorCard, {
  id: "blog.author-card",
  schemaVersion: 1,
  title: "Author card",
  category: "Articles",
  description: "Avatar, name, bio and link; the hero variant heads an author page.",
  source: source("AuthorCard"),
  defaults: { name: "Mina Okafor", href: "", bio: "", src: "", alt: "", variant: "inline" },
  fields: [text("name", "Name"), text("href", "Link"), multiline("bio", "Bio"), text("src", "Avatar URL"), text("alt", "Avatar alt text"), { prop: "variant", label: "Variant", kind: "select", options: ["inline", "hero"] }],
});

const authorGrid = defineComponent<AuthorGridProps>()(AuthorGrid, {
  id: "blog.author-grid",
  schemaVersion: 1,
  title: "Author grid",
  category: "Articles",
  description: "Hosts author cards.",
  source: source("AuthorGrid"),
  slots: [{ id: "authors", prop: "authors", label: "Authors", accepts: ["blog.author-card"], cardinality: "many" }],
});

const relatedArticles = defineComponent<RelatedArticlesProps>()(RelatedArticles, {
  id: "blog.related-articles",
  schemaVersion: 1,
  title: "Related articles",
  category: "Articles",
  description: "One row of up to `limit` article cards, hiding the card for the current page.",
  source: source("RelatedArticles"),
  defaults: { heading: "", limit: 3 },
  fields: [text("heading", "Heading"), num("limit", "Visible cards", 1)],
  slots: [{ id: "articles", prop: "articles", label: "Articles", accepts: ["blog.article-card"], cardinality: "many" }],
});

const commentList = defineComponent<CommentListProps>()(CommentList, {
  id: "blog.comment-list",
  schemaVersion: 1,
  title: "Comment list",
  category: "Comments",
  description: "Prefilled comments for this page, then any posted locally from the comment form this session.",
  source: source("CommentList"),
  defaults: { emptyText: "No comments yet." },
  fields: [text("emptyText", "Empty text")],
  slots: [{ id: "comments", prop: "comments", label: "Comments", accepts: ["blog.comment"], cardinality: "many" }],
});

const comment = defineComponent<CommentProps>()(Comment, {
  id: "blog.comment",
  schemaVersion: 1,
  title: "Comment",
  category: "Comments",
  description: "Name, date and body; inside a comment list it hides unless its article slug matches the page.",
  source: source("Comment"),
  defaults: { name: "Reader", date: "", body: "", articleSlug: "" },
  fields: [text("name", "Name"), text("date", "Date"), multiline("body", "Body"), text("articleSlug", "Article slug")],
});

const commentForm = defineComponent<CommentFormProps>()(CommentForm, {
  id: "blog.comment-form",
  schemaVersion: 1,
  title: "Comment form",
  category: "Comments",
  description: "Mock form: validates, waits 600 ms, then adds the comment to this page's list locally.",
  source: source("CommentForm"),
  defaults: { heading: "Leave a comment", buttonLabel: "Post comment", successText: "Posted locally — this demo keeps nothing." },
  fields: [text("heading", "Heading"), text("buttonLabel", "Button label"), text("successText", "Success text")],
});

const newsletter = defineComponent<NewsletterProps>()(Newsletter, {
  id: "blog.newsletter",
  schemaVersion: 1,
  title: "Newsletter",
  category: "Comments",
  description: "Mock email sign-up at the reading measure.",
  source: source("Newsletter"),
  defaults: { heading: "The Sunday note", lead: "One short letter a week, nothing else.", buttonLabel: "Subscribe", successText: "Subscribed locally — this demo keeps nothing." },
  fields: [text("heading", "Heading"), multiline("lead", "Lead"), text("buttonLabel", "Button label"), text("successText", "Success text")],
});

export const componentPack = defineComponentPack({
  packId: "demo-blog",
  packVersion: "1.0.0",
  components: [
    header, navLink, footer, container, stack, section, sectionHeading, pageHeading, homeHero, callout, demoNote,
    articleList, articleCard, articleHeader, avatar, proseBody, tagList, authorCard, authorGrid, relatedArticles,
    commentList, comment, commentForm, newsletter,
  ],
});

export {
  ArticleCard, ArticleHeader, ArticleList, AuthorCard, AuthorGrid, Avatar, Callout, Comment, CommentForm, CommentList, Container, DemoNote,
  Footer, Header, HomeHero, NavLink, Newsletter, PageHeading, ProseBody, RelatedArticles, Section, SectionHeading, Stack, TagList,
};
export type {
  ArticleCardProps, ArticleHeaderProps, ArticleListProps, AuthorCardProps, AuthorGridProps, AvatarProps, CalloutProps, CommentFormProps, CommentListProps,
  CommentProps, ContainerProps, DemoNoteProps, FooterProps, HeaderProps, HomeHeroProps, NavLinkProps, NewsletterProps, PageHeadingProps,
  ProseBodyProps, RelatedArticlesProps, SectionHeadingProps, SectionProps, StackProps, TagListProps,
};
