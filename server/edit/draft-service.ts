import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { JsonValue } from "@zudo-composer/component-contract";
import { cloneSubtreeWithNewIds } from "../../src/composer/model/commands";
import { indexDocument } from "../../src/composer/model/index-model";
import { planLinkedJsxModules } from "../../src/composer/source/plan-linked-jsx";
import type { CompositionDocument, JsonObject } from "../../src/composer/model/types";
import type { AssetVersionPin } from "../../src/assets/model/types";
import { nativeCapabilities, resolvePage, type HostCapture } from "./inspect";
import { EditError } from "./plans";
import { openDraftStore, type DraftStore } from "./draft-store";
import { MAX_REVIEWED_CHANGES } from "../../src/composer/storage/filesystem/reviewed-edit";
import {
  buildDraft, componentNode, insideAttachedSlot, pageContextDigest, operationRequestSchema, pageKey, pageRefSchema, withdrawOperations,
  type DraftBuild, type DraftOperation, type DraftPage, type DraftValue, type OperationRequest, type PageRef, type Provenance, type SharedDraft,
} from "./draft-model";

export type ExactPayload = { kind: "text"; text: string } | { kind: "table"; columns: string[]; rows: string[][] } | { kind: "image"; assetId: string; alt: string };
export type PayloadResolver = (payloadId: string) => Promise<ExactPayload>;
export interface DraftReceipt {
  schemaVersion: 1; kind: "draft-applied" | "draft-undone"; operationId: string; draftId: string; revision: number;
  candidateDigest: string; workspaceId: string; committedAt: string;
  pages: { identity: DraftPage["identity"]; beforeDigest: string; afterDigest: string; jsxDigest: string }[];
}
export interface DraftContext {
  host(): Promise<string>;
  dataRoot: string;
  digest(value: unknown): string;
  capture(): Promise<HostCapture>;
  revisions(state: HostCapture): Promise<unknown>;
  leased<T>(action: () => Promise<T>): Promise<T>;
  barriers<T>(state: HostCapture, action: () => Promise<T>): Promise<T>;
  pinAsset(state: HostCapture, assetId: string): Promise<AssetVersionPin>;
  /** "propose" hosts may build and review drafts but never commit them. */
  permission: "apply" | "propose";
}

const name = z.string().min(1).max(256);
const workspaceSchema = z.object({ workspaceId: name }).strict();
const draftRefSchema = workspaceSchema.extend({ draftId: name, revision: z.number().int().nonnegative() }).strict();
const provenanceSchema = z.object({ actor: z.enum(["assistant", "operator"]), conversationId: name.optional(), runId: name.optional(), turnId: name.optional() }).strict();
export const proposeSchema = workspaceSchema.extend({
  expected: z.object({ generation: z.number().int().nonnegative(), draftId: name.nullable() }).strict(),
  operations: z.array(operationRequestSchema).min(1).max(20),
  provenance: provenanceSchema,
  allowedPages: z.array(pageRefSchema).max(50).optional(),
}).strict();
const MAX_DRAFT_OPERATIONS = 200;
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value);
  if (!result.success) throw new EditError("invalid-request", result.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; "));
  return result.data;
};

export function createDraftOperations(context: DraftContext) {
  let storePromise: Promise<DraftStore> | undefined;
  const store = () => storePromise ??= openDraftStore(context.dataRoot);
  // Page records and their templates are tracked per page; every other store, pack and source revision is a draft dependency.
  const dependencies = async (state: HostCapture) => {
    const value = await context.revisions(state) as { tokens?: Record<string, string> };
    return context.digest({ ...value, tokens: { ...value.tokens, compositions: null } });
  };
  // A moved or renamed host cannot adopt the old location's draft.
  const currentForHost = async (drafts: DraftStore, workspaceId: string) => {
    const current = await drafts.current(workspaceId);
    return current && current.host === await context.host() ? current : null;
  };
  const applyOperationId = (draft: SharedDraft) => `draft-${draft.id.slice(6)}-r${draft.revision}`;
  const undoOperationId = (draft: SharedDraft) => `undo-${applyOperationId(draft)}`;
  const selected = async (workspaceId: string) => {
    const state = await context.capture();
    // A different or unselected workspace is denied without revealing its drafts.
    if (state.workspaceId !== workspaceId) throw new EditError("wrong-workspace", "Select this site's workspace before using its Assistant draft.");
    return state;
  };
  const candidateDigest = (draft: SharedDraft, build: DraftBuild) => context.digest({
    draftId: draft.id, revision: draft.revision, dependencyDigest: draft.dependencyDigest,
    pages: build.pages.filter(page => page.changed).map(page => ({ identity: page.identity, beforeDigest: context.digest(page.before), candidate: page.candidate, jsx: page.jsx })),
  });
  const reconcile = async (state: HostCapture, draft: SharedDraft | null): Promise<SharedDraft | null> => {
    if (!draft) return null;
    const drafts = await store();
    if (draft.status === "open") {
      const receipt = await state.stores.compositions.reviewedEditReceipt<DraftReceipt>(applyOperationId(draft));
      if (receipt) {
        draft = { ...draft, status: "applied", applied: { operationId: receipt.operationId, candidateDigest: receipt.candidateDigest, committedAt: receipt.committedAt } };
        await drafts.write(draft);
        if ((await drafts.state(draft.workspaceId)).currentDraftId === draft.id) await drafts.select(draft.workspaceId, draft.id, true);
      }
    }
    if (draft.status === "applied") {
      const receipt = await state.stores.compositions.reviewedEditReceipt<DraftReceipt>(undoOperationId(draft));
      if (receipt) { draft = { ...draft, status: "undone", undone: { operationId: receipt.operationId, committedAt: receipt.committedAt } }; await drafts.write(draft); }
    }
    return draft;
  };
  const view = async (state: HostCapture, draft: SharedDraft | null) => {
    const drafts = await store();
    const generation = (await drafts.state(state.workspaceId)).generation;
    if (!draft) return { generation, draft: null, permission: context.permission };
    let build: DraftBuild | null = null, buildError: { code: string; message: string } | null = null;
    if (draft.status === "open") {
      try { build = buildDraft(state, draft); } catch (error) { buildError = { code: error instanceof EditError ? error.code : "invalid-draft", message: error instanceof Error ? error.message : "Draft cannot be rebuilt." }; }
    }
    const dependenciesCurrent = await dependencies(state) === draft.dependencyDigest;
    const linked = (page: PageRef) => {
      try { return resolvePage(state, { workspaceId: state.workspaceId, sitemapId: page.sitemapId, page: page.pageId }).linked ?? null; } catch { return null; }
    };
    return {
      generation, permission: context.permission,
      draft: {
        id: draft.id, revision: draft.revision, status: draft.status, createdAt: draft.createdAt, updatedAt: draft.updatedAt,
        applied: draft.applied ?? null, undone: draft.undone ?? null, dependenciesCurrent, dependencyDigest: draft.dependencyDigest,
        operations: draft.operations.map(operation => ({ id: operation.id, kind: operation.kind, page: operation.page, provenance: operation.provenance, reason: operation.reason ?? null, createdAt: operation.createdAt })),
        pages: (build?.pages ?? draft.pages.map(page => ({ ...page, candidate: page.before, jsx: "", changed: false }))).map(page => ({ page: page.page, identity: page.identity, before: page.before, candidate: page.candidate, changed: page.changed, linked: linked(page.page) })),
        changes: build?.changes ?? [], stale: build?.stale ?? [], buildError,
        candidateDigest: build && !build.stale.length && dependenciesCurrent ? candidateDigest(draft, build) : null,
      },
    };
  };
  const resolveValue = async (state: HostCapture, value: DraftValue, payloads: PayloadResolver, pins: AssetVersionPin[], sources: { payloadId?: string }): Promise<JsonValue> => {
    if (value && typeof value === "object" && !Array.isArray(value) && "$payload" in value && Object.keys(value).length === 1) {
      const payload = await payloads(String(value.$payload));
      if (payload.kind !== "text") throw new EditError("invalid-payload", "Only an exact text payload can fill a text field.");
      sources.payloadId = String(value.$payload);
      return payload.text;
    }
    if (value && typeof value === "object" && !Array.isArray(value) && "$asset" in value && Object.keys(value).length === 1) {
      const pin = await context.pinAsset(state, String(value.$asset));
      pins.push(pin);
      return pin.url;
    }
    return value as JsonValue;
  };
  const resolvePageEntry = (state: HostCapture, page: PageRef): DraftPage => {
    const resolved = resolvePage(state, { workspaceId: state.workspaceId, sitemapId: page.sitemapId, page: page.pageId });
    if (resolved.writeBlockers.length) throw new EditError("unsupported-scope", `${page.pageId}: ${resolved.writeBlockers.join(" ")}`);
    return { page, identity: resolved.identity, before: resolved.record, contextDigest: pageContextDigest(resolved) };
  };
  const newId = () => `ai-${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const toOperation = async (state: HostCapture, draft: Pick<SharedDraft, "pages" | "operations">, request: OperationRequest, provenance: Provenance, payloads: PayloadResolver): Promise<DraftOperation> => {
    const page = draft.pages.find(entry => pageKey(entry.page) === pageKey(request.page))!;
    const base = { id: `op-${randomUUID()}`, createdAt: new Date().toISOString(), provenance, page: request.page, recordId: page.before.id, ...(request.reason ? { reason: request.reason } : {}) };
    if (request.kind === "updateField") {
      const pins: AssetVersionPin[] = [], sources: { payloadId?: string } = {};
      const value = await resolveValue(state, request.value, payloads, pins, sources);
      return { ...base, kind: "updateField", nodeId: request.nodeId, prop: request.prop, value, ...(sources.payloadId || pins.length ? { source: { ...(sources.payloadId ? { payloadId: sources.payloadId } : {}), ...(pins[0] ? { assetPin: pins[0] } : {}) } } : {}) };
    }
    if (request.kind === "insertComponent") {
      const pins: AssetVersionPin[] = [], props: JsonObject = {};
      for (const [prop, value] of Object.entries(request.props)) props[prop] = await resolveValue(state, value, payloads, pins, {});
      return { ...base, kind: "insertNode", at: request.at, node: componentNode(state, request.componentId, newId(), props), origin: { kind: "component", componentId: request.componentId }, ...(pins.length ? { assetPins: pins } : {}) };
    }
    if (request.kind === "copyComponent") {
      const sourcePage = request.sourcePage ?? request.page;
      const sourceEntry = draft.pages.find(entry => pageKey(entry.page) === pageKey(sourcePage)) ?? resolvePageEntry(state, sourcePage);
      const working = draft.pages.some(entry => pageKey(entry.page) === pageKey(sourcePage)) ? buildDraft(state, draft).pages.find(entry => pageKey(entry.page) === pageKey(sourcePage))!.candidate.document : sourceEntry.before.document;
      const source = indexDocument(working, state.manifest).byId.get(request.sourceNodeId);
      if (!source) throw new EditError("unsupported-target", `Node "${request.sourceNodeId}" is not on ${sourcePage.pageId}.`);
      const sourceRules = resolvePage(state, { workspaceId: state.workspaceId, sitemapId: sourcePage.sitemapId, page: sourcePage.pageId });
      if (insideAttachedSlot(working, state, request.sourceNodeId, sourceRules)) throw new EditError("unsupported-scope", "That block comes from a Mapping-owned collection slot and cannot be copied as page content.");
      return { ...base, kind: "insertNode", at: request.at, node: cloneSubtreeWithNewIds(source.node, () => newId()), origin: { kind: "copy", sourceRecordId: sourceEntry.before.id, sourceNodeId: request.sourceNodeId } };
    }
    const payload = await payloads(request.payloadId);
    const capabilities = nativeCapabilities(state.config, state.manifest);
    const kind = payload.kind === "text" ? "paragraph" : payload.kind;
    const capability = capabilities[kind], config = state.config.nativeEditing;
    if (!capability?.available || !config) throw new EditError("unsupported-capability", capability?.reason ?? `This site has no standalone ${kind} component for exact insertion. Choose a field of an existing block instead.`);
    let props: JsonObject; const pins: AssetVersionPin[] = [];
    if (payload.kind === "text") props = { [config.paragraph!.textProp]: payload.text };
    else if (payload.kind === "table") {
      if (payload.rows.some(row => row.length !== payload.columns.length)) throw new EditError("invalid-table", "Every supplied row must have exactly one cell per supplied column.");
      props = { [config.table!.columnsProp]: payload.columns, [config.table!.rowsProp]: payload.rows };
    } else {
      const pin = await context.pinAsset(state, payload.assetId); pins.push(pin);
      props = { [config.image!.srcProp]: pin.url, [config.image!.altProp]: payload.alt };
    }
    const component = state.manifest.get(capability.componentId)!;
    if (Object.keys(component.defaults ?? {}).some(prop => !Object.hasOwn(props, prop)) || component.slots.length) throw new EditError("unsupported-capability", "Exact insertion components must be leaf nodes with only the declared supplied props.");
    return { ...base, kind: "insertNode", at: request.at, node: componentNode(state, capability.componentId, newId(), props), origin: { kind: "exact", payloadId: request.payloadId, payloadKind: payload.kind }, ...(pins.length ? { assetPins: pins } : {}) };
  };
  const loadOpen = async (state: HostCapture, input: { workspaceId: string; draftId: string; revision: number }) => {
    const drafts = await store();
    const draft = await reconcile(state, await drafts.read(input.draftId));
    if (!draft || draft.workspaceId !== state.workspaceId || draft.host !== await context.host()) throw new EditError("wrong-workspace", "Draft belongs to another site.");
    if (draft.status !== "open") throw new EditError("inactive-draft", `This draft was ${draft.status}. Review the current draft instead.`);
    if (draft.revision !== input.revision) throw new EditError("stale-draft", "The draft changed. Review its newest revision.");
    return { drafts, draft };
  };
  const jsxFor = (state: HostCapture, replaced: Map<string, import("../../src/composer/library/types").CompositionRecord>) => {
    const records = state.records.compositions.map(record => replaced.get(record.id) ?? record);
    return planLinkedJsxModules({ manifest: state.manifest, records, sourceOutcomes: new Map(records.map(record => [record.id, { status: "loaded" as const, record }])), moduleSpecifier: id => `./composition-${id}.tsx` }).byRecordId;
  };
  const assetPins = (draft: SharedDraft) => draft.operations.flatMap(operation => operation.kind === "updateField" ? (operation.source?.assetPin ? [operation.source.assetPin] : []) : operation.assetPins ?? []);
  return {
    async draft(input: unknown) {
      const { workspaceId } = parse(workspaceSchema, input);
      const drafts = await store();
      return drafts.serial(async () => {
        const state = await selected(workspaceId);
        return view(state, await reconcile(state, await currentForHost(drafts, workspaceId)));
      });
    },
    /** `active` lets a caller (a model run) cancel a proposal that is still queued or building. */
    async propose(input: unknown, payloads: PayloadResolver = async () => { throw new EditError("invalid-payload", "No exact payload store is attached."); }, active: () => boolean = () => true) {
      const request = parse(proposeSchema, input);
      return context.leased(async () => {
        const drafts = await store();
        return drafts.serial(async () => {
          const state = await selected(request.workspaceId);
          const workspaceState = await drafts.state(state.workspaceId);
          // Late runs carry the generation they observed; discard/apply/undo fence them out.
          let draft = await reconcile(state, await currentForHost(drafts, state.workspaceId));
          // Re-read after reconcile: a recovered Apply bumps the generation and must fence this request too.
          if ((await drafts.state(state.workspaceId)).generation !== request.expected.generation) throw new EditError("stale-draft", "The shared draft was discarded, applied or replaced after this request began.");
          if (draft && draft.status !== "open") draft = null;
          // A request that saw no draft may join one another conversation opened since (same generation).
          if (request.expected.draftId !== null && draft?.id !== request.expected.draftId) throw new EditError("stale-draft", "The shared draft changed identity after this request began.");
          const allowed = request.allowedPages?.map(pageKey);
          for (const operation of request.operations) {
            for (const page of [operation.page, ...(operation.kind === "copyComponent" && operation.sourcePage ? [operation.sourcePage] : [])]) if (allowed && !allowed.includes(pageKey(page))) throw new EditError("unsupported-scope", `This turn did not inspect ${page.pageId}; inspect the page before proposing changes to it.`);
          }
          const now = new Date().toISOString();
          const working: SharedDraft = draft ? structuredClone(draft) : {
            schemaVersion: 1, kind: "assistant-shared-draft", id: `draft-${randomUUID()}`, host: await context.host(), workspaceId: state.workspaceId,
            generation: workspaceState.generation, revision: 0, status: "open", createdAt: now, updatedAt: now,
            dependencyDigest: await dependencies(state), pages: [], operations: [],
          };
          if (working.dependencyDigest !== await dependencies(state)) throw new EditError("stale-draft", "Pack or host source changed since this draft began. Revalidate or discard it.");
          const build = working.pages.length ? buildDraft(state, working) : null;
          if (build?.stale.length) throw new EditError("stale-draft", `Revalidate the draft first: ${build.stale.map(entry => entry.reason).join(" ")}`);
          if (working.operations.length + request.operations.length > MAX_DRAFT_OPERATIONS) throw new EditError("draft-full", "The shared draft has too many operations. Apply or discard it first.");
          if (new Set([...working.pages.map(entry => pageKey(entry.page)), ...request.operations.map(operation => pageKey(operation.page))]).size > MAX_REVIEWED_CHANGES) throw new EditError("draft-full", `One draft can change at most ${MAX_REVIEWED_CHANGES} pages. Apply or discard it first.`);
          const added: DraftOperation[] = [];
          for (const operation of request.operations) {
            if (!working.pages.some(entry => pageKey(entry.page) === pageKey(operation.page))) working.pages.push(resolvePageEntry(state, operation.page));
            const resolved = await toOperation(state, working, operation, request.provenance, payloads);
            working.operations.push(resolved); added.push(resolved);
            // Validate incrementally so the refused operation is named precisely.
            const next = buildDraft(state, working);
            if (next.stale.length) throw new EditError("unsupported-scope", next.stale.map(entry => entry.reason).join(" "));
          }
          working.revision += 1; working.updatedAt = now;
          if (!active()) throw new EditError("run-inactive", "The reply was stopped; its proposal was not added to the draft.");
          await drafts.write(working);
          if (!draft) await drafts.select(state.workspaceId, working.id, false);
          return { ...await view(state, working), added: added.map(operation => operation.id) };
        });
      });
    },
    async withdraw(input: unknown) {
      const request = parse(draftRefSchema.extend({ changeId: name, cascade: z.boolean().optional() }).strict(), input);
      return context.leased(async () => {
        const drafts = await store();
        return drafts.serial(async () => {
          const state = await selected(request.workspaceId);
          const { draft } = await loadOpen(state, request);
          const build = buildDraft(state, draft);
          if (build.stale.length) throw new EditError("stale-draft", "Revalidate the draft before withdrawing changes.");
          const change = build.changes.find(candidate => candidate.id === request.changeId);
          if (!change) throw new EditError("not-found", "That change is no longer in the draft.");
          const result = withdrawOperations(state, draft, change);
          if (result.dependents.length && !request.cascade) return { requiresCascade: true, dependents: result.dependents.map(operation => ({ id: operation.id, kind: operation.kind, page: operation.page, reason: operation.reason ?? null })) };
          const operations = result.remaining;
          const next: SharedDraft = { ...draft, operations, pages: draft.pages.filter(page => operations.some(operation => operation.recordId === page.before.id)), revision: draft.revision + 1, updatedAt: new Date().toISOString() };
          await drafts.write(next);
          return view(state, next);
        });
      });
    },
    async discard(input: unknown) {
      const request = parse(draftRefSchema, input);
      return context.leased(async () => {
        const drafts = await store();
        return drafts.serial(async () => {
          const state = await selected(request.workspaceId);
          const { draft } = await loadOpen(state, request);
          await drafts.write({ ...draft, status: "discarded", updatedAt: new Date().toISOString() });
          await drafts.select(state.workspaceId, null, true);
          return view(state, null);
        });
      });
    },
    async revalidate(input: unknown) {
      const request = parse(draftRefSchema, input);
      return context.leased(async () => {
        const drafts = await store();
        return drafts.serial(async () => {
          const state = await selected(request.workspaceId);
          const { draft } = await loadOpen(state, request);
          // Explicit rebase: replay onto current pages; operations that no longer apply are reported, not hidden.
          const pages: DraftPage[] = [], dropped: { id: string; reason: string }[] = [];
          for (const page of draft.pages) {
            try { pages.push(resolvePageEntry(state, page.page)); } catch (error) { for (const operation of draft.operations.filter(operation => operation.recordId === page.before.id)) dropped.push({ id: operation.id, reason: error instanceof Error ? error.message : "Page unavailable." }); }
          }
          const operations: DraftOperation[] = [];
          for (const operation of draft.operations) {
            const page = pages.find(entry => pageKey(entry.page) === pageKey(operation.page));
            if (!page) continue;
            const moved = { ...operation, recordId: page.before.id };
            const pins = moved.kind === "updateField" ? (moved.source?.assetPin ? [moved.source.assetPin] : []) : moved.assetPins ?? [];
            let pinsCurrent = true;
            for (const pin of pins) { try { pinsCurrent &&= sameJson(await context.pinAsset(state, pin.assetId), pin); } catch { pinsCurrent = false; } }
            if (!pinsCurrent) { dropped.push({ id: operation.id, reason: "A referenced image changed or is no longer available; propose it again." }); continue; }
            try { buildDraft(state, { pages, operations: [...operations, moved] }); operations.push(moved); }
            catch (error) { dropped.push({ id: operation.id, reason: error instanceof Error ? error.message : "No longer applies." }); }
          }
          const next: SharedDraft = { ...draft, pages: pages.filter(page => operations.some(operation => operation.recordId === page.before.id)), operations, dependencyDigest: await dependencies(state), revision: draft.revision + 1, updatedAt: new Date().toISOString() };
          await drafts.write(next);
          return { ...await view(state, next), dropped };
        });
      });
    },
    async apply(input: unknown): Promise<DraftReceipt> {
      const request = parse(draftRefSchema.extend({ approve: z.string().regex(/^[a-f0-9]{64}$/) }).strict(), input);
      if (context.permission !== "apply") throw new EditError("approval-denied", "This host permits Assistant proposals and review, but not Apply.");
      return context.leased(async () => {
        const drafts = await store();
        return drafts.serial(async () => {
          const initial = await selected(request.workspaceId);
          const current = await reconcile(initial, await drafts.read(request.draftId));
          if (current?.status === "applied" && current.revision === request.revision && current.applied?.candidateDigest === request.approve) {
            const prior = await initial.stores.compositions.reviewedEditReceipt<DraftReceipt>(current.applied.operationId);
            if (prior) return prior;
          }
          const { draft } = await loadOpen(initial, request);
          const receipt = await context.barriers(initial, async () => {
            const state = await context.capture();
            if (state.workspaceId !== draft.workspaceId) throw new EditError("wrong-workspace", "The selected workspace changed.");
            if (await dependencies(state) !== draft.dependencyDigest) throw new EditError("stale-plan", "Pack or host source changed. Revalidate and review again; approval cannot be rebased.");
            const build = buildDraft(state, draft);
            if (build.stale.length) throw new EditError("stale-draft", build.stale.map(entry => entry.reason).join(" "));
            const digest = candidateDigest(draft, build);
            if (digest !== request.approve) throw new EditError("approval-mismatch", "Approval must quote the exact reviewed candidate digest.");
            for (const pin of assetPins(draft)) if (!sameJson(await context.pinAsset(state, pin.assetId), pin)) throw new EditError("stale-asset", "A reviewed image changed.");
            const changed = build.pages.filter(page => page.changed);
            if (!changed.length) throw new EditError("empty-draft", "The draft has no remaining changes.");
            const operationId = applyOperationId(draft);
            const value: DraftReceipt = {
              schemaVersion: 1, kind: "draft-applied", operationId, draftId: draft.id, revision: draft.revision, candidateDigest: digest, workspaceId: draft.workspaceId, committedAt: new Date().toISOString(),
              pages: changed.map(page => ({ identity: page.identity, beforeDigest: context.digest(page.before), afterDigest: context.digest(page.candidate), jsxDigest: context.digest(page.jsx) })),
            };
            return state.stores.compositions.commitReviewedEdit({ operationId, planDigest: digest, expectedSnapshotToken: state.tokens.compositions, changes: changed.map(page => ({ candidate: page.candidate, jsx: page.jsx })), receipt: value }, async () => {
              if (await dependencies(state) !== draft.dependencyDigest) throw new EditError("stale-plan", "Pack or source changed at the writer boundary.");
            });
          });
          await drafts.write({ ...draft, status: "applied", applied: { operationId: receipt.operationId, candidateDigest: receipt.candidateDigest, committedAt: receipt.committedAt }, updatedAt: new Date().toISOString() });
          await drafts.select(draft.workspaceId, draft.id, true);
          return receipt;
        });
      });
    },
    async receipt(input: unknown) {
      const { workspaceId, draftId } = parse(workspaceSchema.extend({ draftId: name }).strict(), input);
      const drafts = await store();
      return drafts.serial(async () => {
      const state = await selected(workspaceId);
      const draft = await reconcile(state, await drafts.read(draftId));
      if (!draft || draft.workspaceId !== state.workspaceId || draft.host !== await context.host()) throw new EditError("wrong-workspace", "Draft belongs to another site.");
      return {
        status: draft.status,
        applied: draft.applied ? await state.stores.compositions.reviewedEditReceipt<DraftReceipt>(draft.applied.operationId) ?? null : null,
        undone: draft.undone ? await state.stores.compositions.reviewedEditReceipt<DraftReceipt>(draft.undone.operationId) ?? null : null,
      };
      });
    },
    async undo(input: unknown): Promise<DraftReceipt> {
      const request = parse(workspaceSchema.extend({ draftId: name, approve: z.string().regex(/^[a-f0-9]{64}$/) }).strict(), input);
      if (context.permission !== "apply") throw new EditError("approval-denied", "This host does not permit Assistant commits.");
      return context.leased(async () => {
        const drafts = await store();
        return drafts.serial(async () => {
          const initial = await selected(request.workspaceId);
          const draft = await reconcile(initial, await drafts.read(request.draftId));
          if (!draft || draft.workspaceId !== initial.workspaceId) throw new EditError("wrong-workspace", "Draft belongs to another site.");
          if (draft.status === "undone") { const prior = await initial.stores.compositions.reviewedEditReceipt<DraftReceipt>(draft.undone!.operationId); if (prior) return prior; }
          if (draft.status !== "applied" || !draft.applied) throw new EditError("not-applied", "Only an applied draft can be undone.");
          if (draft.applied.candidateDigest !== request.approve) throw new EditError("approval-mismatch", "Quote the applied candidate digest for guarded Undo.");
          const receipt = await context.barriers(initial, async () => {
            const state = await context.capture();
            const applied = await state.stores.compositions.reviewedEditReceipt<DraftReceipt>(draft.applied!.operationId);
            if (!applied || applied.candidateDigest !== request.approve) throw new EditError("tampered-plan", "Draft and durable receipt disagree; undo refused.");
            const before = new Map<string, import("../../src/composer/library/types").CompositionRecord>();
            for (const entry of applied.pages) {
              const page = draft.pages.find(candidate => candidate.before.id === entry.identity.recordId);
              if (!page || context.digest(page.before) !== entry.beforeDigest) throw new EditError("tampered-plan", "Draft and durable receipt disagree; undo refused.");
              const current = state.records.compositions.find(record => record.id === entry.identity.recordId);
              if (!current || context.digest(current) !== entry.afterDigest) throw new EditError("undo-conflict", `A later edit changed ${entry.identity.pageId}. Undo will not overwrite it.`);
              before.set(page.before.id, page.before);
            }
            const output = jsxFor(state, before);
            const changes = [...before.values()].map(record => {
              const generated = output.get(record.id);
              if (!generated || generated.status !== "generated") throw new EditError("undo-conflict", "Current pack/template cannot safely render the prior page.");
              return { candidate: record, jsx: generated.code };
            });
            const undoRevisions = await dependencies(state);
            const value: DraftReceipt = { ...applied, kind: "draft-undone", operationId: undoOperationId(draft), committedAt: new Date().toISOString(), pages: applied.pages.map(page => ({ ...page, beforeDigest: page.afterDigest, afterDigest: page.beforeDigest, jsxDigest: context.digest(changes.find(change => change.candidate.id === page.identity.recordId)!.jsx) })) };
            return state.stores.compositions.commitReviewedEdit({ operationId: value.operationId, planDigest: request.approve, expectedSnapshotToken: state.tokens.compositions, changes, receipt: value }, async () => {
              if (await dependencies(state) !== undoRevisions) throw new EditError("undo-conflict", "Pack or source changed at the undo writer boundary.");
            });
          });
          await drafts.write({ ...draft, status: "undone", undone: { operationId: receipt.operationId, committedAt: receipt.committedAt }, updatedAt: new Date().toISOString() });
          await drafts.select(draft.workspaceId, draft.id, true);
          return receipt;
        });
      });
    },
    /** Compact, authorized page description for model inspection; no host paths or JSX. */
    async describePage(input: unknown) {
      const request = parse(workspaceSchema.extend({ page: pageRefSchema, draftId: name.nullable().optional() }).strict(), input);
      const state = await selected(request.workspaceId);
      const resolved = resolvePage(state, { workspaceId: state.workspaceId, sitemapId: request.page.sitemapId, page: request.page.pageId });
      // Read-only: the draft is not reconciled here, only an open draft of this host contributes its candidate.
      const stored = request.draftId ? await (await store()).read(request.draftId) : null;
      const draft = stored && stored.host === await context.host() && stored.workspaceId === state.workspaceId ? stored : null;
      const candidate = draft?.status === "open" && draft.pages.some(entry => pageKey(entry.page) === pageKey(request.page)) ? buildDraft(state, draft).pages.find(entry => pageKey(entry.page) === pageKey(request.page))?.candidate.document : undefined;
      return { resolved, document: candidate ?? resolved.record.document, inDraft: !!candidate };
    },
  };
}
export type DraftOperations = ReturnType<typeof createDraftOperations>;
export type { CompositionDocument };
