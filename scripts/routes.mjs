export const AUTHORING_ROUTES = ["/", "/composer", "/composer/preview", "/content", "/mapping", "/sitemapper", "/media"];
/** The checked-in sample compiler currently emits one root and six nested site routes. */
export const SITE_ROUTES = [
  "/site",
  "/site/about",
  "/site/services",
  "/site/journal",
  "/site/journal/map-the-moving-parts",
  "/site/journal/review-in-small-loops",
  "/site/journal/start-with-the-question",
];
export const SPA_ROUTES = [...AUTHORING_ROUTES, ...SITE_ROUTES];
