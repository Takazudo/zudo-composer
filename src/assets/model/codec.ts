import { ASSET_SCHEMA_VERSION } from "./types";
import type { AssetRecord } from "./types";
import { validateAssetRecord } from "./validate";
import type { AssetValidationIssue } from "./validate";

export type AssetBytesMissingReason = "missing" | "checksum-mismatch";

export type AssetLoadOutcome<T = AssetRecord> =
  | { status: "loaded"; record: T }
  | { status: "not-found"; id: string }
  | { status: "invalid"; issue: AssetValidationIssue; raw: unknown }
  | { status: "future-schema"; foundSchemaVersion: number; raw: unknown }
  | { status: "bytes-missing"; record: T; reason?: AssetBytesMissingReason };

/** Classify one untrusted stored record while preserving raw invalid values. */
export function loadAssetRecord(raw: unknown): AssetLoadOutcome {
  const validation = validateAssetRecord(raw);
  if (validation.ok) return { status: "loaded", record: validation.value };
  if (validation.issue.code === "future-schema") {
    return {
      status: "future-schema",
      foundSchemaVersion: validation.issue.foundSchemaVersion ?? ASSET_SCHEMA_VERSION + 1,
      raw,
    };
  }
  return { status: "invalid", issue: validation.issue, raw };
}

/** Decode alias for providers that use decoder terminology. */
export const decodeAssetRecord = loadAssetRecord;
