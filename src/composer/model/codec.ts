// Current-schema classification for persisted Composition documents.

import { isPlainObject } from "../../shared/json";
import { COMPOSITION_SCHEMA_VERSION } from "./types";

export type CompositionDocumentDecodeOutcome =
  | { status: "current"; document: unknown }
  | { status: "future-schema"; foundSchemaVersion: number }
  | { status: "malformed" };

/**
 * Classify one untrusted persisted value without mutating or upgrading it.
 * Only the current schema is accepted; older prototypes are malformed.
 */
export function decodeCompositionDocument(value: unknown): CompositionDocumentDecodeOutcome {
  if (!isPlainObject(value)) return { status: "malformed" };

  const schemaVersion = value.schemaVersion;
  if (typeof schemaVersion !== "number" || !Number.isInteger(schemaVersion)) {
    return { status: "malformed" };
  }
  if (schemaVersion === COMPOSITION_SCHEMA_VERSION) {
    return { status: "current", document: value };
  }
  if (schemaVersion > COMPOSITION_SCHEMA_VERSION) {
    return { status: "future-schema", foundSchemaVersion: schemaVersion };
  }
  return { status: "malformed" };
}
