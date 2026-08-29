import { isJsonSafe, isPlainObject } from "../../shared/json";
import { decodeCompositionDocument } from "../model/codec";
import {
  RECORD_ID_PATTERN as COMPOSITION_RECORD_ID_PATTERN,
  isSafeRecordId as isSafeCompositionRecordId,
} from "../../shared/record-identity";
import { isStructurallyValidDocument } from "../model/validate";
import type {
  CompositionLoadOutcome,
  CompositionRecord,
  CompositionRecordValidation,
  CompositionRecordValidationIssue,
} from "./types";

export { COMPOSITION_RECORD_ID_PATTERN, isSafeCompositionRecordId };

/** Canonical UTC ISO instant emitted by `Date#toISOString`. */
export function isValidCompositionTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function issue(
  code: CompositionRecordValidationIssue["code"],
  message: string,
  foundSchemaVersion?: number,
): CompositionRecordValidation {
  return { ok: false, issue: { code, message, ...(foundSchemaVersion === undefined ? {} : { foundSchemaVersion }) } };
}

/** Strict provider-boundary validation over the shared document validator. */
export function validateCompositionRecord(value: unknown): CompositionRecordValidation {
  if (!isPlainObject(value)) {
    return issue("invalid-record", "Composition record must be a plain object.");
  }

  if (!isJsonSafe(value)) {
    return issue("not-json-safe", "Composition record contains data that is not JSON-safe.");
  }

  const raw = value as Record<string, unknown>;
  const expectedKeys = ["id", "createdAt", "updatedAt", "document"];
  if (
    !expectedKeys.every((key) => Object.hasOwn(raw, key))
    || Object.keys(raw).some((key) => !expectedKeys.includes(key))
  ) {
    return issue("invalid-record", "Composition record must contain exactly id, createdAt, updatedAt, and document.");
  }
  if (!isSafeCompositionRecordId(raw.id)) {
    return issue("unsafe-id", "Composition record id is not a stable path-safe id.");
  }

  if (!isValidCompositionTimestamp(raw.createdAt)) {
    return issue("invalid-created-at", "Composition record createdAt must be a canonical ISO timestamp.");
  }
  if (!isValidCompositionTimestamp(raw.updatedAt)) {
    return issue("invalid-updated-at", "Composition record updatedAt must be a canonical ISO timestamp.");
  }
  if (raw.updatedAt < raw.createdAt) {
    return issue("invalid-timestamp-order", "Composition record updatedAt cannot precede createdAt.");
  }

  if (!isPlainObject(raw.document)) {
    return issue("malformed-document", "Composition record document must be a plain object.");
  }

  const decoded = decodeCompositionDocument(raw.document);
  if (decoded.status === "future-schema") {
    return issue(
      "future-schema",
      `Composition document schema ${decoded.foundSchemaVersion} is newer than the supported schema.`,
      decoded.foundSchemaVersion,
    );
  }

  if (decoded.status === "malformed" || !isStructurallyValidDocument(decoded.document)) {
    return issue("malformed-document", "Composition document is malformed or uses an unsupported schema.");
  }
  if (decoded.document.id !== raw.id) {
    return issue(
      "record-document-id-mismatch",
      "Composition record id must match its document id.",
    );
  }

  return {
    ok: true,
    record: {
      id: raw.id,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
      document: decoded.document,
    } as CompositionRecord,
  };
}

/** Classifies unknown provider data without mutating or discarding the source. */
export function loadCompositionRecord(value: unknown): CompositionLoadOutcome {
  const result = validateCompositionRecord(value);
  if (result.ok) {
    return { status: "loaded", record: result.record };
  }
  if (result.issue.code === "future-schema") {
    return {
      status: "future-schema",
      foundSchemaVersion: result.issue.foundSchemaVersion!,
      raw: value,
    };
  }
  return { status: "invalid", issue: result.issue, raw: value };
}
