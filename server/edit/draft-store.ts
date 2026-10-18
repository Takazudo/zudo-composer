import { createHash } from "node:crypto";
import { join } from "node:path";
import { SafeRootFilesystem, commitDocument, type DurableExtraErrorCode } from "../../src/shared/node-fs";
import { EditError } from "./plans";
import type { SharedDraft } from "./draft-model";

interface WorkspaceDraftState { schemaVersion: 1; workspaceId: string; generation: number; currentDraftId: string | null }

/**
 * Private authoring state for shared drafts. One state file per workspace
 * selects the open draft; draft revisions are whole-document CAS commits.
 * Nothing here is canonical Composition data.
 */
export async function openDraftStore(dataRoot: string) {
  const fs = await SafeRootFilesystem.create<"edit", DurableExtraErrorCode>({
    root: join(dataRoot, "edit-drafts"), initializeOperation: "edit", rootLabel: "Edit drafts", ownerLabel: "Edit drafts", recordLabel: "draft",
    errors: {
      isError: value => value instanceof EditError,
      create: (_op, code, message) => new EditError(code, message),
      rethrow: (_op, code, message, cause): never => { if (cause instanceof EditError) throw cause; throw new EditError(code, message); },
    },
  });
  // Workspace ids are opaque registry values; hashing keeps the path closed.
  const statePath = (workspaceId: string) => fs.ownedPath(`workspace-${createHash("sha256").update(workspaceId).digest("hex").slice(0, 40)}.state.json`);
  const draftPath = (id: string) => {
    if (!/^draft-[a-f0-9-]{36}$/.test(id)) throw new EditError("invalid-request", "Invalid draft identifier.");
    return fs.ownedPath(`${id}.draft.json`);
  };
  const readJson = async <T>(path: string): Promise<T | undefined> => {
    const value = await fs.readFileNoFollow("edit", path);
    if (!value) return undefined;
    try { return JSON.parse(value.text) as T; } catch { throw new EditError("store-corrupt", "Shared draft storage is unreadable; preserve it and recover explicitly."); }
  };
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(action: () => Promise<T>): Promise<T> => { const next = queue.then(action, action); queue = next.catch(() => {}); return next; };
  const state = async (workspaceId: string): Promise<WorkspaceDraftState> => {
    const value = await readJson<WorkspaceDraftState>(statePath(workspaceId));
    if (!value) return { schemaVersion: 1, workspaceId, generation: 0, currentDraftId: null };
    if (value.schemaVersion !== 1 || value.workspaceId !== workspaceId || !Number.isSafeInteger(value.generation)) throw new EditError("store-corrupt", "Shared draft state has an unknown schema.");
    return value;
  };
  return {
    serial,
    state,
    async read(id: string): Promise<SharedDraft> {
      const draft = await readJson<SharedDraft>(draftPath(id));
      if (!draft) throw new EditError("not-found", "Draft not found in this host.");
      if (draft.schemaVersion !== 1 || draft.kind !== "assistant-shared-draft" || draft.id !== id) throw new EditError("store-corrupt", "Shared draft has an unknown schema.");
      return draft;
    },
    async current(workspaceId: string): Promise<SharedDraft | null> {
      const value = await state(workspaceId);
      return value.currentDraftId ? this.read(value.currentDraftId) : null;
    },
    async write(draft: SharedDraft) { await commitDocument(fs, "edit", draftPath(draft.id), `${JSON.stringify(draft, null, 2)}\n`); },
    async select(workspaceId: string, currentDraftId: string | null, bumpGeneration: boolean) {
      const previous = await state(workspaceId);
      const next: WorkspaceDraftState = { schemaVersion: 1, workspaceId, generation: previous.generation + (bumpGeneration ? 1 : 0), currentDraftId };
      await commitDocument(fs, "edit", statePath(workspaceId), `${JSON.stringify(next)}\n`);
      return next;
    },
  };
}
export type DraftStore = Awaited<ReturnType<typeof openDraftStore>>;
