import { createHash } from "node:crypto";
import { z } from "zod";
import type { JsonValue } from "@zudo-composer/component-contract";
import { indexDocument } from "../../src/composer/model/index-model";
import { addNode, insertSubtree, updateProps } from "../../src/composer/model/commands";
import { planLinkedJsxModules } from "../../src/composer/source/plan-linked-jsx";
import type { CompositionRecord } from "../../src/composer/library/types";
import type { CompositionDocument, CompositionNode, InsertionTarget, JsonObject } from "../../src/composer/model/types";
import type { AssetVersionPin } from "../../src/assets/model/types";
import { resolvePage, type HostCapture } from "./inspect";
import { EditError } from "./plans";

// Model-facing and browser-facing operation grammar. Every shape is strict and
// names existing pack components/fields; there is no generic patch.
const name = z.string().min(1).max(256);
export const pageRefSchema = z.object({ sitemapId: name, pageId: name }).strict();
export type PageRef = z.infer<typeof pageRefSchema>;
export const placementSchema = z.union([
  z.object({ after: name }).strict(),
  z.object({ before: name }).strict(),
  z.object({ parentId: name.nullable(), slotId: name, index: z.number().int().nonnegative().optional() }).strict(),
]);
export type Placement = z.infer<typeof placementSchema>;
const jsonValue: z.ZodType<JsonValue> = z.lazy(() => z.union([z.string().max(100_000), z.number(), z.boolean(), z.null(), z.array(jsonValue).max(1000), z.record(z.string().max(256), jsonValue)]));
/** `$payload` quotes an exact user-supplied text; `$asset` pins a managed image's immutable URL. */
export const valueSchema = z.union([
  z.object({ $payload: name }).strict(),
  z.object({ $asset: name }).strict(),
  jsonValue,
]);
export type DraftValue = z.infer<typeof valueSchema>;
export const operationRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("updateField"), page: pageRefSchema, nodeId: name, prop: name, value: valueSchema, reason: z.string().max(500).optional() }).strict(),
  z.object({ kind: z.literal("insertComponent"), page: pageRefSchema, componentId: name, at: placementSchema, props: z.record(name, valueSchema).default({}), reason: z.string().max(500).optional() }).strict(),
  z.object({ kind: z.literal("copyComponent"), page: pageRefSchema, sourcePage: pageRefSchema.optional(), sourceNodeId: name, at: placementSchema, reason: z.string().max(500).optional() }).strict(),
  z.object({ kind: z.literal("insertExact"), page: pageRefSchema, at: placementSchema, payloadId: name, reason: z.string().max(500).optional() }).strict(),
]);
export type OperationRequest = z.infer<typeof operationRequestSchema>;

export interface Provenance { actor: "assistant" | "operator"; conversationId?: string; runId?: string; turnId?: string }
/** A stored operation is fully resolved: exact values, generated ids and copied subtrees are fixed. */
export type DraftOperation = { id: string; createdAt: string; provenance: Provenance; reason?: string; page: PageRef; recordId: string } & (
  | { kind: "updateField"; nodeId: string; prop: string; value: JsonValue; source?: { payloadId?: string; assetPin?: AssetVersionPin } }
  | { kind: "insertNode"; at: Placement; node: CompositionNode; origin: { kind: "component"; componentId: string } | { kind: "copy"; sourceRecordId: string; sourceNodeId: string } | { kind: "exact"; payloadId: string; payloadKind: "text" | "table" | "image" }; assetPins?: AssetVersionPin[] }
);
export interface DraftPage { page: PageRef; identity: ReturnType<typeof resolvePage>["identity"]; before: CompositionRecord; contextDigest: string }
/** Template/outlet context a candidate renders inside; a changed template makes the page stale. */
export const pageContextDigest = (resolved: Pick<ReturnType<typeof resolvePage>, "linked" | "rootPolicy">) => createHash("sha256").update(JSON.stringify({ linked: resolved.linked ?? null, rootPolicy: resolved.rootPolicy })).digest("hex");
export type DraftStatus = "open" | "applied" | "discarded" | "undone";
export interface SharedDraft {
  schemaVersion: 1; kind: "assistant-shared-draft"; id: string; host: string; workspaceId: string;
  generation: number; revision: number; status: DraftStatus; createdAt: string; updatedAt: string;
  dependencyDigest: string; pages: DraftPage[]; operations: DraftOperation[];
  applied?: { operationId: string; candidateDigest: string; committedAt: string };
  undone?: { operationId: string; committedAt: string };
}
export interface DraftChange {
  id: string; kind: "field" | "added" | "removed"; page: PageRef; recordId: string; nodeId: string; componentId: string;
  componentTitle: string; prop?: string; fieldLabel?: string; before?: JsonValue; after?: JsonValue;
  /** Props of an added node, all of which are new authored values. */
  props?: JsonObject; children?: number; operationIds: string[]; reasons: string[];
}
export interface CandidatePage { page: PageRef; identity: DraftPage["identity"]; before: CompositionRecord; candidate: CompositionRecord; jsx: string; changed: boolean }
export interface DraftBuild { pages: CandidatePage[]; changes: DraftChange[]; stale: { page: PageRef; reason: string }[] }

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const sameRef = (a: PageRef, b: PageRef) => a.sitemapId === b.sitemapId && a.pageId === b.pageId;
export const pageKey = (page: PageRef) => `${page.sitemapId}/${page.pageId}`;

/** Resolves a placement against the working document without guessing. */
export function resolvePlacement(document: CompositionDocument, capture: HostCapture, at: Placement): InsertionTarget {
  if ("parentId" in at) {
    const slot = at.parentId === null ? document.root : indexDocument(document, capture.manifest).byId.get(at.parentId)?.node.slots[at.slotId];
    if (at.parentId !== null && !indexDocument(document, capture.manifest).byId.has(at.parentId)) throw new EditError("unsupported-target", `Container node "${at.parentId}" is not on this page.`);
    return { parentId: at.parentId, slotId: at.parentId === null ? "root" : at.slotId, index: at.index ?? slot?.length ?? 0 };
  }
  const anchorId = "after" in at ? at.after : at.before;
  const anchor = indexDocument(document, capture.manifest).byId.get(anchorId);
  if (!anchor) throw new EditError("unsupported-target", `Anchor node "${anchorId}" is not on this page. Select an existing standalone block.`);
  return { parentId: anchor.parentId, slotId: anchor.slotId, index: anchor.index + ("after" in at ? 1 : 0) };
}

function applyOperation(document: CompositionDocument, capture: HostCapture, operation: DraftOperation, rootPolicy: ReturnType<typeof resolvePage>["rootPolicy"]): CompositionDocument {
  if (operation.kind === "updateField") {
    const located = indexDocument(document, capture.manifest).byId.get(operation.nodeId);
    if (!located) throw new EditError("unsupported-target", `Node "${operation.nodeId}" is not on this page.`);
    const entry = capture.manifest.get(located.node.componentId);
    const field = entry?.fields.find(candidate => candidate.prop === operation.prop);
    if (!entry || !field) throw new EditError("component-invalid", `"${operation.prop}" is not an editable field of ${located.node.componentId}.`);
    const updated = updateProps(document, capture.manifest, operation.nodeId, { [operation.prop]: operation.value } as JsonObject);
    if (!updated.ok) throw new EditError("component-invalid", updated.error);
    return updated.document;
  }
  const target = resolvePlacement(document, capture, operation.at);
  const inserted = insertSubtree(document, capture.manifest, target, operation.node, rootPolicy);
  if (!inserted.ok) throw new EditError("component-invalid", inserted.error);
  return inserted.document;
}

/** Builds a fresh insertion node exactly as the Composer `addNode` would, plus explicit props. */
export function componentNode(capture: HostCapture, componentId: string, id: string, props: JsonObject): CompositionNode {
  const entry = capture.manifest.get(componentId);
  if (!entry) throw new EditError("component-invalid", `"${componentId}" is not a registered component in this host's pack.`);
  for (const prop of Object.keys(props)) if (!entry.fields.some(field => field.prop === prop)) throw new EditError("component-invalid", `"${prop}" is not an editable field of ${componentId}.`);
  // Author defaults that carry copy would insert words the request never supplied.
  const implicitCopy = Object.entries(entry.defaults ?? {}).filter(([prop, value]) => !Object.hasOwn(props, prop) && (typeof value === "string" ? value.trim() !== "" : Array.isArray(value) && value.length > 0));
  if (implicitCopy.length) throw new EditError("unrequested-content", `${componentId} would add default content (${implicitCopy.map(([prop]) => prop).join(", ")}). Supply each value explicitly from the request, or choose another component.`);
  if (entry.slots.some(slot => (slot.min ?? 0) > 0)) throw new EditError("unrequested-content", `${componentId} requires child blocks; inserting it would add a wrapper the request did not supply.`);
  const scratch: CompositionDocument = { schemaVersion: 2, id: "scratch", name: "scratch", root: [] };
  const added = addNode(scratch, capture.manifest, { parentId: null, slotId: "root", index: 0 }, componentId, () => id);
  if (!added.ok) throw new EditError("component-invalid", added.error);
  const updated = Object.keys(props).length ? updateProps(added.document, capture.manifest, id, props) : added;
  if (!updated.ok) throw new EditError("component-invalid", updated.error);
  return updated.document.root[0]!;
}

/**
 * Deterministically rebuilds every affected page from its captured before
 * record. Page staleness is reported, never silently rebased.
 */
export function buildDraft(capture: HostCapture, draft: Pick<SharedDraft, "pages" | "operations">): DraftBuild {
  const stale: DraftBuild["stale"] = [];
  const working = new Map<string, { page: DraftPage; document: CompositionDocument; resolved: ReturnType<typeof resolvePage> }>();
  for (const page of draft.pages) {
    let resolved: ReturnType<typeof resolvePage>;
    try { resolved = resolvePage(capture, { workspaceId: capture.workspaceId, sitemapId: page.page.sitemapId, page: page.page.pageId }); }
    catch (error) { stale.push({ page: page.page, reason: error instanceof Error ? error.message : "Page is unavailable." }); continue; }
    if (!sameJson(resolved.identity, page.identity)) stale.push({ page: page.page, reason: "The page now resolves to another owner." });
    else if (!sameJson(resolved.record, page.before)) stale.push({ page: page.page, reason: "The saved page changed after these changes were proposed." });
    else if (pageContextDigest(resolved) !== page.contextDigest) stale.push({ page: page.page, reason: "The page's template changed after these changes were proposed." });
    else if (resolved.writeBlockers.length) stale.push({ page: page.page, reason: resolved.writeBlockers.join(" ") });
    working.set(page.before.id, { page, document: structuredClone(page.before.document), resolved });
  }
  for (const operation of draft.operations) {
    const entry = working.get(operation.recordId);
    if (!entry) throw new EditError("tampered-draft", "Draft operation names a page outside the draft.");
    entry.document = applyOperation(entry.document, capture, operation, entry.resolved.rootPolicy);
  }
  const candidates = new Map([...working.values()].map(entry => [entry.page.before.id, { ...entry.page.before, document: entry.document }]));
  const records = capture.records.compositions.map(record => candidates.get(record.id) ?? record);
  const output = planLinkedJsxModules({ manifest: capture.manifest, records, sourceOutcomes: new Map(records.map(record => [record.id, { status: "loaded" as const, record }])), moduleSpecifier: id => `./composition-${id}.tsx` }).byRecordId;
  const pages: CandidatePage[] = [];
  const changes: DraftChange[] = [];
  for (const entry of working.values()) {
    const candidate = candidates.get(entry.page.before.id)!;
    const changed = !sameJson(candidate.document, entry.page.before.document);
    const generated = output.get(candidate.id);
    if (!generated || generated.status !== "generated") throw new EditError("component-invalid", "Candidate cannot generate valid production JSX under the real component grammar.");
    pages.push({ page: entry.page.page, identity: entry.page.identity, before: entry.page.before, candidate, jsx: generated.code, changed });
    changes.push(...diffPage(capture, entry.page, candidate.document, draft.operations.filter(operation => operation.recordId === candidate.id)));
  }
  return { pages, changes, stale };
}

/** Semantic diff: a value returned to its base disappears; message counts never matter. */
export function diffPage(capture: HostCapture, page: DraftPage, after: CompositionDocument, operations: readonly DraftOperation[]): DraftChange[] {
  const before = indexDocument(page.before.document, capture.manifest), next = indexDocument(after, capture.manifest);
  const changes: DraftChange[] = [];
  const title = (componentId: string) => capture.manifest.get(componentId)?.title ?? componentId;
  const within = (rootId: string, nodeId: string) => {
    for (let cursor: string | null = nodeId; cursor; cursor = next.byId.get(cursor)?.parentId ?? null) if (cursor === rootId) return true;
    return false;
  };
  for (const nodeId of next.order) {
    const located = next.byId.get(nodeId)!;
    if (before.byId.has(nodeId)) continue;
    if (located.parentId && !before.byId.has(located.parentId)) continue;
    const related = operations.filter(operation => operation.kind === "insertNode" ? operation.node.id === nodeId : within(nodeId, operation.nodeId));
    let children = 0;
    for (const id of next.order) if (id !== nodeId && within(nodeId, id)) children++;
    changes.push({ id: `added:${page.before.id}:${nodeId}`, kind: "added", page: page.page, recordId: page.before.id, nodeId, componentId: located.node.componentId, componentTitle: title(located.node.componentId), props: located.node.props, children, operationIds: related.map(operation => operation.id), reasons: related.flatMap(operation => operation.reason ? [operation.reason] : []) });
  }
  for (const nodeId of before.order) {
    const old = before.byId.get(nodeId)!.node, current = next.byId.get(nodeId)?.node;
    if (!current) {
      if (!before.byId.get(nodeId)!.parentId || next.byId.has(before.byId.get(nodeId)!.parentId!)) changes.push({ id: `removed:${page.before.id}:${nodeId}`, kind: "removed", page: page.page, recordId: page.before.id, nodeId, componentId: old.componentId, componentTitle: title(old.componentId), props: old.props, operationIds: [], reasons: [] });
      continue;
    }
    const entry = capture.manifest.get(current.componentId);
    for (const prop of new Set([...Object.keys(old.props), ...Object.keys(current.props)])) {
      if (sameJson(old.props[prop], current.props[prop])) continue;
      const related = operations.filter(operation => operation.kind === "updateField" && operation.nodeId === nodeId && operation.prop === prop);
      changes.push({ id: `field:${page.before.id}:${nodeId}:${prop}`, kind: "field", page: page.page, recordId: page.before.id, nodeId, componentId: current.componentId, componentTitle: title(current.componentId), prop, fieldLabel: entry?.fields.find(field => field.prop === prop)?.label ?? prop, ...(old.props[prop] === undefined ? {} : { before: old.props[prop] }), ...(current.props[prop] === undefined ? {} : { after: current.props[prop] }), operationIds: related.map(operation => operation.id), reasons: related.flatMap(operation => operation.reason ? [operation.reason] : []) });
    }
  }
  return changes;
}

/** Operations that disappear with a withdrawn change, including dependents that no longer apply. */
export function withdrawOperations(capture: HostCapture, draft: Pick<SharedDraft, "pages" | "operations">, change: DraftChange): { remaining: DraftOperation[]; removed: DraftOperation[]; dependents: DraftOperation[] } {
  const direct = new Set(change.kind === "field"
    ? draft.operations.filter(operation => operation.kind === "updateField" && operation.recordId === change.recordId && operation.nodeId === change.nodeId && operation.prop === change.prop).map(operation => operation.id)
    : change.operationIds);
  if (!direct.size) throw new EditError("not-found", "That change has no withdrawable operations.");
  const remaining: DraftOperation[] = [], dependents: DraftOperation[] = [];
  const working = new Map(draft.pages.map(page => {
    const resolved = resolvePage(capture, { workspaceId: capture.workspaceId, sitemapId: page.page.sitemapId, page: page.page.pageId });
    return [page.before.id, { document: structuredClone(page.before.document), rootPolicy: resolved.rootPolicy }];
  }));
  for (const operation of draft.operations) {
    if (direct.has(operation.id)) continue;
    const entry = working.get(operation.recordId)!;
    try { entry.document = applyOperation(entry.document, capture, operation, entry.rootPolicy); remaining.push(operation); }
    catch { dependents.push(operation); }
  }
  return { remaining, removed: draft.operations.filter(operation => direct.has(operation.id)), dependents };
}

export const touchesPage = (draft: Pick<SharedDraft, "pages">, page: PageRef) => draft.pages.some(entry => sameRef(entry.page, page));
