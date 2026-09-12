import { render } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import {
  ArticleCard, ArticleHeader, ArticleList, AuthorCard, AuthorGrid, Avatar, Callout, Comment, CommentForm, CommentList, Container, DemoNote,
  Footer, Header, HomeHero, NavLink, Newsletter, PageHeading, ProseBody, RelatedArticles, Section, SectionHeading, Stack, TagList,
  componentPack,
} from "../components/pack";
import { parseMarkdown } from "../components/prose";
import { isCurrentHref, readingMinutes } from "../components/runtime";

const EXPECTED_IDS = [
  "blog.header", "blog.nav-link", "blog.footer", "blog.container", "blog.stack", "blog.section", "blog.section-heading", "blog.page-heading",
  "blog.home-hero", "blog.callout", "blog.demo-note", "blog.article-list", "blog.article-card", "blog.article-header", "blog.avatar", "blog.prose-body",
  "blog.tag-list", "blog.author-card", "blog.author-grid", "blog.related-articles", "blog.comment-list", "blog.comment",
  "blog.comment-form", "blog.newsletter",
];

describe("demo-blog pack manifest", () => {
  const byId = new Map(componentPack.manifest.components.map((component) => [component.id, component]));

  it("ships every component in the spec's inventory", () => {
    expect([...byId.keys()].sort()).toEqual([...EXPECTED_IDS].sort());
  });

  it("declares the list slots with their item component", () => {
    const slot = (id: string) => byId.get(id)?.slots.map(({ id: slotId, accepts, cardinality }) => ({ slotId, accepts, cardinality }));
    expect(slot("blog.header")).toEqual([{ slotId: "nav", accepts: ["blog.nav-link"], cardinality: "many" }]);
    expect(slot("blog.footer")).toEqual([{ slotId: "nav", accepts: ["blog.nav-link"], cardinality: "many" }]);
    expect(slot("blog.article-list")).toEqual([{ slotId: "articles", accepts: ["blog.article-card"], cardinality: "many" }]);
    expect(slot("blog.related-articles")).toEqual([{ slotId: "articles", accepts: ["blog.article-card"], cardinality: "many" }]);
    expect(slot("blog.author-grid")).toEqual([{ slotId: "authors", accepts: ["blog.author-card"], cardinality: "many" }]);
    expect(slot("blog.comment-list")).toEqual([{ slotId: "comments", accepts: ["blog.comment"], cardinality: "many" }]);
    expect(slot("blog.article-header")).toEqual([{ slotId: "avatar", accepts: ["blog.avatar"], cardinality: "single" }]);
    for (const id of ["blog.container", "blog.stack", "blog.section"]) expect(slot(id)).toEqual([{ slotId: "content", accepts: undefined, cardinality: "many" }]);
  });

  it("keeps image props as plain text src/alt and every mapped article field as a scalar", () => {
    const card = byId.get("blog.article-card")!;
    expect(card.fields.map((field) => field.prop)).toEqual(["title", "href", "intro", "date", "src", "alt", "tag1", "tag2", "tag3", "authorSlug", "slug"]);
    expect(card.fields.every((field) => field.schema.type === "string")).toBe(true);
    expect(byId.get("blog.article-header")!.fields.find((field) => field.prop === "bodyLength")?.schema.type).toBe("number");
    // The release asset pass pins managed URLs only in props named src/href/poster/url, so no image prop may carry another name.
    for (const component of byId.values()) expect(component.fields.map((field) => field.prop).filter((prop) => /src$/i.test(prop) && prop !== "src"), component.id).toEqual([]);
    expect(byId.get("blog.avatar")!.fields.map((field) => field.prop)).toEqual(["src", "alt"]);
    expect(byId.get("blog.prose-body")!.fields[0]).toMatchObject({ prop: "markdown", editor: { kind: "text", multiline: true, mode: "markdown-source" } });
  });
});

describe("demo-blog component rendering", () => {
  it("renders the header with a nav slot, the current item underlined in accent", () => {
    const html = render(<Header brand="Margin Notes" nav={[<NavLink key="a" label="Articles" href="/articles" />]} />);
    expect(html).toContain("Margin Notes");
    expect(html).toContain('href="/articles"');
    expect(html).toContain("border-b border-blog-border");
  });

  it("marks a nav href current when it prefixes the path", () => {
    expect(isCurrentHref("/site/articles", "/site/articles/the-quiet-hour")).toBe(true);
    expect(isCurrentHref("/site/articles", "/site/articles")).toBe(true);
    expect(isCurrentHref("/site/art", "/site/articles")).toBe(false);
    expect(isCurrentHref("/", "/site")).toBe(false);
  });

  it("renders the footer with nav, small print and the credit link", () => {
    const html = render(<Footer smallPrint="Two authors." nav={[<NavLink key="a" label="About" href="/about" />]} />);
    expect(html).toContain("Two authors.");
    expect(html).toContain('href="https://zudo-composer.zudolab.dev"');
    expect(html).toContain("Built with zudo-composer");
    expect(html).not.toContain("decoration-blog-accent");
  });

  it("renders the layout primitives around their content slot", () => {
    expect(render(<Container width="measure" content={["x"]} />)).toContain("max-w-blog-measure");
    expect(render(<Container content={["x"]} />)).toContain("max-w-blog-page");
    expect(render(<Stack gap="lg" content={["x"]} />)).toContain("gap-blog-vsp-lg");
    expect(render(<Section rule content={["x"]} />)).toBe('<section class="py-blog-vsp-xl border-t border-blog-border">x</section>');
  });

  it("renders headings in serif with eyebrows in caps", () => {
    const section = render(<SectionHeading eyebrow="More" heading="Keep reading" as="h3" />);
    expect(section).toMatch(/<h3 data-blog-inline="true" class="[^"]*text-blog-h3[^"]*">Keep reading<\/h3>/);
    expect(section).toContain("uppercase tracking-blog-caps");
    const page = render(<PageHeading eyebrow="Tag" heading="Craft" intro="Work done with care." />);
    expect(page).toContain("<h1");
    expect(page).toContain("text-blog-lead");
  });

  it("renders the home hero with its display line and one inline link", () => {
    const html = render(<HomeHero heading="Notes from the margin" lead="Short essays." linkLabel="About" linkHref="/about" />);
    expect(html).toContain("blog-md:text-blog-display");
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain("text-blog-link underline");
  });

  it("renders the callout tones and inline markdown", () => {
    expect(render(<Callout title="Note" markdown="A [demo](/about) site." />)).toContain("bg-blog-accent-soft");
    const surface = render(<Callout tone="surface" markdown="Plain." />);
    expect(surface).toContain("bg-blog-surface");
  });

  it("renders the demo note", () => {
    expect(render(<DemoNote />)).toContain("Demo — no data is sent.");
  });

  it("renders an article card as a hairline-ruled entry", () => {
    const html = render(<ArticleCard title="Sharpen before you cut" href="/articles/sharpen" date="Mar 18, 2026" tag1="craft" intro="Short." src="/uploaded-assets/asset-1" alt="A whetstone" />);
    expect(html).toContain("border-t border-blog-border");
    expect(html).toContain("Mar 18, 2026 · craft");
    expect(html).toContain('alt="A whetstone"');
    expect(html).toContain("aspect-blog-cover");
    expect(html).not.toContain("hidden");
  });

  it("renders the article header byline with avatar and reading time", () => {
    const html = render(<ArticleHeader eyebrow="craft" title="Sharpen" authorName="Teodor Lindqvist" authorHref="/authors/teodor-lindqvist" avatar={[<Avatar key="a" src="/a.webp" alt="Avatar" />]} date="Mar 18, 2026" bodyLength={5000} src="/c.webp" alt="Cover" caption="Stone" />);
    expect(html).toContain("5 min read");
    expect(html).toContain('href="/authors/teodor-lindqvist"');
    expect(html).toContain('<img class="size-blog-avatar-sm rounded-blog-avatar object-cover" src="/a.webp" alt="Avatar"/>');
    expect(html).toContain("<figcaption");
    expect(render(<Avatar />)).toBe("");
    expect(readingMinutes(1100)).toBe(1);
    expect(readingMinutes(1101)).toBe(2);
    expect(readingMinutes(0)).toBe(0);
  });

  it("renders the tag list, skipping empty tags", () => {
    const html = render(<TagList tag1="craft" tag2="" tag3="tools" basePath="/" />);
    expect(html).toContain('href="/craft"');
    expect(html).toContain('href="/tools"');
    expect(html.match(/<li>/g)).toHaveLength(2);
    expect(render(<TagList />)).toBe("");
  });

  it("renders both author card variants", () => {
    expect(render(<AuthorCard name="Mina Okafor" href="/authors/mina-okafor" bio="Writes." src="/m.webp" alt="Avatar" />)).toContain('href="/authors/mina-okafor"');
    expect(render(<AuthorCard variant="hero" name="Mina Okafor" />)).toContain("<h1");
    expect(render(<AuthorGrid authors={[<AuthorCard key="m" name="Mina" />]} />)).toContain("Mina");
  });

  it("renders related articles and article lists around their cards", () => {
    expect(render(<RelatedArticles heading="Keep reading" articles={[<ArticleCard key="a" title="One" />]} />)).toContain("One");
    const list = render(<ArticleList chips columns="3" articles={[<ArticleCard key="a" title="One" tag1="craft" />]} />);
    expect(list).toContain("blog-lg:grid-cols-3");
    expect(list).toContain('aria-pressed="true"');
    expect(list).toContain(">All</button>");
  });

  it("renders comments and the comment list", () => {
    const html = render(<CommentList comments={[<Comment key="c" name="Ana" date="Mar 5, 2026" body="Useful." />]} />);
    expect(html).toContain("Ana");
    expect(html).toContain("Useful.");
  });

  it("renders the mock forms with the demo note and a square primary button", () => {
    const form = render(<CommentForm />);
    expect(form).toContain("Demo — no data is sent.");
    expect(form).toContain("bg-blog-fg-strong");
    expect(form).toContain("hover:bg-blog-accent-strong");
    expect(render(<Newsletter heading="The Sunday note" />)).toContain("The Sunday note");
  });
});

describe("prose body", () => {
  const source = [
    "Opening paragraph with a [link](/about) and `code`.",
    "",
    "## A heading",
    "",
    "- one",
    "- two",
    "",
    "1. first",
    "",
    "> quoted **text**",
    "",
    "```",
    "<b>raw</b>",
    "```",
    "",
    "---",
    "",
    '![A whetstone](/uploaded-assets/asset-1 "The stone")',
    "",
    "[bad](javascript:alert(1)) *em*",
  ].join("\n");

  it("parses the supported blocks", () => {
    expect(parseMarkdown(source).map((block) => block.kind)).toEqual(["paragraph", "heading", "list", "list", "quote", "code", "rule", "image", "paragraph"]);
  });

  it("renders markdown to escaped vnodes with a drop cap on the first paragraph", () => {
    const html = render(<ProseBody markdown={source} dropCap />);
    expect(html).toContain("max-w-blog-measure");
    expect(html.match(/first-letter:text-blog-accent/g)).toHaveLength(1);
    expect(html).toContain('<a class="text-blog-link underline');
    expect(html).toContain("<h2");
    expect(html).toContain("<ol");
    expect(html).toContain("<blockquote");
    expect(html).toContain("&lt;b>raw&lt;/b>");
    expect(html).toContain("<figcaption");
    expect(html).toContain("The stone");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("<em>em</em>");
  });
});
