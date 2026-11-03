// Durable Content-AI proposal records: immutable, create-only JSON documents in
// a private directory of their own. They hold no editable Content; whether a
// proposal was applied or undone is read from the Content store's receipts.
import { createHash } from "node:crypto";
import { SafeRootFilesystem, commitDocument, type DurableExtraErrorCode } from "../../../shared/node-fs";
import { EditorialError, type ContentAiProposalRecord, type ContentAiProposalStore } from "../../editorial";

const ID = /^[A-Za-z0-9-]{8,80}$/;

export async function openContentAiProposalStore(root: string): Promise<ContentAiProposalStore> {
  const fs = await SafeRootFilesystem.create<"content-ai", DurableExtraErrorCode>({
    root, initializeOperation: "content-ai", rootLabel: "Content-AI proposals", ownerLabel: "Content-AI", recordLabel: "proposal",
    errors: {
      isError: (value) => value instanceof EditorialError,
      create: (_operation, _code, message) => new EditorialError("unavailable", message),
      rethrow: (_operation, _code, message, cause): never => { if (cause instanceof EditorialError) throw cause; throw new EditorialError("unavailable", message); },
    },
  });
  // The file name is derived from the id, so a request can never name a path.
  const path = (id: string) => fs.ownedPath(`proposal-${createHash("sha256").update(id).digest("hex").slice(0, 40)}.json`);
  const read = async (id: string): Promise<ContentAiProposalRecord | null> => {
    if (!ID.test(id)) return null;
    const file = await fs.readFileNoFollow("content-ai", path(id));
    if (!file) return null;
    let value: ContentAiProposalRecord;
    try { value = JSON.parse(file.text) as ContentAiProposalRecord; } catch { throw new EditorialError("unavailable", "A Content-AI proposal record is unreadable; it was preserved."); }
    if (value?.schemaVersion !== 1 || value.proposal?.id !== id) throw new EditorialError("unavailable", "A Content-AI proposal record has an unknown shape; it was preserved.");
    return value;
  };
  let queue: Promise<unknown> = Promise.resolve();
  return {
    read,
    create(record) {
      const next = queue.then(async () => {
        if (!ID.test(record.proposal.id)) throw new EditorialError("invalid-request", "Malformed proposal id.");
        if (await read(record.proposal.id)) throw new EditorialError("operation-key-reuse", "A proposal with this id already exists.");
        await commitDocument(fs, "content-ai", path(record.proposal.id), `${JSON.stringify(record)}\n`);
      });
      queue = next.catch(() => {});
      return next;
    },
  };
}
