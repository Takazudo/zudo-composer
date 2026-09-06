import { afterEach, expect, it, vi } from "vitest";
import type { ReleasePlan, StagedRelease } from "../../../site-project/api/types";
import { recordReleaseApproval, releaseReceipts, resolveReleaseReceipt, pruneReleaseReceipts } from "../journal";
const stage = { projectId: "project", buildId: "a".repeat(64) } as StagedRelease;
const plan = (id: number, generation = 0) => ({ planDigest: id.toString(16).padStart(64, "0"), storeGeneration: generation }) as ReleasePlan;
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });
it("does not let 128 receipts in another workspace block the current workspace", () => {
  for (let i = 0; i < 128; i++) recordReleaseApproval("abandoned", plan(i), stage);
  expect(() => recordReleaseApproval("healthy", plan(0), stage)).not.toThrow();
  expect(releaseReceipts("abandoned")).toHaveLength(128); expect(releaseReceipts("healthy")).toHaveLength(1);
});
it("rolls back only its own new receipt after an interleaving over-cap write", () => {
  for (let i = 0; i < 127; i++) recordReleaseApproval("workspace", plan(i), stage);
  const original = Storage.prototype.setItem; let ownKey = "", concurrentKey = "";
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
    original.call(this, key, value); ownKey = key;
    const receipt = JSON.parse(value); concurrentKey = key.replace(receipt.approvalDigest, plan(500).planDigest);
    original.call(this, concurrentKey, JSON.stringify({ ...receipt, key: concurrentKey, approvalDigest: plan(500).planDigest }));
  });
  expect(() => recordReleaseApproval("workspace", plan(128), stage)).toThrow("after concurrent write");
  expect(localStorage.getItem(ownKey)).toBeNull(); expect(localStorage.getItem(concurrentKey)).not.toBeNull(); expect(releaseReceipts("workspace")).toHaveLength(128);
});
it("fails closed when its over-cap rollback cannot be verified", () => {
  for (let i = 0; i < 127; i++) recordReleaseApproval("workspace", plan(i), stage);
  const original = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) { original.call(this, key, value); const receipt = JSON.parse(value), nextKey = key.replace(receipt.approvalDigest, plan(500).planDigest); original.call(this, nextKey, JSON.stringify({ ...receipt, key: nextKey, approvalDigest: plan(500).planDigest })); });
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {});
  expect(() => recordReleaseApproval("workspace", plan(128), stage)).toThrow("rollback could not be verified");
  expect(releaseReceipts("workspace")).toHaveLength(129);
});
it("keeps hundreds of confirmed publication cycles bounded and stores no project bytes", () => {
  for (let i = 0; i < 500; i++) { const receipt = recordReleaseApproval("workspace", plan(i, i), stage); expect(JSON.stringify(receipt).length).toBeLessThan(512); resolveReleaseReceipt("workspace", receipt); }
  expect(localStorage.length).toBe(0);
});
it("does not prune a same-generation in-flight approval or a receipt created after the catalog read began", () => {
  recordReleaseApproval("workspace", plan(1), stage); const observed = releaseReceipts("workspace");
  pruneReleaseReceipts("workspace", observed, { generation: 0, projects: [] }); expect(releaseReceipts("workspace")).toHaveLength(1);
  recordReleaseApproval("workspace", plan(2, 1), stage);
  pruneReleaseReceipts("workspace", observed, { generation: 1, projects: [] }); expect(releaseReceipts("workspace").map(({ approvalDigest }) => approvalDigest)).toEqual([plan(2).planDigest]);
  pruneReleaseReceipts("workspace", releaseReceipts("workspace"), { generation: 1, projects: [{ projectId: "project", stages: [stage.buildId] }] }); expect(localStorage.length).toBe(0);
});
it("bounds unresolved receipts before browser quota and recovers after definitive absence", () => {
  for (let i = 0; i < 128; i++) recordReleaseApproval("workspace", plan(i), stage);
  expect(() => recordReleaseApproval("workspace", plan(129), stage)).toThrow("limit reached");
  pruneReleaseReceipts("workspace", releaseReceipts("workspace"), { generation: 1, projects: [] }); expect(localStorage.length).toBe(0);
  expect(() => recordReleaseApproval("workspace", plan(129, 1), stage)).not.toThrow();
});
