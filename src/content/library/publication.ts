import type { ContentEntryRecord, ContentEntryRef } from "../model";
import { contentEntryRefKey } from "./graph";
import type { ContentSnapshot } from "./types";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
/** Exact canonical content fingerprint, collision-free (not a cryptographic hash). */
export function contentEntryDigest(entry: ContentEntryRecord): string { return canonical({ id: entry.id, modelId: entry.modelId, createdAt: entry.createdAt, values: entry.values }); }
export type ContentPublicationSelection = { ref: ContentEntryRef; action: "publish" | "delete" | "unpublish" };
export interface ContentPublicationChange { ref: ContentEntryRef; kind: "new" | "changed" | "deleted" | "unpublish" }

export function getContentPublicationChanges(working: readonly ContentSnapshot[], baseline: readonly ContentSnapshot[]): ContentPublicationChange[] {
  const before = entryMap(baseline, true), after = entryMap(working), changes: ContentPublicationChange[] = [];
  for (const [key, item] of after) {
    const old = before.get(key);
    if (!old) changes.push({ ref: item.ref, kind: "new" });
    else if (item.entry.lifecycle === "draft") changes.push({ ref: item.ref, kind: "unpublish" });
    else if (contentEntryDigest(item.entry) !== contentEntryDigest(old.entry)) changes.push({ ref: item.ref, kind: "changed" });
  }
  for (const [key, item] of before) if (!after.has(key)) changes.push({ ref: item.ref, kind: "deleted" });
  return changes;
}

/** Whole-project structural schemas come from working. Entries overlay only explicit selections.
 * Caller MUST validate the resulting aggregate (including retained baseline entries) before release. */
export function selectContentPublicationCandidate(working: readonly ContentSnapshot[], baseline: readonly ContentSnapshot[], selections: readonly ContentPublicationSelection[]): ContentSnapshot[] {
  const before = entryMap(baseline, true), after = entryMap(working), selected = new Set<string>();
  const candidate = new Map([...before].map(([key, item]) => [key, structuredClone(item)]));
  for (const selection of selections) {
    if (!["publish", "delete", "unpublish"].includes(selection.action)) throw new TypeError("Unsupported publication selection action.");
    const key = contentEntryRefKey(selection.ref);
    if (selected.has(key)) throw new TypeError("Duplicate publication selection."); selected.add(key);
    const current = after.get(key), old = before.get(key);
    if (selection.action === "publish") {
      if (!current) throw new TypeError("Cannot publish a missing working entry.");
      candidate.set(key, { ref: current.ref, entry: { ...structuredClone(current.entry), lifecycle: "published" } });
    } else {
      if (!old || (selection.action === "delete" && current) || (selection.action === "unpublish" && !current)) throw new TypeError("Publication removal does not match working/baseline state.");
      candidate.delete(key);
    }
  }
  for (const { ref } of candidate.values()) if (!working.some((snapshot) => snapshot.providerId === ref.providerId)) throw new TypeError("A retained baseline entry belongs to a removed provider; explicitly select its removal.");
  return working.map((snapshot) => ({ ...structuredClone(snapshot), entries: [...candidate.values()].filter((item) => item.ref.providerId === snapshot.providerId).map((item) => item.entry) }));
}
function entryMap(snapshots: readonly ContentSnapshot[], publishedOnly = false) {
  const result = new Map<string, { ref: ContentEntryRef; entry: ContentEntryRecord }>();
  if (new Set(snapshots.map((snapshot) => snapshot.providerId)).size !== snapshots.length) throw new TypeError("Duplicate Content provider snapshot.");
  const identities = new Set<string>();
  for (const snapshot of snapshots) for (const entry of snapshot.entries) {
    const identity = JSON.stringify([snapshot.providerId, entry.id]);
    if (identities.has(identity)) throw new TypeError("Duplicate provider-qualified entry identity."); identities.add(identity);
    if (publishedOnly && entry.lifecycle !== "published") continue;
    const ref = { providerId: snapshot.providerId, modelId: entry.modelId, recordId: entry.id }, key = contentEntryRefKey(ref);
    if (result.has(key)) throw new TypeError("Duplicate provider-qualified entry identity.");
    result.set(key, { ref, entry });
  }
  return result;
}
