// Adapter conformance for `ContentDraftStorageAdapter`. Dependency-free so a
// host can run it against its real adapter from any test runner: pass
// vitest's `it` as `harness.test`, or call without a harness to run every
// case sequentially and throw on the first failure.

import type { JsonValue } from "@zudo-composer/component-contract";
import type { ContentMutation } from "../content/library/types";
import type { ContentEntryRecord, ContentModelRecord } from "../content/model/types";
import { canonicalStringifyJson } from "../site-project/model/canonical";
import type { SiteProject } from "../site-project/model/types";
import { authorizeContentMutation, type HostContentPolicy } from "./policy";
import type { ContentBaseline, ContentDraftStorageAdapter } from "./storage";

export type ContentStorageConformanceFactory = (baseline: ContentBaseline) => Promise<ContentDraftStorageAdapter>;

export interface ContentStorageConformanceHarness {
  test(name: string, run: () => Promise<void>): void;
}

export interface ContentStorageConformanceCase {
  readonly name: string;
  run(factory: ContentStorageConformanceFactory): Promise<void>;
}

const TIMESTAMP = "2026-10-12T00:00:00.000Z";
const PROVIDER_ID = "content-filesystem";
const PROJECT_ID = "conformance-site";
const actor = { subject: "conformance@example.test" };

function model(): ContentModelRecord {
  return {
    id: "notes", createdAt: TIMESTAMP, updatedAt: TIMESTAMP,
    document: {
      schemaVersion: 1, id: "notes", name: "Notes", description: "", kind: "collection",
      fields: [
        { id: "title", key: "title", label: "Title", required: true, kind: "text" },
        { id: "body", key: "body", label: "Body", required: false, kind: "markdown" },
        { id: "order", key: "order", label: "Order", required: true, kind: "number" },
        { id: "related", key: "related", label: "Related", required: false, kind: "reference-list", target: { providerId: PROVIDER_ID, recordId: "notes" }, ordered: true },
      ],
    },
  };
}

function entry(id: string, title: string, order: number): ContentEntryRecord {
  return { schemaVersion: 1, id, modelId: "notes", createdAt: TIMESTAMP, updatedAt: TIMESTAMP, values: { title, body: "", order, related: [] }, lifecycle: "published", generation: 0 };
}

/** A minimal valid project with two `notes` entries. Hosts seed their adapter from it. */
export function createContentStorageConformanceBaseline(baselineRevision = "baseline-1"): ContentBaseline {
  const project: SiteProject = {
    schemaVersion: 2, id: PROJECT_ID, name: "Conformance site",
    componentPack: { contractVersion: 2, packId: "conformance-pack", packVersion: "1.0.0" },
    providers: {
      compositions: [{ id: "files", records: [{ id: "landing", createdAt: TIMESTAMP, updatedAt: TIMESTAMP, document: { schemaVersion: 2, id: "landing", name: "Landing", root: [] } }] }],
      content: [{ id: PROVIDER_ID, models: [model()], entries: [entry("first", "First", 0), entry("second", "Second", 1)] }],
      mappings: [{ id: "mapping-filesystem", records: [] }],
      sitemaps: [{ id: "sitemap-filesystem", records: [{ id: "main", createdAt: TIMESTAMP, updatedAt: TIMESTAMP, document: { schemaVersion: 3, id: "main", name: "Main", navigation: { primary: [], footer: [] }, root: [{ id: "home", title: "Home", source: { kind: "composition", ref: { providerId: "files", recordId: "landing" } }, children: [] }] } }] }],
    },
    activeSitemap: { providerId: "sitemap-filesystem", recordId: "main" },
    collectionAttachments: [],
  };
  return { project, baselineRevision };
}

export const CONTENT_STORAGE_CONFORMANCE_POLICY: HostContentPolicy = {
  projectId: PROJECT_ID,
  providerId: PROVIDER_ID,
  models: { notes: { fields: ["title", "body", "order", "related"], operations: ["put-entry-values", "create-entry", "delete-entry", "reorder"] } },
};

class ConformanceFailure extends Error { readonly name = "ContentStorageConformanceFailure"; }

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ConformanceFailure(message);
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  const left = canonicalStringifyJson(actual as JsonValue);
  const right = canonicalStringifyJson(expected as JsonValue);
  if (left !== right) throw new ConformanceFailure(`${message}\nexpected: ${right}received: ${left}`);
}

async function open(factory: ContentStorageConformanceFactory, baselineRevision?: string) {
  const baseline = createContentStorageConformanceBaseline(baselineRevision);
  const adapter = await factory(baseline);
  const draft = await adapter.readDraft();
  assert(draft.status === "ok", "readDraft must succeed on a freshly seeded adapter");
  return { baseline, adapter, draft: draft.value };
}

function titleMutation(snapshot: { mutationToken: number; models: readonly ContentModelRecord[]; entries: readonly ContentEntryRecord[]; providerId: string }, entryId: string, title: string): ContentMutation {
  const authorized = authorizeContentMutation(CONTENT_STORAGE_CONFORMANCE_POLICY, actor, { kind: "put-entry-values", projectId: PROJECT_ID, providerId: PROVIDER_ID, modelId: "notes", expectedRevision: snapshot.mutationToken, entryId, values: { title } }, snapshot, { now: () => TIMESTAMP });
  assert(authorized.ok, `conformance mutation must authorize: ${authorized.ok ? "" : authorized.message}`);
  return authorized.mutation;
}

export const CONTENT_STORAGE_CONFORMANCE_CASES: readonly ContentStorageConformanceCase[] = [
  {
    name: "reads the seeded baseline and a clean draft at that baseline",
    async run(factory) {
      const { baseline, adapter, draft } = await open(factory);
      const read = await adapter.readBaseline();
      assert(read.status === "ok", "readBaseline must succeed");
      assertEqual(read.value, baseline, "baseline must round-trip");
      assertEqual(draft.baselineRevision, baseline.baselineRevision, "draft must name its baseline");
      assertEqual(draft.snapshot.entries.map(({ id, values }) => ({ id, values })), baseline.project.providers.content[0]!.entries.map(({ id, values }) => ({ id, values })), "clean draft must hold the baseline entries");
      assertEqual(draft.snapshot.providerId, PROVIDER_ID, "draft snapshot must name the Content provider");
    },
  },
  {
    name: "applies an authorized mutation, advances the draft revision and records a receipt",
    async run(factory) {
      const { baseline, adapter, draft } = await open(factory);
      const result = await adapter.apply({ operationId: "op-1", actor, mutation: titleMutation(draft.snapshot, "first", "Renamed"), expectedDraftRevision: draft.draftRevision, expectedBaselineRevision: baseline.baselineRevision });
      assert(result.status === "ok", `apply must succeed: ${JSON.stringify(result)}`);
      assert(result.value.replayed === false, "a first apply is not a replay");
      assert(result.value.draft.draftRevision !== draft.draftRevision, "apply must advance the draft revision");
      assertEqual(result.value.receipt.previousDraftRevision, draft.draftRevision, "receipt must name the previous revision");
      assertEqual(result.value.receipt.draftRevision, result.value.draft.draftRevision, "receipt must name the new revision");
      assertEqual(result.value.receipt.affectedEntryIds, ["first"], "receipt must list affected entries");
      assertEqual(result.value.draft.snapshot.entries.find(({ id }) => id === "first")?.values.title, "Renamed", "draft must hold the new value");
      const receipt = await adapter.readReceipt("op-1");
      assert(receipt.status === "ok", "receipt must be readable");
      assertEqual(receipt.value, result.value.receipt, "stored receipt must equal the returned one");
      const reread = await adapter.readDraft();
      assert(reread.status === "ok", "readDraft must succeed");
      assertEqual(reread.value, result.value.draft, "readDraft must return the applied state");
    },
  },
  {
    name: "a stale draft revision is a conflict with no revision, receipt or collection change",
    async run(factory) {
      const { baseline, adapter, draft } = await open(factory);
      const mutation = titleMutation(draft.snapshot, "first", "Renamed");
      const first = await adapter.apply({ operationId: "op-1", actor, mutation, expectedDraftRevision: draft.draftRevision, expectedBaselineRevision: baseline.baselineRevision });
      assert(first.status === "ok", "first apply must succeed");
      const stale = await adapter.apply({ operationId: "op-2", actor, mutation: titleMutation(draft.snapshot, "second", "Lost"), expectedDraftRevision: draft.draftRevision, expectedBaselineRevision: baseline.baselineRevision });
      assert(stale.status === "conflict" && stale.reason === "draft-revision", `stale apply must conflict on the draft revision: ${JSON.stringify(stale)}`);
      assertEqual(stale.current.draftRevision, first.value.draft.draftRevision, "conflict must report the current revision");
      assertEqual((await adapter.readReceipt("op-2")).status, "not-found", "a losing apply must not record a receipt");
      const after = await adapter.readDraft();
      assert(after.status === "ok", "readDraft must succeed");
      assertEqual(after.value, first.value.draft, "a losing apply must not change the draft");
    },
  },
  {
    name: "a stale baseline revision is a conflict with no side effects",
    async run(factory) {
      const { adapter, draft } = await open(factory);
      const result = await adapter.apply({ operationId: "op-1", actor, mutation: titleMutation(draft.snapshot, "first", "Renamed"), expectedDraftRevision: draft.draftRevision, expectedBaselineRevision: "someone-elses-baseline" });
      assert(result.status === "conflict" && result.reason === "baseline-revision", `must conflict on the baseline: ${JSON.stringify(result)}`);
      assertEqual((await adapter.readReceipt("op-1")).status, "not-found", "no receipt after a baseline conflict");
      const after = await adapter.readDraft();
      assert(after.status === "ok", "readDraft must succeed");
      assertEqual(after.value, draft, "draft must be untouched");
    },
  },
  {
    name: "a duplicate operation id replays the receipt once and conflicts for a different request",
    async run(factory) {
      const { baseline, adapter, draft } = await open(factory);
      const input = { operationId: "op-1", actor, mutation: titleMutation(draft.snapshot, "first", "Renamed"), expectedDraftRevision: draft.draftRevision, expectedBaselineRevision: baseline.baselineRevision };
      const first = await adapter.apply(input);
      assert(first.status === "ok", "first apply must succeed");
      const replay = await adapter.apply(input);
      assert(replay.status === "ok" && replay.value.replayed === true, `retry must replay: ${JSON.stringify(replay)}`);
      assertEqual(replay.value.receipt, first.value.receipt, "replay must return the original receipt");
      assertEqual(replay.value.draft.draftRevision, first.value.draft.draftRevision, "replay must not advance the revision");
      const next = await adapter.readDraft();
      assert(next.status === "ok", "readDraft must succeed");
      const different = await adapter.apply({ ...input, mutation: titleMutation(next.value.snapshot, "second", "Other"), expectedDraftRevision: next.value.draftRevision });
      assert(different.status === "conflict" && different.reason === "operation-id", `a reused id with another request must conflict: ${JSON.stringify(different)}`);
      const after = await adapter.readDraft();
      assert(after.status === "ok", "readDraft must succeed");
      assertEqual(after.value, next.value, "the conflicting reuse must not change the draft");
    },
  },
  {
    name: "concurrent saves against one revision admit exactly one winner",
    async run(factory) {
      const { baseline, adapter, draft } = await open(factory);
      const results = await Promise.all(["A", "B", "C"].map((title, index) => adapter.apply({ operationId: `op-${index}`, actor, mutation: titleMutation(draft.snapshot, "first", title), expectedDraftRevision: draft.draftRevision, expectedBaselineRevision: baseline.baselineRevision })));
      const winners = results.filter((result) => result.status === "ok");
      assertEqual(winners.length, 1, `exactly one concurrent save wins: ${JSON.stringify(results.map(({ status }) => status))}`);
      assert(results.every((result) => result.status === "ok" || (result.status === "conflict" && result.reason === "draft-revision")), "losers must report a draft-revision conflict");
      const after = await adapter.readDraft();
      assert(after.status === "ok" && winners[0]!.status === "ok", "readDraft must succeed");
      assertEqual(after.value, winners[0]!.value.draft, "the draft must equal the winner's state");
      const receipts = await Promise.all(["op-0", "op-1", "op-2"].map((id) => adapter.readReceipt(id)));
      assertEqual(receipts.filter(({ status }) => status === "ok").length, 1, "only the winner has a receipt");
    },
  },
  {
    name: "a mutation the storage transaction rejects leaves no trace",
    async run(factory) {
      const { baseline, adapter, draft } = await open(factory);
      const mutation: ContentMutation = { expectedMutationToken: draft.draftRevision, operations: [{ kind: "put-entry", record: { ...entry("ghost", "Ghost", 9), modelId: "missing" } }] };
      const result = await adapter.apply({ operationId: "op-1", actor, mutation, expectedDraftRevision: draft.draftRevision, expectedBaselineRevision: baseline.baselineRevision });
      assert(result.status === "rejected", `must be rejected by the store: ${JSON.stringify(result)}`);
      assertEqual((await adapter.readReceipt("op-1")).status, "not-found", "no receipt for a rejected write");
      const after = await adapter.readDraft();
      assert(after.status === "ok", "readDraft must succeed");
      assertEqual(after.value, draft, "a rejected write must not change the draft");
    },
  },
  {
    name: "a lost acknowledgement is recovered through the receipt and an idempotent retry",
    async run(factory) {
      const { baseline, adapter, draft } = await open(factory);
      const input = { operationId: "op-lost", actor, mutation: titleMutation(draft.snapshot, "first", "Renamed"), expectedDraftRevision: draft.draftRevision, expectedBaselineRevision: baseline.baselineRevision };
      // The caller never sees this result; only the retry below does.
      await adapter.apply(input).catch(() => undefined);
      const receipt = await adapter.readReceipt("op-lost");
      assert(receipt.status === "ok", "the receipt must be durable before any acknowledgement");
      const retry = await adapter.apply(input);
      assert(retry.status === "ok" && retry.value.replayed, "the retry must replay, not apply twice");
      assertEqual(retry.value.receipt, receipt.value, "retry returns the durable receipt");
      assertEqual(retry.value.draft.draftRevision, receipt.value.draftRevision, "no second revision");
    },
  },
  {
    name: "snapshots are immutable, content-addressed and bound to one draft revision",
    async run(factory) {
      const { baseline, adapter, draft } = await open(factory);
      const first = await adapter.snapshot({ expectedDraftRevision: draft.draftRevision });
      assert(first.status === "ok", `snapshot must succeed: ${JSON.stringify(first)}`);
      assert(/^[0-9a-f]{64}$/.test(first.value.snapshotId), "snapshotId must be a sha256 hex digest");
      assertEqual(first.value.draftRevision, draft.draftRevision, "snapshot names its draft revision");
      assertEqual(first.value.baselineRevision, baseline.baselineRevision, "snapshot names its baseline");
      const again = await adapter.snapshot({ expectedDraftRevision: draft.draftRevision });
      assert(again.status === "ok", "snapshot must succeed");
      assertEqual(again.value.snapshotId, first.value.snapshotId, "identical content yields the same snapshot id");
      const applied = await adapter.apply({ operationId: "op-1", actor, mutation: titleMutation(draft.snapshot, "first", "Renamed"), expectedDraftRevision: draft.draftRevision, expectedBaselineRevision: baseline.baselineRevision });
      assert(applied.status === "ok", "apply must succeed");
      const stored = await adapter.readSnapshot(first.value.snapshotId);
      assert(stored.status === "ok", "snapshot must stay readable");
      assertEqual(stored.value.project, first.value.project, "a later save must not change a captured snapshot");
      assertEqual(stored.value.project.providers.content[0]!.entries.find(({ id }) => id === "first")?.values.title, "First", "snapshot holds the pre-save title");
      const stale = await adapter.snapshot({ expectedDraftRevision: draft.draftRevision });
      assert(stale.status === "conflict" && stale.reason === "draft-revision", "a snapshot against a superseded revision must conflict");
      const next = await adapter.snapshot({ expectedDraftRevision: applied.value.draft.draftRevision });
      assert(next.status === "ok" && next.value.snapshotId !== first.value.snapshotId, "changed content yields a new snapshot id");
      assertEqual((await adapter.readSnapshot("0".repeat(64))).status, "not-found", "unknown snapshots are not found");
    },
  },
  {
    name: "advancing the baseline resets a clean draft and preserves a newer unsent edit",
    async run(factory) {
      const { baseline, adapter, draft } = await open(factory);
      const edit = await adapter.apply({ operationId: "op-1", actor, mutation: titleMutation(draft.snapshot, "first", "Renamed"), expectedDraftRevision: draft.draftRevision, expectedBaselineRevision: baseline.baselineRevision });
      assert(edit.status === "ok", "apply must succeed");
      const snapshot = await adapter.snapshot({ expectedDraftRevision: edit.value.draft.draftRevision });
      assert(snapshot.status === "ok", "snapshot must succeed");
      const integrated: ContentBaseline = { project: snapshot.value.project, baselineRevision: "baseline-2" };
      const advanced = await adapter.advanceBaseline({ baseline: integrated, expectedBaselineRevision: baseline.baselineRevision, integratedSnapshotId: snapshot.value.snapshotId });
      assert(advanced.status === "ok", `advance must succeed: ${JSON.stringify(advanced)}`);
      assertEqual(advanced.value.baselineRevision, "baseline-2", "draft follows the new baseline identity");
      assert(advanced.value.draftRevision !== edit.value.draft.draftRevision, "advance moves the draft revision");
      assertEqual(advanced.value.snapshot.entries.map(({ id, values }) => ({ id, values })), integrated.project.providers.content[0]!.entries.map(({ id, values }) => ({ id, values })), "a clean draft equals the integrated content");
      const read = await adapter.readBaseline();
      assert(read.status === "ok", "readBaseline must succeed");
      assertEqual(read.value, integrated, "baseline must be the integrated one");

      const unsent = await adapter.apply({ operationId: "op-2", actor, mutation: titleMutation(advanced.value.snapshot, "second", "Unsent"), expectedDraftRevision: advanced.value.draftRevision, expectedBaselineRevision: "baseline-2" });
      assert(unsent.status === "ok", "a save on the new baseline must succeed");
      const later = await adapter.advanceBaseline({ baseline: { project: integrated.project, baselineRevision: "baseline-3" }, expectedBaselineRevision: "baseline-2", integratedSnapshotId: snapshot.value.snapshotId });
      assert(later.status === "ok", `second advance must succeed: ${JSON.stringify(later)}`);
      assertEqual(later.value.baselineRevision, "baseline-3", "baseline identity moves");
      assertEqual(later.value.snapshot.entries.find(({ id }) => id === "second")?.values.title, "Unsent", "a newer unsent edit survives the advance");
      assert(later.value.draftRevision !== unsent.value.draft.draftRevision, "advance still moves the draft revision");
      const stale = await adapter.advanceBaseline({ baseline: integrated, expectedBaselineRevision: "baseline-2", integratedSnapshotId: snapshot.value.snapshotId });
      assert(stale.status === "conflict" && stale.reason === "baseline-revision", "an advance against a superseded baseline must conflict");
    },
  },
  {
    name: "a save racing a baseline advance loses cleanly",
    async run(factory) {
      const { baseline, adapter, draft } = await open(factory);
      const snapshot = await adapter.snapshot({ expectedDraftRevision: draft.draftRevision });
      assert(snapshot.status === "ok", "snapshot must succeed");
      const [advance, save] = await Promise.all([
        adapter.advanceBaseline({ baseline: { project: snapshot.value.project, baselineRevision: "baseline-2" }, expectedBaselineRevision: baseline.baselineRevision, integratedSnapshotId: snapshot.value.snapshotId }),
        adapter.apply({ operationId: "op-race", actor, mutation: titleMutation(draft.snapshot, "first", "Raced"), expectedDraftRevision: draft.draftRevision, expectedBaselineRevision: baseline.baselineRevision }),
      ]);
      assert(advance.status === "ok", `advance must succeed: ${JSON.stringify(advance)}`);
      assert(save.status === "conflict" && (save.reason === "draft-revision" || save.reason === "baseline-revision"), `the racing save must conflict: ${JSON.stringify(save)}`);
      assertEqual((await adapter.readReceipt("op-race")).status, "not-found", "the losing save leaves no receipt");
      const after = await adapter.readDraft();
      assert(after.status === "ok", "readDraft must succeed");
      assertEqual(after.value, advance.value, "the draft is exactly the advanced state");
    },
  },
  {
    name: "a snapshot racing a save binds to exactly one revision",
    async run(factory) {
      const { baseline, adapter, draft } = await open(factory);
      const [snapshot, save] = await Promise.all([
        adapter.snapshot({ expectedDraftRevision: draft.draftRevision }),
        adapter.apply({ operationId: "op-1", actor, mutation: titleMutation(draft.snapshot, "first", "Renamed"), expectedDraftRevision: draft.draftRevision, expectedBaselineRevision: baseline.baselineRevision }),
      ]);
      assert(save.status === "ok", "the save must succeed");
      if (snapshot.status === "ok") {
        assertEqual(snapshot.value.draftRevision, draft.draftRevision, "a snapshot that won names the pre-save revision");
        assertEqual(snapshot.value.project.providers.content[0]!.entries.find(({ id }) => id === "first")?.values.title, "First", "and holds the pre-save content");
      } else {
        assert(snapshot.status === "conflict" && snapshot.reason === "draft-revision", `a snapshot that lost must conflict: ${JSON.stringify(snapshot)}`);
      }
    },
  },
];

/**
 * Run every case against `factory`. With a harness each case registers as one
 * test; without one the cases run sequentially and the first failure throws.
 */
export async function runContentStorageConformance(factory: ContentStorageConformanceFactory, harness?: ContentStorageConformanceHarness): Promise<void> {
  if (harness) {
    for (const item of CONTENT_STORAGE_CONFORMANCE_CASES) harness.test(item.name, () => item.run(factory));
    return;
  }
  for (const item of CONTENT_STORAGE_CONFORMANCE_CASES) {
    try { await item.run(factory); }
    catch (error) { throw new ConformanceFailure(`${item.name}: ${error instanceof Error ? error.message : String(error)}`, { cause: error }); }
  }
}
