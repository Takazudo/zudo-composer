import { createHash } from "node:crypto";
import { CompositionPersistenceError, isSafeCompositionRecordId, validateCompositionRecord, type CompositionPersistenceOperation, type CompositionRecord } from "../../library";
import { COMMIT_UNCERTAIN, commitDocument, syncDirectory, type DurableExtraErrorCode, type SafeRootFilesystem } from "../../../shared/node-fs";

export interface ReviewedCompositionEdit<T extends object> {
  operationId: string;
  planDigest: string;
  expectedSnapshotToken: string;
  candidate: CompositionRecord;
  jsx: string;
  receipt: T;
}
interface Entry { name: string; before: string | null; after: string }
interface Journal { schemaVersion: 1; operationId: string; planDigest: string; entries: Entry[]; receipt: string }
interface ReceiptEnvelope { schemaVersion: 1; operationId: string; planDigest: string; value: object }
const JOURNAL = ".reviewed-edit-journal.json";
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const validDigest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const fail = (operation: CompositionPersistenceOperation, message: string): never => { throw new CompositionPersistenceError(operation, "blocked", message, false); };

/** Prepared journal is irrevocable intent. Cooperating readers recover it before reading any files. */
export class ReviewedEditJournal {
  constructor(private readonly fs: SafeRootFilesystem<CompositionPersistenceOperation, DurableExtraErrorCode>) {}
  private receiptName(id: string): string {
    if (!isSafeCompositionRecordId(id)) throw new CompositionPersistenceError("put", "validation", "Reviewed operation id must be path-safe.", false);
    return `.reviewed-edit-${id}.receipt.json`;
  }
  private async envelope(operation: CompositionPersistenceOperation, id: string): Promise<ReceiptEnvelope | undefined> {
    const file = await this.fs.readFileNoFollow(operation, this.fs.ownedPath(this.receiptName(id)));
    if (!file) return;
    let parsed: ReceiptEnvelope;
    try { parsed = JSON.parse(file.text); } catch { return fail(operation, "Reviewed edit receipt is invalid; explicit recovery is required."); }
    if (!parsed || parsed.schemaVersion !== 1 || parsed.operationId !== id || !validDigest(parsed.planDigest) || !parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) return fail(operation, "Reviewed edit receipt is invalid; explicit recovery is required.");
    return parsed;
  }
  async receipt<T extends object>(operation: CompositionPersistenceOperation, id: string): Promise<T | undefined> {
    return (await this.envelope(operation, id))?.value as T | undefined;
  }
  async matchingReceipt<T extends object>(operation: CompositionPersistenceOperation, id: string, planDigest: string): Promise<T | undefined> {
    const existing = await this.envelope(operation, id);
    if (existing && existing.planDigest !== planDigest) throw new CompositionPersistenceError(operation, "conflict", "Operation id already belongs to a different reviewed plan.", false);
    return existing?.value as T | undefined;
  }
  async commit<T extends object>(operation: CompositionPersistenceOperation, edit: ReviewedCompositionEdit<T>): Promise<T> {
    this.receiptName(edit.operationId);
    if (!validDigest(edit.planDigest) || !validDigest(edit.expectedSnapshotToken) || typeof edit.jsx !== "string" || !edit.receipt || typeof edit.receipt !== "object" || Array.isArray(edit.receipt)) throw new CompositionPersistenceError(operation, "validation", "Invalid reviewed edit identity, output, or receipt.", false);
    const entries: Entry[] = [];
    for (const [name, after] of [
      [`composition-${edit.candidate.id}.composition.json`, `${JSON.stringify(edit.candidate, null, 2)}\n`],
      [`composition-${edit.candidate.id}.tsx`, edit.jsx],
    ]) {
      const before = await this.fs.readFileNoFollow(operation, this.fs.ownedPath(name!));
      entries.push({ name: name!, before: before ? digest(before.text) : null, after: after! });
    }
    const receipt = JSON.stringify({ schemaVersion: 1, operationId: edit.operationId, planDigest: edit.planDigest, value: edit.receipt } satisfies ReceiptEnvelope) + "\n";
    const journal: Journal = { schemaVersion: 1, operationId: edit.operationId, planDigest: edit.planDigest, entries, receipt };
    // Before journal publication all failures preserve the canonical pair.
    try {
      await commitDocument(this.fs, operation, this.fs.ownedPath(JOURNAL), JSON.stringify(journal) + "\n");
    } catch (cause) {
      if (cause instanceof CompositionPersistenceError && cause.code === "commit-uncertain") Object.assign(cause, { operationId: edit.operationId });
      this.fs.errors.rethrow(operation, "write-failed", "Could not prepare reviewed edit journal.", cause);
    }
    await this.rollForward(operation, journal);
    return structuredClone(edit.receipt);
  }
  async recover(operation: CompositionPersistenceOperation): Promise<void> {
    const file = await this.fs.readFileNoFollow(operation, this.fs.ownedPath(JOURNAL));
    if (!file) return;
    let journal: Journal;
    try { journal = JSON.parse(file.text); } catch { return fail(operation, "Reviewed edit journal is malformed; preserve files and recover explicitly."); }
    this.validate(operation, journal);
    await this.rollForward(operation, journal);
  }
  private validate(operation: CompositionPersistenceOperation, journal: Journal): void {
    if (!journal || journal.schemaVersion !== 1 || !isSafeCompositionRecordId(journal.operationId) || !validDigest(journal.planDigest) || !Array.isArray(journal.entries) || journal.entries.length !== 2 || typeof journal.receipt !== "string") fail(operation, "Invalid reviewed edit journal; explicit recovery is required.");
    const [canonical, jsx] = journal.entries;
    if (!canonical || !jsx || typeof canonical.after !== "string" || typeof jsx.after !== "string") fail(operation, "Invalid reviewed edit entries.");
    let record: unknown;
    let receipt: ReceiptEnvelope;
    try { record = JSON.parse(canonical!.after); receipt = JSON.parse(journal.receipt); } catch { return fail(operation, "Invalid reviewed edit journal payload."); }
    const validation = validateCompositionRecord(record);
    if (!validation.ok || canonical!.name !== `composition-${validation.record.id}.composition.json` || jsx!.name !== `composition-${validation.record.id}.tsx` || journal.entries.some(entry => entry.before !== null && !validDigest(entry.before)) || !receipt! || receipt!.schemaVersion !== 1 || receipt!.operationId !== journal.operationId || receipt!.planDigest !== journal.planDigest || !receipt!.value || typeof receipt!.value !== "object" || Array.isArray(receipt!.value)) fail(operation, "Reviewed edit journal identity or payload mismatch.");
  }
  private async rollForward(operation: CompositionPersistenceOperation, journal: Journal): Promise<void> {
    try {
      // Validate every destination before any recovery write, preserving unexpected edits.
      const receiptPath = this.fs.ownedPath(this.receiptName(journal.operationId));
      const existingReceipt = await this.fs.readFileNoFollow(operation, receiptPath);
      if (existingReceipt && existingReceipt.text !== journal.receipt) fail(operation, "Reviewed edit receipt differs from prepared intent.");
      for (const entry of journal.entries) {
        const file = await this.fs.readFileNoFollow(operation, this.fs.ownedPath(entry.name));
        const current = file ? digest(file.text) : null;
        if (current !== entry.before && current !== digest(entry.after)) fail(operation, "Reviewed edit destination changed outside the transaction; explicit recovery is required.");
      }
      for (const entry of journal.entries) {
        const path = this.fs.ownedPath(entry.name);
        const file = await this.fs.readFileNoFollow(operation, path);
        if (file?.text !== entry.after) await commitDocument(this.fs, operation, path, entry.after);
      }
      if (!existingReceipt) await commitDocument(this.fs, operation, receiptPath, journal.receipt);
      // Even when replay finds all bytes present, prove their directory publication before cleanup.
      await syncDirectory(this.fs, operation, this.fs.realRoot);
      await this.fs.operations.unlink(this.fs.ownedPath(JOURNAL));
      await syncDirectory(this.fs, operation, this.fs.realRoot);
    } catch (cause) {
      throw Object.assign(new CompositionPersistenceError(operation, "commit-uncertain", `Reviewed edit ${journal.operationId} has durable intent but completion is uncertain. Preserve the retained lock; inspect and explicitly recover before retrying.`, false, { cause }), { [COMMIT_UNCERTAIN]: true, operationId: journal.operationId });
    }
  }
}
