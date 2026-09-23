import { createElement, type ComponentChildren, type ComponentType } from "preact";
import { useLayoutEffect, useState } from "preact/hooks";
import type { StoryMeta } from "@takazudo/zudo-sg/stories";
import {
  ArticleCard, ArticleHeader, ArticleList, AuthorCard, AuthorGrid, Avatar, Callout,
  Comment, CommentForm, CommentList, Container, DemoNote, Footer, Header, HomeHero,
  NavLink, Newsletter, PageHeading, ProseBody, RelatedArticles, Section,
  SectionHeading, Stack, TagList, componentPack,
} from "../src/generated/blog-pack";
import { articles, authors, comments, type Article } from "../src/generated/content";

/** Only the preview iframe's history changes. The catalog keeps its own URL and navigation. */
function FixtureRoute({ path, children }: { path: string; children: ComponentChildren }) {
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    if (window.parent === window) throw new Error("Blog fixture routes require an isolated preview iframe");
    const original = location.href;
    const preview = new URL(original);
    const fixture = new URL(path, preview.origin);
    // Keep slug and variant so zudo-sg can still identify this iframe's story.
    fixture.search = preview.search;
    history.replaceState(history.state, "", fixture);
    setReady(true);
    return () => history.replaceState(history.state, "", original);
  }, [path]);
  return ready ? <div data-blog-fixture-path={path}>{children}</div> : null;
}

const first = articles.find((article) => article.slug === "the-half-finished-list")!;
const draft = articles.find((article) => article.slug === "why-drafts-should-look-unfinished")!;
const mina = authors.find((author) => author.slug === "mina-okafor")!;
const teodor = authors.find((author) => author.slug === "teodor-lindqvist")!;

const card = (article: Article) => <ArticleCard key={article.slug} title={article.title}
  href={`/articles/${article.slug}`} intro={article.intro} date={article.date}
  src={article.cover} alt={article.coverAlt} tag1={article.tag1} tag2={article.tag2}
  tag3={article.tag3} authorSlug={article.authorSlug} slug={article.slug} />;
const cards = () => articles.map(card);
const author = (person: typeof mina, variant: "inline" | "hero" = "inline") =>
  <AuthorCard name={person.name} href={`/authors/${person.slug}`} bio={person.bio}
    src={person.src} alt={person.alt} variant={variant} />;
const commentItems = () => comments.map((entry, index) => <Comment key={index}
  name={entry.name} date={entry.date} body={entry.body} articleSlug={entry.articleSlug} />);
const nav = () => <><NavLink label="Articles" href="/articles" /><NavLink label="Authors" href="/authors" /><NavLink label="About" href="/about" /></>;
export function routeArticleList(mode: "by-route-author" | "exclude-route") {
  const path = mode === "by-route-author" ? "/authors/mina-okafor" : "/articles/the-half-finished-list";
  return <FixtureRoute path={path}><ArticleList mode={mode} columns="2" articles={cards()} /></FixtureRoute>;
}

interface Definition {
  id: string; title: string; category: string; description: string;
  defaults: Record<string, unknown>; source: { exportName: string };
  component: ComponentType<Record<string, unknown>>;
}
const definitions = componentPack.manifest.components.map((entry) => ({
  ...entry,
  component: componentPack.runtime.components[entry.id]?.component,
})) as unknown as Definition[];
function definition(id: string): Definition {
  const entry = definitions.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`Missing Blog pack component: ${id}`);
  return entry;
}
export function storyMeta(id: string): StoryMeta {
  const entry = definition(id);
  return { title: entry.title, category: entry.category, description: entry.description,
    usage: `import { ${entry.source.exportName} } from "demo-blog/components";\n\nconst props = ${JSON.stringify(entry.defaults, null, 2)};\n<${entry.source.exportName} {...props} />`,
  };
}
export function packDefaults(id: string): ComponentChildren {
  const entry = definition(id);
  return createElement(entry.component, { ...entry.defaults });
}
export function showcase(id: string, example: boolean): ComponentChildren {
  const entry = definition(id);
  const render = (props: Record<string, unknown> = {}) => createElement(entry.component, { ...entry.defaults, ...props });
  switch (id) {
    case "blog.header": return <FixtureRoute path="/articles/the-half-finished-list"><Header nav={[nav()]} /></FixtureRoute>;
    case "blog.nav-link": return <FixtureRoute path="/articles/the-half-finished-list"><Header nav={[nav()]} /></FixtureRoute>;
    case "blog.footer": return <Footer smallPrint="Margin Notes is a journal about working with attention." nav={[nav()]} />;
    case "blog.container": return <Container width={example ? "measure" : "page"} content={[<PageHeading eyebrow="Journal" heading="A reading measure" intro="The page and measure widths hold different kinds of content." />]} />;
    case "blog.stack": return <Stack gap={example ? "lg" : "sm"} content={[<SectionHeading eyebrow="From the journal" heading="Recent notes" />, <ProseBody markdown={first.body.slice(0, 570)} />]} />;
    case "blog.section": return <Section rule={example} content={[<Container content={[<SectionHeading eyebrow="Essays" heading="Keep reading" />]} />]} />;
    case "blog.section-heading": return <SectionHeading eyebrow={example ? "From the archive" : "Essays"} heading={example ? "Notes worth returning to" : "Keep reading"} as={example ? "h3" : "h2"} />;
    case "blog.page-heading": return <PageHeading eyebrow="Margin Notes" heading={example ? "Writing with attention" : "All articles"} intro="Essays on craft, focus, and the tools that hold up." />;
    case "blog.home-hero": return <HomeHero heading="Notes from the margin" lead="Short essays on craft, focus, and the tools that hold up." linkLabel="About the journal" linkHref="/about" />;
    case "blog.callout": return <Callout title={example ? "A note on rough drafts" : "From the editor"} markdown={example ? "A useful first draft leaves room for questions. **Finish follows clarity.**" : "Read slowly. Keep the marks you made along the way."} tone={example ? "surface" : "soft"} />;
    case "blog.demo-note": return <DemoNote text="This catalog's comments and newsletter are local demonstrations. Nothing is sent." />;
    case "blog.article-list": return example ? routeArticleList("by-route-author") : <FixtureRoute path="/articles"><ArticleList chips columns="2" articles={cards()} /></FixtureRoute>;
    case "blog.article-card": return card(example ? draft : first);
    case "blog.article-header": return <ArticleHeader eyebrow={example ? "Craft" : "Attention"} title={example ? draft.title : first.title} intro={example ? draft.intro : first.intro} authorName={example ? draft.authorName : first.authorName} authorHref={`/authors/${example ? draft.authorSlug : first.authorSlug}`} date={example ? draft.date : first.date} bodyLength={example ? draft.bodyLength : first.bodyLength} src={example ? draft.cover : first.cover} alt={example ? draft.coverAlt : first.coverAlt} caption={example ? draft.caption : first.caption} avatar={<Avatar src={example ? draft.authorAvatar : first.authorAvatar} alt={example ? draft.authorAvatarAlt : first.authorAvatarAlt} />} />;
    case "blog.avatar": return <Avatar src={example ? teodor.src : mina.src} alt={example ? teodor.alt : mina.alt} />;
    case "blog.prose-body": return <ProseBody markdown={example ? draft.body : first.body} dropCap={example} />;
    case "blog.tag-list": return <TagList tag1="craft" tag2="attention" tag3={example ? "tools" : ""} basePath="/tags" />;
    case "blog.author-card": return author(example ? teodor : mina, example ? "hero" : "inline");
    case "blog.author-grid": return <AuthorGrid authors={[author(mina), author(teodor)]} />;
    case "blog.related-articles": return <FixtureRoute path="/articles/the-half-finished-list"><RelatedArticles heading="Read next" limit={example ? 2 : 3} articles={cards()} /></FixtureRoute>;
    case "blog.comment-list": return <FixtureRoute path="/articles/the-half-finished-list"><CommentList comments={commentItems()} /></FixtureRoute>;
    case "blog.comment": return <Comment name={example ? "Joel P." : "Hana"} date="Mar 7, 2026" body={example ? "Rewriting leftovers by hand is the part I'll steal." : "A small change made my list much easier to understand."} articleSlug={first.slug} />;
    case "blog.comment-form": return <FixtureRoute path="/articles/the-half-finished-list"><><CommentList comments={commentItems()} /><CommentForm /></></FixtureRoute>;
    case "blog.newsletter": return <Newsletter heading="The Sunday note" lead="One short letter a week, nothing else. Try a malformed address to see validation." />;
    default: return render();
  }
}
