// The browser half of the expected-revision save path.
//
// One session holds the authoritative draft identity the editor last proved
// (`draftRevision` + `baselineRevision`) and at most one outstanding
// operation. A save freezes one request — the changed permitted values of one
// Entry, the revision it was prepared against and a freshly minted operation
// id — and keeps that exact request until its outcome is known:
//
//   - `ok`: the durable receipt is the only thing that marks a save `saved`.
//   - `conflict`: nothing was written. The authoritative draft is reread and
//     adopted, and a `ContentEntryWriteConflict` hands the preserved local
//     Entry to the controller's explicit use-latest / reapply-mine recovery.
//   - `uncertain` or a transport failure: the write may have landed. The
//     session is `recovering` and resolves the ORIGINAL operation (receipt
//     read, then an identical retry under the same id) before it sends any
//     later edit. It never retries "whatever is newest" under a new id.
//   - `unavailable`: no write was proven; the same operation is retried.
//   - `refused` / `rejected` / `not-found`: definitive; nothing was written.

import type { JsonValue } from "@zudo-composer/component-contract";
import type { ContentEntryRecord } from "../../content/model";
import { ContentEntryWriteConflict } from "../content/controller";
import type { ContentEditorApplyInput, ContentEditorStorage, HostContentApplyResult } from "../../hosted-content/editor-service";
import type { ContentMutationRefusalCode } from "../../hosted-content/policy";
import type { ContentDraftConflictReason, ContentDraftState, ContentOperationReceipt, ContentSnapshotRecord } from "../../hosted-content/storage";

export type ContentEditorSaveState =
  | { readonly status: "loading" }
  | { readonly status: "load-failed"; readonly message: string }
  /** The host's definitions were built for another baseline; editing needs developer reconciliation. */
  | { readonly status: "blocked"; readonly message: string; readonly baselineRevision: string }
  | { readonly status: "clean"; readonly revision: number }
  | { readonly status: "saving"; readonly revision: number; readonly operationId: string }
  | { readonly status: "saved"; readonly revision: number; readonly receipt: ContentOperationReceipt }
  | { readonly status: "recovering"; readonly revision: number; readonly operationId: string; readonly message: string }
  | { readonly status: "conflict"; readonly revision: number; readonly reason: ContentDraftConflictReason; readonly message: string; readonly authoritativeLoaded: boolean }
  | { readonly status: "failed"; readonly revision: number; readonly message: string; readonly code?: ContentMutationRefusalCode | string; readonly retryable: boolean };

export interface ContentEditorPendingOperation {
  readonly input: ContentEditorApplyInput;
  /** The authoritative Entry the request was diffed against: the conflict merge base. */
  readonly base: ContentEntryRecord;
}

export interface ContentEditorSessionOptions {
  readonly storage: ContentEditorStorage;
  readonly projectId: string;
  readonly providerId: string;
  /** The baseline the host's definitions were built for; a different stored baseline blocks editing. */
  readonly expectedBaselineRevision?: string;
  readonly operationId?: () => string;
  /** Called with every adopted authoritative draft, before listeners hear the new state. */
  readonly onAuthoritative?: (draft: ContentDraftState) => void;
}

export interface ContentEditorSession {
  readonly state: ContentEditorSaveState;
  readonly draft: ContentDraftState | null;
  readonly pending: ContentEditorPendingOperation | null;
  subscribe(listener: (state: ContentEditorSaveState) => void): () => void;
  load(): Promise<void>;
  /** The controller's Entry writer. Resolves only on a durable receipt. */
  writeEntry(record: ContentEntryRecord): Promise<void>;
  /** Resolve an outstanding operation without sending anything new. */
  recover(): Promise<boolean>;
  /** Reread and adopt the authoritative draft; local form values are the controller's to keep or drop. */
  reloadAuthoritative(): Promise<void>;
  /** The user chose the authoritative draft after a conflict. */
  acknowledgeConflict(): void;
  /** Capture an immutable snapshot of exactly the adopted revision. */
  captureSnapshot(): Promise<ContentSnapshotRecord>;
  dispose(): void;
}

const sameJson = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

/** The changed values of one Entry; `null` clears a value the authoritative Entry holds. */
export function changedEntryValues(base: ContentEntryRecord, next: ContentEntryRecord): Record<string, JsonValue> {
  const changed: Record<string, JsonValue> = {};
  for (const fieldId of new Set([...Object.keys(base.values), ...Object.keys(next.values)])) {
    const before = base.values[fieldId];
    const after = next.values[fieldId];
    if (after === undefined) { if (before !== undefined) changed[fieldId] = null; continue; }
    if (before === undefined || !sameJson(before, after)) changed[fieldId] = structuredClone(after);
  }
  return changed;
}

function defaultOperationId(): string {
  return `edit-${globalThis.crypto.randomUUID()}`;
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function createContentEditorSession(options: ContentEditorSessionOptions): ContentEditorSession {
  const { storage } = options;
  const mint = options.operationId ?? defaultOperationId;
  const listeners = new Set<(state: ContentEditorSaveState) => void>();
  let state: ContentEditorSaveState = { status: "loading" };
  let draft: ContentDraftState | null = null;
  let pending: ContentEditorPendingOperation | null = null;
  /** The merge base of the last conflict, kept until its latest records are loaded. */
  let conflictBase: ContentEntryRecord | null = null;
  let disposed = false;

  const set = (next: ContentEditorSaveState): void => {
    state = next;
    if (disposed) return;
    for (const listener of [...listeners]) listener(next);
  };
  const revision = (): number => draft?.draftRevision ?? 0;
  const adopt = (next: ContentDraftState): void => {
    draft = structuredClone(next);
    options.onAuthoritative?.(draft);
  };
  const fail = (message: string, retryable: boolean, code?: string): never => {
    set({ status: "failed", revision: revision(), message, retryable, ...(code ? { code } : {}) });
    throw new Error(message);
  };

  /** Reread the authoritative draft; false when the read itself failed. */
  async function reread(): Promise<boolean> {
    try {
      const result = await storage.read();
      if (result.status !== "ok") return false;
      adopt(result.value);
      return true;
    } catch {
      return false;
    }
  }

  async function conflicted(reason: ContentDraftConflictReason, base: ContentEntryRecord): Promise<never> {
    conflictBase = base;
    const loaded = await reread();
    const message = reason === "baseline-revision"
      ? "The published site changed since this draft was loaded. Review the latest content before saving again."
      : "Someone else saved this content first. Choose whether to keep the latest version or reapply your changes.";
    set({ status: "conflict", revision: revision(), reason, message, authoritativeLoaded: loaded });
    // Without the latest records the controller would offer a stale "latest";
    // a plain failure keeps the draft and retries the reread on the next save.
    if (!loaded) throw new Error(`${message} The latest version could not be loaded; retry to load it.`);
    throw new ContentEntryWriteConflict(message, base);
  }

  /** Apply the outcome of sending `operation`. Resolves on a receipt, throws otherwise. */
  async function settle(operation: ContentEditorPendingOperation, result: HostContentApplyResult): Promise<void> {
    switch (result.status) {
      case "ok":
        pending = null;
        adopt(result.value.draft);
        set({ status: "saved", revision: result.value.receipt.draftRevision, receipt: result.value.receipt });
        return;
      case "conflict":
        pending = null;
        if (result.reason === "operation-id") fail("This save was already used for different changes. Reload the latest version and edit again.", false, "operation-id");
        return conflicted(result.reason, operation.base);
      case "refused":
        pending = null;
        return fail(result.refusal.message, false, result.refusal.code);
      case "rejected":
        pending = null;
        return fail(result.message, false, result.code);
      case "not-found":
        pending = null;
        return fail("The draft is no longer available.", false, "not-found");
      case "unavailable":
        // No write was proven either way; the identical operation is retried.
        return fail(`Saving is unavailable: ${result.message}`, true, "unavailable");
      case "uncertain":
        set({ status: "recovering", revision: revision(), operationId: operation.input.operationId, message: result.message });
        if (await resolve(operation, false)) return;
        throw new Error("The save may have reached the server, but its outcome is not confirmed yet. Retry to confirm it; your changes are kept.");
    }
  }

  async function send(operation: ContentEditorPendingOperation): Promise<void> {
    set({ status: "saving", revision: revision(), operationId: operation.input.operationId });
    let result: HostContentApplyResult;
    try { result = await storage.apply(operation.input); }
    catch (cause) { result = { status: "uncertain", message: messageOf(cause), operationId: operation.input.operationId }; }
    await settle(operation, result);
  }

  /**
   * Resolve the original operation: a receipt proves it, then an authoritative
   * reread is adopted. No receipt yet means it may still land or never did, so
   * the identical request is retried under the same id when `retry` is set.
   */
  async function resolve(operation: ContentEditorPendingOperation, retry: boolean): Promise<boolean> {
    set({ status: "recovering", revision: revision(), operationId: operation.input.operationId, message: "Confirming the last save…" });
    let receipt: Awaited<ReturnType<ContentEditorStorage["readReceipt"]>>;
    try { receipt = await storage.readReceipt(operation.input.operationId); }
    catch (cause) { set({ status: "recovering", revision: revision(), operationId: operation.input.operationId, message: messageOf(cause) }); return false; }
    if (receipt.status === "ok") {
      if (!(await reread())) {
        set({ status: "recovering", revision: revision(), operationId: operation.input.operationId, message: "The save was recorded, but the latest version could not be loaded." });
        return false;
      }
      pending = null;
      set({ status: "saved", revision: receipt.value.draftRevision, receipt: receipt.value });
      return true;
    }
    if (receipt.status === "unavailable" || !retry) {
      set({ status: "recovering", revision: revision(), operationId: operation.input.operationId, message: receipt.status === "unavailable" ? receipt.message : "The save is not confirmed yet." });
      return false;
    }
    try { await send(operation); return true; }
    catch (cause) { if (cause instanceof ContentEntryWriteConflict) throw cause; return false; }
  }

  return {
    get state() { return state; },
    get draft() { return draft; },
    get pending() { return pending; },
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => { listeners.delete(listener); };
    },
    async load() {
      set({ status: "loading" });
      let result: Awaited<ReturnType<ContentEditorStorage["read"]>>;
      try { result = await storage.read(); }
      catch (cause) { set({ status: "load-failed", message: messageOf(cause) }); return; }
      if (result.status !== "ok") { set({ status: "load-failed", message: result.status === "unavailable" ? result.message : "No draft exists for this site." }); return; }
      if (result.value.snapshot.providerId !== options.providerId) { set({ status: "load-failed", message: "The draft belongs to another Content provider." }); return; }
      if (options.expectedBaselineRevision !== undefined && result.value.baselineRevision !== options.expectedBaselineRevision) {
        set({ status: "blocked", baselineRevision: result.value.baselineRevision, message: "The stored draft was made for a different site version. A developer must reconcile it before editing continues." });
        return;
      }
      adopt(result.value);
      set({ status: "clean", revision: result.value.draftRevision });
    },
    async writeEntry(record) {
      if (!draft || state.status === "loading" || state.status === "load-failed" || state.status === "blocked") throw new Error("Content is not loaded.");
      if (pending) {
        const resolved = await resolve(pending, true);
        if (!resolved) throw new Error(state.status === "failed" ? state.message : "The previous save is not confirmed yet. Retry to confirm it; your changes are kept.");
      }
      if (state.status === "conflict" && !state.authoritativeLoaded) {
        if (!(await reread())) throw new Error("The latest version could not be loaded; retry to load it.");
        set({ ...state, authoritativeLoaded: true });
        throw new ContentEntryWriteConflict(state.message, conflictBase);
      }
      const base = draft.snapshot.entries.find((entry) => entry.id === record.id && entry.modelId === record.modelId);
      if (!base) return fail("This entry no longer exists in the draft.", false, "not-found");
      const values = changedEntryValues(base, record);
      if (Object.keys(values).length === 0) {
        if (state.status !== "saved") set({ status: "clean", revision: revision() });
        return;
      }
      const operation: ContentEditorPendingOperation = {
        base,
        input: {
          operationId: mint(),
          expectedBaselineRevision: draft.baselineRevision,
          request: { kind: "put-entry-values", projectId: options.projectId, providerId: options.providerId, modelId: record.modelId, entryId: record.id, values, expectedRevision: draft.draftRevision },
        },
      };
      pending = operation;
      await send(operation);
    },
    async recover() {
      return pending ? resolve(pending, true).catch(() => false) : true;
    },
    async reloadAuthoritative() {
      if (pending) throw new Error("Confirm the last save before reloading.");
      if (!(await reread())) throw new Error("The latest version could not be loaded.");
      set({ status: "clean", revision: revision() });
    },
    acknowledgeConflict() {
      if (state.status === "conflict" && state.authoritativeLoaded) set({ status: "clean", revision: revision() });
    },
    async captureSnapshot() {
      if (!draft) throw new Error("Content is not loaded.");
      if (pending) throw new Error("Confirm the last save before previewing.");
      const result = await storage.snapshot({ expectedDraftRevision: draft.draftRevision });
      if (result.status === "ok") return result.value;
      if (result.status === "conflict") {
        await reread();
        throw new Error("The draft changed before the preview was captured. Review the latest version and preview again.");
      }
      throw new Error(result.status === "unavailable" || result.status === "uncertain" || result.status === "rejected" ? result.message : "The draft is no longer available.");
    },
    dispose() {
      disposed = true;
      listeners.clear();
    },
  };
}
