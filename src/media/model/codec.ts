import { MEDIA_SCHEMA_VERSION } from "./types";
import type { MediaRecord } from "./types";
import { validateMediaRecord } from "./validate";
import type { MediaValidationIssue } from "./validate";

export type MediaBytesMissingReason = "missing" | "checksum-mismatch";

export type MediaLoadOutcome<T = MediaRecord> =
  | { status: "loaded"; record: T }
  | { status: "not-found"; id: string }
  | { status: "invalid"; issue: MediaValidationIssue; raw: unknown }
  | { status: "future-schema"; foundSchemaVersion: number; raw: unknown }
  | { status: "bytes-missing"; record: T; reason?: MediaBytesMissingReason };

/** Classify one untrusted stored record while preserving raw invalid values. */
export function loadMediaRecord(raw: unknown): MediaLoadOutcome {
  const validation = validateMediaRecord(raw);
  if (validation.ok) return { status: "loaded", record: validation.value };
  if (validation.issue.code === "future-schema") {
    return {
      status: "future-schema",
      foundSchemaVersion: validation.issue.foundSchemaVersion ?? MEDIA_SCHEMA_VERSION + 1,
      raw,
    };
  }
  return { status: "invalid", issue: validation.issue, raw };
}

/** Decode alias for providers that use decoder terminology. */
export const decodeMediaRecord = loadMediaRecord;
