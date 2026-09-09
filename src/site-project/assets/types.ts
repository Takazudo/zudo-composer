import type { ManagedAssetReference, AssetReferenceLock } from "../../assets/references";
export interface AssetImpactLocation {
  domain: "content" | "compositions" | "materialization";
  providerId: string; recordId: string; modelId?: string; fieldId?: string; nodeId?: string; property?: string;
  valuePath: readonly (string | number)[];
  selectionPath?: readonly (string | number)[];
  pathname?: string; sourceRecordId?: string;
  attachmentId?: string;
  entries?: readonly { providerId: string; modelId: string; recordId: string }[];
  markdown?: { from: number; to: number; useFrom: number; useTo: number };
}
export interface AssetImpact { ref: ManagedAssetReference; location: AssetImpactLocation }
export interface AssetImpactAdvisory { location: AssetImpactLocation; reason: string; value?: string }
export interface AssetImpactIndex { complete: boolean; references: AssetImpact[]; advisory: AssetImpactAdvisory[] }
export interface AssetCompileInput { lock: AssetReferenceLock }
