// Current-schema recovery + future-schema quarantine.

import type { CompositionDocument } from "./types";
import { cloneJson, isPlainObject } from "../../shared/json";
import { decodeCompositionDocument } from "./codec";
import { isStructurallyValidDocument } from "./validate";

export type LoadOutcome =
  | { status: "fresh"; document: CompositionDocument }
  | { status: "ok"; document: CompositionDocument }
  | { status: "recovered"; document: CompositionDocument; reason: string }
  | {
      status: "quarantined";
      document: CompositionDocument;
      quarantinedRaw: string;
      foundSchemaVersion: number;
    };

/** Load current persisted storage without rewriting corruption or future data. */
export function loadCompositionDocument(
  raw: string | null | undefined,
  sample: CompositionDocument,
): LoadOutcome {
  if (raw === null || raw === undefined || raw.trim() === "") {
    return { status: "fresh", document: cloneJson(sample) };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      status: "recovered",
      document: cloneJson(sample),
      reason: "Stored Composition is not valid JSON.",
    };
  }

  const decoded = decodeCompositionDocument(parsed);
  if (decoded.status === "future-schema") {
    return {
      status: "quarantined",
      document: cloneJson(sample),
      quarantinedRaw: raw,
      foundSchemaVersion: decoded.foundSchemaVersion,
    };
  }
  if (decoded.status === "malformed" || !isStructurallyValidDocument(decoded.document)) {
    return {
      status: "recovered",
      document: cloneJson(sample),
      reason:
        !isPlainObject(parsed) || typeof parsed.schemaVersion !== "number"
          ? "Stored Composition has no supported schemaVersion."
          : "Stored Composition is malformed under the current schema.",
    };
  }
  return { status: "ok", document: decoded.document };
}

export function resetToSample(sample: CompositionDocument): CompositionDocument {
  return cloneJson(sample);
}
