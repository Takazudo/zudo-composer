import { isJsonSafe, isPlainObject, isSafeRecordId } from "../../shared";
import { decodeSitemapDocument, isStructurallyValidDocument } from "../model";
import type {
  SitemapRecordLoadOutcome,
  SitemapRecord,
  SitemapRecordValidation,
  SitemapRecordValidationIssue,
} from "./types";

const RECORD_KEYS = ["id", "createdAt", "updatedAt", "document"] as const;

export function isValidSitemapTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}
function issue(
  code: SitemapRecordValidationIssue["code"],
  message: string,
  foundSchemaVersion?: number,
): SitemapRecordValidation {
  return {
    ok: false,
    issue: { code, message, ...(foundSchemaVersion === undefined ? {} : { foundSchemaVersion }) },
  };
}

/** Strict validation for values crossing a persistence boundary. */
export function validateSitemapRecord(value: unknown): SitemapRecordValidation {
  if (!isPlainObject(value)) return issue("invalid-record", "Sitemap record must be a plain object.");
  if (
    Object.keys(value).length !== RECORD_KEYS.length
    || !RECORD_KEYS.every((key) => Object.hasOwn(value, key))
  ) {
    return issue("invalid-record-keys", "Sitemap record must contain exactly its canonical envelope fields.");
  }
  if (!isJsonSafe(value)) return issue("not-json-safe", "Sitemap record contains data that is not JSON-safe.");
  if (!isSafeRecordId(value.id)) return issue("unsafe-id", "Sitemap record id is not a path-safe id.");
  if (!isValidSitemapTimestamp(value.createdAt)) {
    return issue("invalid-created-at", "Sitemap record createdAt must be a canonical ISO timestamp.");
  }
  if (!isValidSitemapTimestamp(value.updatedAt)) {
    return issue("invalid-updated-at", "Sitemap record updatedAt must be a canonical ISO timestamp.");
  }
  if (value.updatedAt < value.createdAt) {
    return issue("invalid-timestamp-order", "Sitemap record updatedAt cannot precede createdAt.");
  }

  const decoded = decodeSitemapDocument(value.document);
  if (decoded.status === "future-schema") {
    return issue(
      "future-schema",
      `Sitemap document schema ${decoded.foundSchemaVersion} is newer than the supported schema.`,
      decoded.foundSchemaVersion,
    );
  }
  if (decoded.status === "malformed") {
    return issue("malformed-document", "Sitemap document is malformed or uses an unsupported schema.");
  }
  const document = isStructurallyValidDocument(decoded.document);
  if (!document.ok) {
    return issue("malformed-document", `Sitemap document is malformed at ${document.path}.`);
  }
  if (document.document.id !== value.id) {
    return issue("record-document-id-mismatch", "Sitemap record id must match its document id.");
  }
  return { ok: true, record: { ...value, document: document.document } as SitemapRecord };
}

/** Classify unknown provider data without mutating or discarding it. */
export function loadSitemapRecord(value: unknown): SitemapRecordLoadOutcome {
  const validation = validateSitemapRecord(value);
  if (validation.ok) return { status: "loaded", record: validation.record };
  if (validation.issue.code === "future-schema") {
    return {
      status: "future-schema",
      foundSchemaVersion: validation.issue.foundSchemaVersion!,
      raw: value,
    };
  }
  return { status: "invalid", issue: validation.issue, raw: value };
}
