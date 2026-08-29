import type { CompositionProviderId, CompositionRecordRef } from "../../../composer/browser";

export type ComposerRoute =
  | { readonly kind: "index" }
  | ({ readonly kind: "detail" } & Readonly<CompositionRecordRef>);

export type ComposerRouteErrorCode =
  | "wrong-document-path"
  | "unsupported-hash-route"
  | "unknown-provider"
  | "empty-record-id"
  | "malformed-record-id-encoding";

export interface ComposerRouteError {
  readonly code: ComposerRouteErrorCode;
  readonly message: string;
  readonly pathname: string;
  readonly hash: string;
}

export type ComposerRouteResolution =
  | { readonly status: "matched"; readonly route: ComposerRoute }
  | { readonly status: "not-found"; readonly error: ComposerRouteError };

export interface ComposerRouteLocation {
  readonly pathname: string;
  readonly hash: string;
}

export interface ComposerRouteConfig {
  /** Runtime provider check supplied by the provider registry. */
  readonly isKnownProvider: (providerId: string) => boolean;
}

/** Exact pathname of the standalone Composer document. */
export const COMPOSER_DOCUMENT_PATH = "/composer";

function routeError(
  code: ComposerRouteErrorCode,
  message: string,
  location: ComposerRouteLocation,
): ComposerRouteResolution {
  return {
    status: "not-found",
    error: {
      code,
      message,
      pathname: location.pathname,
      hash: location.hash,
    },
  };
}

/**
 * Parse one static hash location without consulting storage. Provider validity
 * comes from the registry seam; record existence is resolved by the transition
 * coordinator after this syntax pass.
 */
export function parseComposerRoute(
  location: ComposerRouteLocation,
  config: ComposerRouteConfig,
): ComposerRouteResolution {
  if (location.pathname !== COMPOSER_DOCUMENT_PATH) {
    return routeError(
      "wrong-document-path",
      `Expected the Composer document at "${COMPOSER_DOCUMENT_PATH}", received "${location.pathname}".`,
      location,
    );
  }

  if (location.hash === "#/") return { status: "matched", route: { kind: "index" } };

  const match = /^#\/composition\/([^/]+)\/([^/]*)$/.exec(location.hash);
  if (!match) {
    return routeError(
      "unsupported-hash-route",
      "This Composer URL does not match the library or composition route format.",
      location,
    );
  }

  const providerId = match[1];
  if (!config.isKnownProvider(providerId)) {
    return routeError(
      "unknown-provider",
      `The composition provider "${providerId}" is not available.`,
      location,
    );
  }

  let recordId: string;
  try {
    recordId = decodeURIComponent(match[2]);
  } catch (cause) {
    return routeError(
      "malformed-record-id-encoding",
      `The composition record id is not valid percent encoding${
        cause instanceof Error && cause.message ? `: ${cause.message}` : "."
      }`,
      location,
    );
  }

  if (recordId.length === 0) {
    return routeError(
      "empty-record-id",
      "The composition record id cannot be empty.",
      location,
    );
  }

  return {
    status: "matched",
    route: {
      kind: "detail",
      providerId: providerId as CompositionProviderId,
      recordId,
    },
  };
}

/** Format a canonical pathname + static hash for history APIs and links. */
export function formatComposerRoute(
  route: ComposerRoute,
): string {
  if (route.kind === "index") return `${COMPOSER_DOCUMENT_PATH}#/`;
  return `${COMPOSER_DOCUMENT_PATH}#/composition/${route.providerId}/${encodeURIComponent(route.recordId)}`;
}
