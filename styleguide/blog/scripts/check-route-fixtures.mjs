import { h } from "preact";
import render from "preact-render-to-string";
import { ArticleCard, ArticleList, Comment, CommentList, Header, NavLink } from "../src/generated/blog-pack.js";
import { articles, comments } from "../src/generated/content.js";

const setLocation = (pathname, search = "") => { globalThis.location = { pathname, search }; };
const cards = () => articles.map((article) => h(ArticleCard, {
  title: article.title, authorSlug: article.authorSlug, slug: article.slug,
  tag1: article.tag1, tag2: article.tag2, tag3: article.tag3,
}));
const visibleArticles = (html) => [...html.matchAll(/<article\b([^>]*)>([\s\S]*?)<\/article>/g)]
  .filter(([, attributes]) => !/\bhidden\b/.test(attributes))
  .map(([, , content]) => content.replace(/<[^>]+>/g, "").trim());
const list = (mode, chips = false) => visibleArticles(render(h(ArticleList, { mode, chips, articles: cards() })));
const assert = (condition, message) => { if (!condition) throw new Error(message); };

setLocation("/authors/mina-okafor");
const byAuthor = list("by-route-author");
assert(byAuthor.length === articles.filter((article) => article.authorSlug === "mina-okafor").length &&
  byAuthor.some((title) => title.includes("The half-finished list")), "Author route filtered out real Mina articles");

setLocation("/articles/the-half-finished-list");
const excluded = list("exclude-route");
assert(excluded.length === articles.length - 1 && !excluded.some((title) => title.includes("The half-finished list")) &&
  excluded.some((title) => title.includes("Why drafts should look unfinished")), "Related route did not exclude the current article");

setLocation("/articles", "?tag=craft");
const tagged = list("all", true);
assert(tagged.length === articles.filter((article) => [article.tag1, article.tag2, article.tag3].includes("craft")).length &&
  tagged.some((title) => title.includes("Why drafts should look unfinished")), "Tag query did not filter real articles");

setLocation("/articles/the-half-finished-list");
const commentHtml = render(h(CommentList, { comments: comments.map((entry) => h(Comment, entry)) }));
const visibleComments = [...commentHtml.matchAll(/<li\b([^>]*)>([\s\S]*?)<\/li>/g)]
  .filter(([, attributes]) => !/\bhidden\b/.test(attributes));
assert(visibleComments.length === 2 && visibleComments.some(([, , content]) => content.includes("Hana")),
  "Article route did not display the matching authored comments");

const header = render(h(Header, { nav: [h(NavLink, { label: "Articles", href: "/articles" }), h(NavLink, { label: "Authors", href: "/authors" })] }));
assert(/aria-current="page"[^>]*>Articles<\/a>/.test(header) && !/aria-current="page"[^>]*>Authors<\/a>/.test(header),
  "Article URL did not mark only the current catalog nav item");
console.log("Blog route fixtures: author, exclusion, tag, comments, and current nav render real matching content");
