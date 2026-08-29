import {
  cloneJson,
  createSaveQueue,
  createSequentialIdFactory,
  type CompositionDocument,
  type CompositionRecord,
  type CompositionRecordRef,
  type CompositionSaveOutcome,
  type IdFactory,
} from "../../../../composer";

const NOW = "2026-07-14T00:00:00.000Z";
const SAVED: CompositionSaveOutcome = {
  canonical: { status: "saved" },
  derived: { status: "current", records: [] },
};

/** Build the current record-scoped controller seam without any provider I/O. */
export function controllerOptions(
  document: CompositionDocument,
  idFactory: IdFactory = createSequentialIdFactory("node"),
) {
  const recordId = document.id || "test-record";
  const record: CompositionRecord = {
    id: recordId,
    createdAt: NOW,
    updatedAt: NOW,
    document: { ...cloneJson(document), id: recordId },
  };
  const ref: CompositionRecordRef = { providerId: "indexeddb", recordId: record.id };
  const saveQueue = createSaveQueue<CompositionRecord, CompositionRecordRef, CompositionSaveOutcome>({
    ref,
    initialRecord: record,
    write: async () => SAVED,
  });
  return { record, saveQueue, idFactory, now: () => NOW };
}
