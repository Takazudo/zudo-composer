import type {
  CompositionLoadOutcome,
  CompositionPersistenceErrorCode,
  CompositionRecord,
} from "../../library";

/**
 * Refresh-hint channel for the filesystem composition provider. Compositions
 * predate the shared domain transport and keep their own endpoint, so the
 * channel name is spelled here rather than derived from a domain name.
 */
export const COMPOSITION_FILE_PROVIDER_CHANNEL = "compositions:files";

/** Injected only into dev client bundles by the Vite file-provider plugin. */
export interface ComposerFileProviderConfig {
  endpoint: string;
  capability: string;
  capabilityHeader: string;
  /** Names the workspace whose composition directory the request addresses. */
  workspaceHeader: string;
  maxBodyBytes: number;
}

export interface ComposerFileProviderErrorPayload {
  code: CompositionPersistenceErrorCode | string;
  message: string;
  operation?: string;
}

/** JSON-safe browser planner output for one generated file. */
export type ComposerFileProviderDerivedOutputPlan =
  | { status: "generated"; code: string }
  | { status: "blocked"; reason: string };

/**
 * A complete same-provider closure supplied by the dev server. The browser
 * feeds only this data into the pure linked-module planner; it never calls the
 * provider recursively while answering an output request.
 */
export interface ComposerFileProviderDerivedOutputRequest {
  records: readonly CompositionRecord[];
  sourceOutcomes: readonly { id: string; outcome: CompositionLoadOutcome }[];
  targetIds: readonly string[];
}
