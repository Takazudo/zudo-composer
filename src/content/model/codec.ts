import { validateContentEntryRecord, validateContentModelRecord } from "./validate";
import type { ContentEntryRecord, ContentModelRecord } from "./types";
import type { ContentValidationIssue } from "./validate";

export type ContentLoadOutcome<T> =
  | { status: "loaded"; record: T }
  | { status: "not-found"; id: string }
  | { status: "invalid"; issue: ContentValidationIssue; raw: unknown }
  | { status: "future-schema"; foundSchemaVersion: number; raw: unknown };

function outcome<T>(raw: unknown, validation: ReturnType<typeof validateContentModelRecord> | ReturnType<typeof validateContentEntryRecord>): ContentLoadOutcome<T> {
  if (validation.ok) return { status: "loaded", record: validation.value as T };
  if (validation.issue.code === "future-schema") return { status: "future-schema", foundSchemaVersion: validation.issue.foundSchemaVersion!, raw };
  return { status: "invalid", issue: validation.issue, raw };
}

export function loadContentModelRecord(raw: unknown): ContentLoadOutcome<ContentModelRecord> {
  return outcome(raw, validateContentModelRecord(raw));
}

export function loadContentEntryRecord(raw: unknown): ContentLoadOutcome<ContentEntryRecord> {
  return outcome(raw, validateContentEntryRecord(raw));
}
