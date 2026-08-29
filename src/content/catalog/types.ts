import type { ContentLoadOutcome, ContentModelRecord } from "../model";
import type { ContentModelSummary, ContentStore } from "../library";

export interface ContentModelRef { providerId: string; recordId: string }
export interface ContentCatalogEntry {
  ref: ContentModelRef;
  providerLabel: string;
  summary: ContentModelSummary;
}
export interface ContentCatalogProviderFailure { providerId: string; providerLabel: string; reason: string }
export interface ContentCatalogListOutcome { status: "listed"; entries: readonly ContentCatalogEntry[]; failures: readonly ContentCatalogProviderFailure[] }
export type ContentCatalogResolveOutcome =
  | { status: "resolved"; record: ContentModelRecord }
  | { status: "not-found" }
  | { status: "invalid"; reason: string }
  | { status: "provider-error"; reason: string };
export interface ContentCatalogProvider {
  readonly descriptor: { readonly id: string; readonly label: string };
  readonly store: Pick<ContentStore, "listModels" | "getModel">;
}
export interface ContentCatalog {
  listModels(): Promise<ContentCatalogListOutcome>;
  resolveModel(ref: ContentModelRef): Promise<ContentCatalogResolveOutcome>;
}
export type ContentCatalogStore = Pick<ContentStore, "listModels" | "getModel">;
export type { ContentLoadOutcome };
