// Sitemap schema codec — version dispatch deliberately separate from validation.
//
// Dispatch examines schemaVersion only so callers can distinguish malformed
// current data from a future schema without changing its raw representation.

import { isPlainObject } from "../../shared";
import { SITEMAP_SCHEMA_VERSION } from "./types";
import type { SitemapDocument } from "./types";

export type SitemapDocumentDecodeOutcome =
  | { status: "current"; document: unknown }
  | { status: "future-schema"; foundSchemaVersion: number }
  | { status: "malformed" };

/** Dispatch an untrusted value by integer schemaVersion only. */
export function decodeSitemapDocument(value: unknown): SitemapDocumentDecodeOutcome {
  if (!isPlainObject(value)) return { status: "malformed" };
  const schemaVersion = value.schemaVersion;
  if (typeof schemaVersion !== "number" || !Number.isInteger(schemaVersion)) {
    return { status: "malformed" };
  }
  if (schemaVersion === SITEMAP_SCHEMA_VERSION) {
    return { status: "current", document: value };
  }
  if (schemaVersion > SITEMAP_SCHEMA_VERSION) {
    return { status: "future-schema", foundSchemaVersion: schemaVersion };
  }
  return { status: "malformed" };
}

/** Encode a current document without changing its persisted shape. */
export function encodeSitemapDocument(document: SitemapDocument): string {
  return JSON.stringify(document);
}
