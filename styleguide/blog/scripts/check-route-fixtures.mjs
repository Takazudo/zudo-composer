import { JSDOM } from "jsdom";

// Route-aware cards, comments and nav links register with their host list when
// they activate, so the fixtures mount into a DOM instead of rendering to a string.
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://blog.fixture.test/" });
const { window } = dom;
for (const key of Object.getOwnPropertyNames(window)) {
  if (key in globalThis) continue;
  Object.defineProperty(globalThis, key, { configurable: true, get: () => window[key] });
}
for (const key of ["window", "document", "location", "history", "navigator", "localStorage", "Event", "CustomEvent"]) {
  Object.defineProperty(globalThis, key, { configurable: true, get: () => window[key] });
}

const { flush, h } = await import("@takazudo/zfb/zudo-react");
const { mount } = await import("@takazudo/zfb/zudo-react/client");
const { ArticleCard, ArticleList, Comment, CommentList, Header, NavLink } = await import("../src/generated/blog-pack.js");
const { articles, comments } = await import("../src/generated/content.js");

const identity = { component: "BlogRouteFixture", build: "zc-sg-blog-route-fixtures" };
const setLocation = (pathname, search = "") => { dom.reconfigure({ url: new URL(`${pathname}${search}`, window.location.origin).href }); };
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function render(child) {
  const host = document.createElement("div");
  host.setAttribute("data-zfb-island-skip-ssr", identity.component);
  host.setAttribute("data-zfb-transport", "json/1");
  host.setAttribute("data-zfb-protocol", "zudo-react/1");
  host.setAttribute("data-zfb-build", identity.build);
  document.body.append(host);
  const Root = Object.assign(() => child, { displayName: identity.component });
  const codes = [];
  const handle = mount(h(Root, null), host, { identity, report: (diagnostic) => codes.push(diagnostic.code) });
  assert(handle, `Route fixture mount refused (${codes.join(", ") || "no diagnostic"})`);
  await flush();
  assert(codes.length === 0, `Route fixture reported ${codes.join(", ")}`);
  const html = host.innerHTML;
  handle.unmount();
  host.remove();
  return html;
}

const cards = () => articles.map((article) => h(ArticleCard, {
  title: article.title, authorSlug: article.authorSlug, slug: article.slug,
  tag1: article.tag1, tag2: article.tag2, tag3: article.tag3,
}));
const visibleArticles = (html) => [...html.matchAll(/<article\b([^>]*)>([\s\S]*?)<\/article>/g)]
  .filter(([, attributes]) => !/\bhidden\b/.test(attributes))
  .map(([, , content]) => content.replace(/<[^>]+>/g, "").trim());
const list = async (mode, chips = false) => visibleArticles(await render(h(ArticleList, { mode, chips, articles: cards() })));

setLocation("/authors/mina-okafor");
const byAuthor = await list("by-route-author");
assert(byAuthor.length === articles.filter((article) => article.authorSlug === "mina-okafor").length &&
  byAuthor.some((title) => title.includes("The half-finished list")), "Author route filtered out real Mina articles");

setLocation("/articles/the-half-finished-list");
const excluded = await list("exclude-route");
assert(excluded.length === articles.length - 1 && !excluded.some((title) => title.includes("The half-finished list")) &&
  excluded.some((title) => title.includes("Why drafts should look unfinished")), "Related route did not exclude the current article");

setLocation("/articles", "?tag=craft");
const tagged = await list("all", true);
assert(tagged.length === articles.filter((article) => [article.tag1, article.tag2, article.tag3].includes("craft")).length &&
  tagged.some((title) => title.includes("Why drafts should look unfinished")), "Tag query did not filter real articles");

setLocation("/articles/the-half-finished-list");
const commentHtml = await render(h(CommentList, { comments: comments.map((entry) => h(Comment, entry)) }));
const visibleComments = [...commentHtml.matchAll(/<li\b([^>]*)>([\s\S]*?)<\/li>/g)]
  .filter(([, attributes]) => !/\bhidden\b/.test(attributes));
assert(visibleComments.length === 2 && visibleComments.some(([, , content]) => content.includes("Hana")),
  "Article route did not display the matching authored comments");

const header = await render(h(Header, { nav: [h(NavLink, { label: "Articles", href: "/articles" }), h(NavLink, { label: "Authors", href: "/authors" })] }));
assert(/aria-current="page"[^>]*>Articles<\/a>/.test(header) && !/aria-current="page"[^>]*>Authors<\/a>/.test(header),
  "Article URL did not mark only the current catalog nav item");
console.log("Blog route fixtures: author, exclusion, tag, comments, and current nav render real matching content");
