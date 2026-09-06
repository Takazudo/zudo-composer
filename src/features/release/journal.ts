import type { ReleasePlan, StagedRelease } from "../../site-project/api/types";
const root = "zudo-release-journal-v2:";
const prefix = (workspaceId: string) => `${root}${encodeURIComponent(workspaceId)}:`;
export interface ReleaseReceipt { key: string; projectId: string; buildId: string; approvalDigest: string; expectedStoreGeneration: number }
const notify = (workspaceId: string) => window.dispatchEvent(new CustomEvent("release:journal", { detail: workspaceId }));
function receiptCount(workspaceId: string) { let count = 0; for (let i = 0; i < localStorage.length; i++) if (localStorage.key(i)?.startsWith(prefix(workspaceId))) count++; return count; }
/** Only unresolved approvals need local hints. Server catalog stages need none. */
export function recordReleaseApproval(workspaceId: string, plan: ReleasePlan, stage: StagedRelease): ReleaseReceipt {
  const key = `${prefix(workspaceId)}${stage.projectId}:${stage.buildId}:${plan.planDigest}`;
  const receipt = { key, projectId: stage.projectId, buildId: stage.buildId, approvalDigest: plan.planDigest, expectedStoreGeneration: plan.storeGeneration };
  const value = JSON.stringify(receipt), prior = localStorage.getItem(key);
  if (prior !== null && prior !== value) throw new Error("Recovery receipt differs from its immutable identity.");
  if (prior === null) { if (receiptCount(workspaceId) >= 128) throw new Error("Unresolved release receipt limit reached. Inspect this workspace's server catalog before another apply."); localStorage.setItem(key, value); }
  if (localStorage.getItem(key) !== value) throw new Error("Recovery journal did not persist.");
  if (receiptCount(workspaceId) > 128) {
    // Another tab can write between the precheck and setItem. Roll back only
    // this call's new, unchanged receipt; transport has not started yet.
    if (prior === null) {
      if (localStorage.getItem(key) !== value) throw new Error("Receipt changed during capacity rollback; no other receipt was removed.");
      localStorage.removeItem(key);
      if (localStorage.getItem(key) !== null) throw new Error("Receipt capacity rollback could not be verified; transport is blocked.");
      notify(workspaceId);
    }
    throw new Error("Unresolved release receipt limit reached after concurrent write. No request was sent.");
  }
  notify(workspaceId); return receipt;
}
export function releaseReceipts(workspaceId: string): ReleaseReceipt[] {
  const receipts: ReleaseReceipt[] = [];
  for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i); if (!key?.startsWith(prefix(workspaceId))) continue; const receipt = JSON.parse(localStorage.getItem(key)!); if (receipt.key !== key || typeof receipt.projectId !== "string" || !/^[a-f0-9]{64}$/.test(receipt.buildId) || !/^[a-f0-9]{64}$/.test(receipt.approvalDigest) || !Number.isSafeInteger(receipt.expectedStoreGeneration) || receipt.expectedStoreGeneration < 0) throw new Error("Invalid release recovery receipt."); receipts.push(receipt); }
  return receipts;
}
export function resolveReleaseReceipt(workspaceId: string, receipt: ReleaseReceipt) { if (localStorage.getItem(receipt.key) === JSON.stringify(receipt)) { localStorage.removeItem(receipt.key); notify(workspaceId); } }
/** Pass only receipts captured BEFORE the authoritative catalog read. An absent
 * same-generation approval could still be in flight in another tab: keep it. */
export function pruneReleaseReceipts(workspaceId: string, observed: readonly ReleaseReceipt[], catalog: { generation: number; projects: readonly { projectId: string; stages: readonly string[] }[] }) {
  for (const receipt of observed) if (catalog.projects.some((project) => project.projectId === receipt.projectId && project.stages.includes(receipt.buildId)) || catalog.generation > receipt.expectedStoreGeneration) resolveReleaseReceipt(workspaceId, receipt);
}
export function subscribeReleaseJournal(workspaceId: () => string | undefined, listener: () => void) {
  const storage = (event: StorageEvent) => { if (event.key?.startsWith(prefix(workspaceId() ?? ""))) listener(); };
  const local = (event: Event) => { if ((event as CustomEvent).detail === workspaceId()) listener(); };
  window.addEventListener("storage", storage); window.addEventListener("release:journal", local);
  return () => { window.removeEventListener("storage", storage); window.removeEventListener("release:journal", local); };
}
