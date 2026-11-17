import { expect, it } from "vitest";
import { selectHostDocumentRoute } from "../route-selection";
const active = { providerId: "sitemaps-filesystem", recordId: "main" };
const home = { pathname: "/", sitemapNode: { id: "home" } }, lessons = { pathname: "/lessons", sitemapNode: { id: "lessons" } };
const routes = [home, lessons, { pathname: "/notes/a", sitemapNode: { id: "notes" } }, { pathname: "/notes/b", sitemapNode: { id: "notes" } }];
it("resolves an exact active qualified Sitemap/page/path tuple and retains bare navigation", () => {
  expect(selectHostDocumentRoute(routes, active, {})).toBe(home);
  expect(selectHostDocumentRoute(routes, active, { pathname: "/lessons/" })).toBe(lessons);
  expect(selectHostDocumentRoute(routes, active, { sitemapProviderId: active.providerId, sitemapId: "main", pageId: "lessons", pathname: "/lessons" })).toBe(lessons);
});
it("refuses inactive/foreign/stale and ambiguous handoffs without mutating route data", () => {
  const before = JSON.stringify(routes);
  for (const input of [
    { sitemapProviderId: "foreign", sitemapId: "main", pageId: "lessons", pathname: "/lessons" },
    { sitemapProviderId: active.providerId, sitemapId: "inactive", pageId: "lessons", pathname: "/lessons" },
    { sitemapProviderId: active.providerId, sitemapId: "main", pageId: "home", pathname: "/lessons" },
    { sitemapProviderId: active.providerId }, { sitemapId: "main" }, { pageId: "deleted" }, { pageId: "notes" },
  ]) expect(() => selectHostDocumentRoute(routes, active, input)).toThrow();
  expect(JSON.stringify(routes)).toBe(before);
  expect(selectHostDocumentRoute(routes, active, { sitemapProviderId: active.providerId, sitemapId: "main", pageId: "notes", pathname: "/notes/b" }).pathname).toBe("/notes/b");
});
