// Never-destructive Sitemap recovery — fresh, ok, recovered, or quarantined.
//
// Invalid current data falls back to a detached sample. Future data is never
// rewritten: the UI may expose a sample to work in, but the exact raw string is
// retained so persistence can quarantine it for a newer build.

import { cloneJson } from "../../shared";
import { decodeSitemapDocument } from "./codec";
import type { SitemapDocument } from "./types";
import { isStructurallyValidDocument } from "./validate";

export type SitemapRecoveryReason =
  | "invalid-json"
  | "unsupported-schema"
  | "invalid-document";

export type SitemapLoadOutcome =
  | { status: "fresh"; document: SitemapDocument }
  | { status: "ok"; document: SitemapDocument }
  | {
      status: "recovered";
      document: SitemapDocument;
      reason: SitemapRecoveryReason;
    }
  | {
      status: "quarantined";
      document: SitemapDocument;
      quarantinedRaw: string;
      foundSchemaVersion: number;
    };

/** Load persisted JSON without throwing, mutating the sample, or losing raw data. */
export function loadSitemapDocument(
  raw: string | null | undefined,
  sample: SitemapDocument,
): SitemapLoadOutcome {
  if (raw === null || raw === undefined || raw.trim() === "") {
    return { status: "fresh", document: cloneJson(sample) };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "recovered", document: cloneJson(sample), reason: "invalid-json" };
  }

  const decoded = decodeSitemapDocument(parsed);
  if (decoded.status === "future-schema") {
    return {
      status: "quarantined",
      document: cloneJson(sample),
      quarantinedRaw: raw,
      foundSchemaVersion: decoded.foundSchemaVersion,
    };
  }
  if (decoded.status === "malformed") {
    return { status: "recovered", document: cloneJson(sample), reason: "unsupported-schema" };
  }

  const validation = isStructurallyValidDocument(decoded.document);
  if (!validation.ok) {
    return { status: "recovered", document: cloneJson(sample), reason: "invalid-document" };
  }
  return { status: "ok", document: validation.document };
}

