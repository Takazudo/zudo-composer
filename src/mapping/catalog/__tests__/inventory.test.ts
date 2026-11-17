import { describe, expect, it, vi } from "vitest";
import { createMappingCatalog } from "../catalog";
import { createMappingRecord, summarizeMapping } from "../../model";
const record = (id: string) => createMappingRecord({ id, name: id, contentModel: { providerId: "content", recordId: "articles" }, composition: { providerId: "files", recordId: "page" }, createdAt: "2026-08-01T00:00:00.000Z" });
const provider = (id: string) => ({ descriptor: { id, label: id }, store: { list: vi.fn(async () => [summarizeMapping(record("legacy"))]), get: vi.fn(async () => ({ status: "not-found" as const, id: "unused" })) } });
describe("Mapping per-load inventory", () => {
 it("captures each capable provider once, preserves qualified provider/record order and legacy fallback", async () => {
  const native = provider("native"), legacy = provider("legacy");const records = [record("z"), record("a")];
  const snapshot = vi.fn(async () => ({ mutationToken: "1", records }));const catalog = createMappingCatalog([{ ...native, store: { ...native.store, snapshot } }, legacy]);
  const first = await catalog.readInventory!();expect(first.entries.map(e => e.ref)).toEqual([{providerId:"native",recordId:"a"},{providerId:"native",recordId:"z"},{providerId:"legacy",recordId:"legacy"}]);
  expect(snapshot).toHaveBeenCalledTimes(1);expect(native.store.list).not.toHaveBeenCalled();expect(native.store.get).not.toHaveBeenCalled();expect(legacy.store.list).toHaveBeenCalledTimes(1);
  records[0]!.document.name = "changed";expect(first.snapshots[0]!.snapshot.records[0]!.document.name).toBe("z");
  await catalog.readInventory!();expect(snapshot).toHaveBeenCalledTimes(2);
 });
 it.each(["throw", "duplicate", "future", "token"])("keeps %s snapshot failure visible without list/get fallback", async problem => {
  const p=provider("native");const snapshot=vi.fn(async()=>{if(problem==="throw")throw new Error("unavailable");const r=record("a");if(problem==="future")r.document.schemaVersion=999 as never;return{mutationToken:problem==="token"?"":"1",records:problem==="duplicate"?[r,r]:[r]};});
  const out=await createMappingCatalog([{...p,store:{...p.store,snapshot}}]).readInventory!();expect(out.entries).toEqual([]);expect(out.snapshots).toEqual([]);expect(out.failures).toHaveLength(1);expect(p.store.list).not.toHaveBeenCalled();expect(p.store.get).not.toHaveBeenCalled();
 });
});
