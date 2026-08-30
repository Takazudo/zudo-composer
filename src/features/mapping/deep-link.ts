import { isSafeRecordId } from "../../shared";

/** The two provider-qualified values accepted by the Mapping route. */
export interface MappingDeepLinkRequest {
  readonly providerId: string;
  readonly mappingId: string;
}

export type MappingDeepLinkParseOutcome =
  | { readonly status: "none" }
  | { readonly status: "requested"; readonly request: MappingDeepLinkRequest }
  | { readonly status: "invalid"; readonly message: string };

/**
 * State after a Mapping deep link has been validated and handed to the
 * provider. The route keeps this separate from the ordinary library state so
 * a broken link never silently opens the first available Mapping.
 */
export type MappingDeepLinkState =
  | { readonly status: "none" }
  | { readonly status: "loading"; readonly request: MappingDeepLinkRequest }
  | { readonly status: "ready"; readonly request: MappingDeepLinkRequest }
  | { readonly status: "invalid"; readonly message: string }
  | { readonly status: "missing"; readonly request: MappingDeepLinkRequest; readonly message: string }
  | { readonly status: "provider-failure"; readonly request: MappingDeepLinkRequest; readonly message: string };

export interface MappingRouteLocation {
  readonly pathname: string;
  readonly search: string;
}

const providerIdPattern = /^[a-z0-9](?:[a-z0-9_-]{0,126}[a-z0-9])?$/;

function locationParts(input: MappingRouteLocation | URL | string): MappingRouteLocation {
  if (typeof input === "string") {
    const parsed = new URL(input, "https://mapping.local");
    return { pathname: parsed.pathname, search: parsed.search };
  }
  if (input instanceof URL) return { pathname: input.pathname, search: input.search };
  return input;
}

/** Parse only the exact Mapping route; unrelated routes and ordinary `/mapping` stay library-only. */
export function parseMappingDeepLink(input?: MappingRouteLocation | URL | string): MappingDeepLinkParseOutcome {
  const route = input ?? (typeof window === "undefined" ? { pathname: "", search: "" } : { pathname: window.location.pathname, search: window.location.search });
  const { pathname, search } = locationParts(route);
  if (pathname !== "/mapping") return { status: "none" };

  const params = new URLSearchParams(search);
  const hasProvider = params.has("provider");
  const hasMapping = params.has("mapping");
  if (!hasProvider && !hasMapping) return { status: "none" };
  if (params.getAll("provider").length !== 1 || !params.get("provider")) {
    return { status: "invalid", message: "This Mapping link must include one provider id." };
  }
  if (params.getAll("mapping").length !== 1 || !params.get("mapping")) {
    return { status: "invalid", message: "This Mapping link must include one Mapping record id." };
  }

  const providerId = params.get("provider")!;
  const mappingId = params.get("mapping")!;
  if (!providerIdPattern.test(providerId)) {
    return { status: "invalid", message: "The Mapping provider id is malformed." };
  }
  if (!isSafeRecordId(mappingId)) {
    return { status: "invalid", message: "The Mapping record id is malformed." };
  }
  return { status: "requested", request: { providerId, mappingId } };
}

/** Build the canonical provider-first URL used by Content and other workspaces. */
export function mappingDeepLinkHref(request: MappingDeepLinkRequest): string {
  const params = new URLSearchParams({ provider: request.providerId, mapping: request.mappingId });
  return `/mapping?${params.toString()}`;
}
