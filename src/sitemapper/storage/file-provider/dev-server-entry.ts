// Loaded only by the active Vite development server. Keeping this Node-side
// import behind `ssrLoadModule` prevents filesystem modules entering clients.
//
// The plugin graph cannot use `instanceof`, so the domain-error predicate is
// exported from here rather than reimplemented as a duck-type check.
import { SitemapPersistenceError } from "../../library";

export { createFilesystemSitemapStore } from "../filesystem";
export { SITEMAP_FILE_PROVIDER_OPERATIONS } from "./types";

export function isSitemapPersistenceError(value: unknown): boolean {
  return value instanceof SitemapPersistenceError;
}
