// @ts-check

/** @type {string[]} */
export const AUTHORING_ROUTES = ["/", "/composer", "/composer/preview", "/content", "/mapping", "/sitemapper", "/assets"];
/** The checked-in sample compiler currently emits one root and six nested site routes. */
/** @type {string[]} */
export const SITE_ROUTES = [
  "/site",
  "/site/about",
  "/site/services",
  "/site/journal",
  "/site/journal/map-the-moving-parts",
  "/site/journal/review-in-small-loops",
  "/site/journal/start-with-the-question",
];
/** @type {string[]} */
export const SPA_ROUTES = [...AUTHORING_ROUTES, ...SITE_ROUTES];
