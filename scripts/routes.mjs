// @ts-check
import assert from "node:assert/strict";

/** @type {string[]} */
export const AUTHORING_ROUTES = ["/", "/composer", "/composer/preview", "/content", "/mapping", "/sitemapper", "/assets"];
export const DEMO_EDITOR_AUTHORING_ROUTES = [...AUTHORING_ROUTES, "/review", "/website-preview"];

/** @param {readonly string[]} routes */
export function demoEditorRoutes(routes) {
  const result = [...DEMO_EDITOR_AUTHORING_ROUTES, ...routes.map((pathname) => pathname === "/" ? "/site" : `/site${pathname}`)];
  assertDemoEditorRoutes(result);
  return result;
}

/** @param {unknown} routes @returns {asserts routes is string[]} */
export function assertDemoEditorRoutes(routes) {
  assert.ok(Array.isArray(routes), "Demo editor routes must be an array");
  assert.equal(new Set(routes).size, routes.length, "Demo editor routes must be unique");
  for (const pathname of routes) {
    assert.ok(typeof pathname === "string" && pathname.startsWith("/") && !/[\\?#\s]/u.test(pathname)
      && !pathname.includes("//") && new URL(pathname, "https://editor.invalid").pathname === pathname, `Invalid demo editor route: ${pathname}`);
    assert.ok(DEMO_EDITOR_AUTHORING_ROUTES.includes(pathname) || pathname === "/site" || pathname.startsWith("/site/"), `Unexpected demo editor route: ${pathname}`);
  }
  for (const pathname of DEMO_EDITOR_AUTHORING_ROUTES) assert.ok(routes.includes(pathname), `Demo editor route is missing: ${pathname}`);
}

/** Called only with a manifest returned by the artifact verifier.
 * @param {Record<string, unknown>} manifest @returns {string[]} */
export function verifiedDemoEditorRoutes(manifest) {
  assertDemoEditorRoutes(manifest.routes);
  return [...manifest.routes];
}
