import type { PersistedSnapshot } from "../../shared/persistence-generation";
import type { CompositionLoadOutcome, CompositionRecord, CompositionRecordRef, CompositionStore, CompositionSummary } from "../../composer/library";
import type { MappingLoadOutcome, MappingRecord, MappingStore, MappingSummary } from "../model";

export type CompositionCatalogResolveOutcome =
  | { status: "resolved"; record: CompositionRecord }
  | { status: "not-found" }
  | { status: "invalid"; reason: string }
  | { status: "provider-error"; reason: string };
export interface CompositionCatalogEntry { ref: CompositionRecordRef; providerLabel: string; summary: CompositionSummary }
export interface CompositionCatalogListOutcome { status: "listed"; entries: readonly CompositionCatalogEntry[]; failures: readonly { providerId: string; providerLabel: string; reason: string }[] }
export interface CompositionCatalogProvider { descriptor: { id: CompositionRecordRef["providerId"]; label: string }; store: Pick<CompositionStore, "list" | "get"> }
export interface CompositionCatalog { list(): Promise<CompositionCatalogListOutcome>; resolve(ref: CompositionRecordRef): Promise<CompositionCatalogResolveOutcome> }

export interface MappingRecordRef { providerId: string; recordId: string }
export type MappingCatalogResolveOutcome = { status: "resolved"; record: MappingRecord } | { status: "not-found" } | { status: "invalid"; reason: string } | { status: "provider-error"; reason: string };
export interface MappingCatalogEntry { ref: MappingRecordRef; providerLabel: string; summary: MappingSummary }
export interface MappingCatalogProvider { descriptor: { id: string; label: string }; store: Pick<MappingStore, "list" | "get" | "snapshot"> }
export interface MappingCatalogInventory {
  entries: readonly MappingCatalogEntry[];
  failures: readonly { providerId: string; providerLabel: string; reason: string }[];
  /** Each provider is coherent independently; no cross-provider transaction. */
  snapshots: readonly { providerId: string; snapshot: PersistedSnapshot<MappingRecord> }[];
}
export interface MappingCatalog { readInventory?(): Promise<MappingCatalogInventory>; list(): Promise<{ status: "listed"; entries: readonly MappingCatalogEntry[]; failures: readonly { providerId: string; providerLabel: string; reason: string }[] }>; resolve(ref: MappingRecordRef): Promise<MappingCatalogResolveOutcome> }
export type { CompositionLoadOutcome, MappingLoadOutcome };
