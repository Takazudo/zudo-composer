import { join } from "node:path";
import { SafeRootFilesystem, commitDocument, withMutationBarrier, type DurableExtraErrorCode } from "../../src/shared/node-fs";
import { EditError } from "../edit/plans";
import { editDigest } from "../edit/service";

/** Private, create-only envelopes. Domain receipts remain the status authority. */
export async function openHostReviewStore<T extends { id: string }>(dataRoot: string) {
  const root = join(dataRoot, "assistant-host-reviews");
  const fs = await SafeRootFilesystem.create<"review", DurableExtraErrorCode>({ root, initializeOperation: "review", rootLabel: "Assistant reviews", ownerLabel: "Assistant", recordLabel: "review", errors: {
    isError: value => value instanceof EditError,
    create: (_operation, code, message) => new EditError(code, message),
    rethrow: (_operation, code, message): never => { throw new EditError(code, message); },
  } });
  const path = (id: string) => { if (!/^review-[a-f0-9]{64}$/.test(id)) throw new EditError("invalid-request", "Invalid review identifier."); return fs.ownedPath(`${id}.json`); };
  const read = async (id: string): Promise<T | null> => {
    const file = await fs.readFileNoFollow("review", path(id));
    if (!file) return null;
    let value: T;
    try { value = JSON.parse(file.text) as T; } catch { throw new EditError("store-corrupt", "Stored host review is unreadable; preserve it for recovery."); }
    if (value.id !== id) throw new EditError("store-corrupt", "Stored host review identity differs.");
    return value;
  };
  return { read, create: async (input: T): Promise<T> => {
    const value = structuredClone(input);
    return withMutationBarrier(root, async () => {
      const prior = await read(value.id);
      if (prior) { if (editDigest(prior) !== editDigest(value)) throw new EditError("conflict", "Review identity was reused with different content."); return prior; }
      try { await commitDocument(fs, "review", path(value.id), JSON.stringify(value)); }
      catch (error) { const recovered = await read(value.id).catch(() => null); if (recovered && editDigest(recovered) === editDigest(value)) return recovered; throw error; }
      return value;
    });
  } };
}
