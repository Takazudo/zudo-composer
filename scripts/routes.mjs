// @ts-check
import { HOSTED_SITE_ROUTES } from "../packages/demo-studio/hosted-routes.mjs";

/** @type {string[]} */
export const AUTHORING_ROUTES = ["/", "/composer", "/composer/preview", "/content", "/mapping", "/sitemapper", "/assets"];
// Adapter for the existing hosted Composer production target only. Site routes
// are Sample Studio deployment data, not part of the installed tool contract.
/** @type {string[]} */
export const SPA_ROUTES = [...AUTHORING_ROUTES, ...HOSTED_SITE_ROUTES];
