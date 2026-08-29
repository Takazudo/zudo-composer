import type { CompositionProviderId, CompositionRecordRef } from "../../../composer";

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
  /** Deployment base such as `/` or `/team/zudo-sg/`. */
  readonly basePath?: string;
  /** Whether the Composer document itself ends in `/` before its hash. */
  readonly trailingSlash?: "always" | "never";
  /** Runtime provider check supplied by the provider registry. */
  readonly isKnownProvider: (providerId: string) => boolean;
}

function normalizeBasePath(basePath: string | undefined): string {
  const raw = basePath?.trim() || "/";
  const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
  const withoutTrailingSlash = withLeadingSlash.replace(/\/+$/, "");
  return withoutTrailingSlash === "" ? "" : withoutTrailingSlash;
}

/** Pathname of the static Composer document for the configured deployment. */
export function composerDocumentPath(
  config: Pick<ComposerRouteConfig, "basePath" | "trailingSlash"> = {},
): string {
  const base = normalizeBasePath(config.basePath);
  const suffix = config.trailingSlash === "never" ? "" : "/";
  return `${base}/composer${suffix}`;
}

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
  const expectedPath = composerDocumentPath(config);
  if (location.pathname !== expectedPath) {
    return routeError(
      "wrong-document-path",
      `Expected the Composer document at "${expectedPath}", received "${location.pathname}".`,
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
  config: Pick<ComposerRouteConfig, "basePath" | "trailingSlash"> = {},
): string {
  const documentPath = composerDocumentPath(config);
  if (route.kind === "index") return `${documentPath}#/`;
  return `${documentPath}#/composition/${route.providerId}/${encodeURIComponent(route.recordId)}`;
}
