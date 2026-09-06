import type { ManagedMediaReference, MediaReferenceLock } from "../../media/references";
export interface MediaImpactLocation {
  domain: "content" | "compositions" | "materialization";
  providerId: string; recordId: string; modelId?: string; fieldId?: string; nodeId?: string; property?: string;
  valuePath: readonly (string | number)[];
  selectionPath?: readonly (string | number)[];
  pathname?: string; sourceRecordId?: string;
  attachmentId?: string;
  entries?: readonly { providerId: string; modelId: string; recordId: string }[];
  markdown?: { from: number; to: number; useFrom: number; useTo: number };
}
export interface MediaImpact { ref: ManagedMediaReference; location: MediaImpactLocation }
export interface MediaImpactAdvisory { location: MediaImpactLocation; reason: string; value?: string }
export interface MediaImpactIndex { complete: boolean; references: MediaImpact[]; advisory: MediaImpactAdvisory[] }
export interface MediaCompileInput { lock: MediaReferenceLock }
