import type {
  CompositionInitializationOutcome,
  CompositionProviderDescriptor,
  CompositionProviderId,
  CompositionRecordRef,
  CompositionSummary,
  ReuseCatalogOutcome,
} from "../../../composer";

/** A provider can be described even when the current runtime cannot offer it. */
export interface CompositionLibraryProviderCapability {
  descriptor: CompositionProviderDescriptor;
  available: boolean;
}

export type CompositionLibraryOpenOutcome =
  | { status: "opened" }
  | { status: "not-found" };

/**
 * The New-composition dialog always creates an empty local document. A source
 * choice is intentionally just the stable same-provider ids needed to bind it;
 * the adapter revalidates those ids immediately before persisting.
 */
export interface CompositionLibraryCreateIntent {
  providerId: CompositionProviderId;
  name: string;
  source?: {
    sourceRecordId: string;
    outletId: string;
  };
}

/**
 * UI intents only. Production provider and router adapters are deliberately
 * supplied by a later composition layer; component tests use an async fake.
 */
export interface CompositionLibraryIntents {
  initialize(providerId: CompositionProviderId): Promise<CompositionInitializationOutcome>;
  retry(providerId: CompositionProviderId): Promise<CompositionInitializationOutcome>;
  startFresh(providerId: CompositionProviderId): Promise<CompositionInitializationOutcome>;
  /** Reusable sources available to the active provider's New dialog. */
  listTemplates(providerId: CompositionProviderId): Promise<ReuseCatalogOutcome>;
  create(intent: CompositionLibraryCreateIntent): Promise<CompositionSummary>;
  open(ref: CompositionRecordRef): Promise<CompositionLibraryOpenOutcome>;
  duplicate(ref: CompositionRecordRef): Promise<CompositionSummary>;
  delete(ref: CompositionRecordRef): Promise<boolean>;
  clear(providerId: CompositionProviderId): Promise<void>;
}
