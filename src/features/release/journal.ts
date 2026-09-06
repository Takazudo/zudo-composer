import type { ReleasePlan, StagedRelease } from "../../site-project/api/types";
import { validateStagedRelease } from "../../site-project/api/validation";

const prefix = (workspaceId: string) => `zudo-release-journal-v2:${encodeURIComponent(workspaceId)}:`;
export interface ReleaseReceipt { stage: StagedRelease; stageGeneration: number | null }
function write(workspaceId: string, suffix: string, receipt: ReleaseReceipt) {
  const key = prefix(workspaceId) + suffix, value = JSON.stringify(receipt), prior = localStorage.getItem(key);
  if (prior !== null && prior !== value) throw new Error("Recovery receipt differs from its immutable identity.");
  if (prior === null) localStorage.setItem(key, value);
  if (localStorage.getItem(key) !== value) throw new Error("Recovery journal did not persist.");
  window.dispatchEvent(new CustomEvent("release:journal", { detail: workspaceId }));
}
export function recordReleaseApproval(workspaceId: string, plan: ReleasePlan, stage: StagedRelease) { write(workspaceId, `${stage.projectId}:${stage.buildId}:approval:${plan.planDigest}`, { stage, stageGeneration: null }); }
export function recordReleaseStage(workspaceId: string, stage: StagedRelease, stageGeneration: number) { write(workspaceId, `${stage.projectId}:${stage.buildId}:stage:${stageGeneration}`, { stage, stageGeneration }); }
export function releaseReceipts(workspaceId: string): ReleaseReceipt[] {
  const receipts: ReleaseReceipt[] = [];
  for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i); if (!key?.startsWith(prefix(workspaceId))) continue; const receipt = JSON.parse(localStorage.getItem(key)!); if (!validateStagedRelease(receipt.stage) || !(receipt.stageGeneration === null || (Number.isSafeInteger(receipt.stageGeneration) && receipt.stageGeneration > 0))) throw new Error("Invalid release recovery receipt."); receipts.push(receipt); }
  return receipts;
}
export function subscribeReleaseJournal(workspaceId: () => string | undefined, listener: () => void) {
  const storage = (event: StorageEvent) => { if (event.key?.startsWith(prefix(workspaceId() ?? ""))) listener(); };
  const local = (event: Event) => { if ((event as CustomEvent).detail === workspaceId()) listener(); };
  window.addEventListener("storage", storage); window.addEventListener("release:journal", local);
  return () => { window.removeEventListener("storage", storage); window.removeEventListener("release:journal", local); };
}
