// Sitemapper ↔ Composer boundary: this catalog is the only Sitemapper module
// allowed to depend on ../../composer/index, and its public operations are read-only.
// Providers are injected by the host; the catalog itself is read-only.

import type {
  CompositionLoadOutcome,
  CompositionRecord,
  CompositionStore,
  CompositionSummary,
} from "../../composer/index";
import type { CompositionRef } from "../model/types";

/** One saved Composer record as it appears in the Sitemapper picker. */
export interface CatalogEntry {
  /** Provider-qualified identity; a bare record id is not sufficient. */
  ref: CompositionRef;
  providerLabel: string;
  name: string;
  updatedAt: string;
  nodeCount: number;
}

/** A provider whose list operation failed while other providers may succeed. */
export interface ProviderFailure {
  providerId: string;
  providerLabel: string;
  reason: string;
}

export interface CompositionCatalogListOutcome {
  entries: CatalogEntry[];
  failures: ProviderFailure[];
}

/** The five deliberate results of resolving a Sitemap composition reference. */
export type ResolveOutcome =
  | { status: "resolved"; record: CompositionRecord }
  | { status: "not-found" }
  | { status: "provider-unavailable" }
  | { status: "unreadable-target"; reason: string }
  | { status: "invalid-ref"; reason: string };

/**
 * The smallest provider surface the catalog needs. A real CompositionProvider
 * is structurally assignable here, while tests and host integrations need not
 * expose any Composer write or lifecycle methods to this read-only boundary.
 */
export interface CompositionCatalogProvider {
  readonly descriptor: {
    readonly id: string;
    readonly label: string;
  };
  readonly store: Pick<CompositionStore, "list" | "get">;
}

export interface CompositionCatalog {
  listCompositions(): Promise<CompositionCatalogListOutcome>;
  resolveComposition(ref: CompositionRef): Promise<ResolveOutcome>;
}

/** Narrow read-only store shape exported for fake-provider fixtures. */
export type CompositionCatalogStore = Pick<CompositionStore, "list" | "get">;

/** Provider result types exposed through the catalog boundary. */
export type { CompositionLoadOutcome, CompositionRecord, CompositionSummary };
