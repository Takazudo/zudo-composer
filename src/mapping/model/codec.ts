import { MAPPING_SCHEMA_VERSION } from "./types";
import type { MappingLoadOutcome } from "./types";
import { validateMappingRecord } from "./validate";

export function decodeMappingRecord(raw: unknown): MappingLoadOutcome {
  const result = validateMappingRecord(raw);
  if (result.ok) return { status: "loaded", record: result.record };
  if (result.issue.code === "future-schema") return { status: "future-schema", foundSchemaVersion: result.issue.foundSchemaVersion ?? MAPPING_SCHEMA_VERSION + 1, raw };
  return { status: "invalid", issue: result.issue, raw };
}
