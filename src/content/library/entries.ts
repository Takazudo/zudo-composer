// Entry semantics shared by every Content provider: the keyset cursor format
// and the entry-against-model check.
//
// Both live here rather than in one provider because they are properties of the
// Content model, not of a storage engine. A provider that re-derived them would
// be free to page in a different order or accept a value its sibling rejects,
// and the difference would only surface as a user-visible inconsistency.

import { isSafeRecordId } from "../../shared";
import { isValueValidForField } from "../model";
import type { ContentEntryRecord, ContentModelRecord } from "../model";
import { ContentPersistenceError } from "./types";
import type { ContentPersistenceOperation } from "./types";

const CURSOR_PREFIX = "content-entry-v1:";

export interface ContentEntryCursor { createdAt: string; id: string }

export function encodeContentEntryCursor(entry: ContentEntryRecord): string {
  return `${CURSOR_PREFIX}${encodeURIComponent(entry.createdAt)}:${encodeURIComponent(entry.id)}`;
}

function invalidCursor(cause?: unknown): ContentPersistenceError {
  return new ContentPersistenceError("page-entries", "invalid-cursor", "Entry cursor is invalid.", false, { cause });
}

export function decodeContentEntryCursor(value: string | undefined): ContentEntryCursor | undefined {
  if (value === undefined) return undefined;
  if (!value.startsWith(CURSOR_PREFIX)) throw invalidCursor();
  const parts = value.slice(CURSOR_PREFIX.length).split(":");
  if (parts.length !== 2) throw invalidCursor();
  try {
    const [createdAt, id] = parts.map(decodeURIComponent);
    if (!createdAt || !isSafeRecordId(id) || new Date(createdAt).toISOString() !== createdAt) throw new Error("invalid");
    return { createdAt, id };
  } catch (error) {
    throw invalidCursor(error);
  }
}

/**
 * Newest first, with the id breaking a shared `createdAt`. This is the total
 * order the cursor walks, so two entries created in the same millisecond still
 * have one stable position relative to each other across page boundaries.
 *
 * It compares code units rather than reusing `compareContentEntriesNewestFirst`,
 * which sorts with `localeCompare`. A cursor is a "strictly older than" test on
 * the raw strings, so a locale-aware sort could order two entries differently
 * from the cursor that walks past them and silently skip or repeat one.
 */
export function compareContentEntriesForPaging(a: ContentEntryRecord, b: ContentEntryRecord): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** True when the entry sorts strictly after the cursor in the paging order. */
export function isAfterContentEntryCursor(entry: ContentEntryRecord, cursor: ContentEntryCursor | undefined): boolean {
  if (cursor === undefined) return true;
  return entry.createdAt < cursor.createdAt || (entry.createdAt === cursor.createdAt && entry.id < cursor.id);
}

/** Undefined when the entry is a legitimate instance of the model. */
export function contentEntrySemanticIssue(
  entry: ContentEntryRecord,
  model: ContentModelRecord,
): string | undefined {
  if (entry.modelId !== model.id) return `Entry refers to missing model "${entry.modelId}".`;
  const fields = new Map(model.document.fields.map((field) => [field.id, field]));
  for (const [fieldId, value] of Object.entries(entry.values)) {
    const field = fields.get(fieldId);
    if (!field) return `Entry value refers to unknown field "${fieldId}".`;
    if (!isValueValidForField(field, value)) return `Entry value for field "${field.key}" does not match ${field.kind}.`;
  }
  return undefined;
}

export function assertContentEntryMatchesModel(
  entry: ContentEntryRecord,
  model: ContentModelRecord,
  operation: ContentPersistenceOperation,
): void {
  const issue = contentEntrySemanticIssue(entry, model);
  if (issue) throw new ContentPersistenceError(operation, "validation", issue, false);
}
