// Typed cross-route deep links for the authoring workspaces.
//
// Every route that another workspace can point at exposes exactly one intent
// shape here, so a link is built and validated in one place instead of each
// route re-deriving its own query-string contract. Routes implement the
// handling; this module only parses and formats.
//
// The Mapping route keeps its own provider-qualified deep link
// (`src/features/mapping/deep-link.ts`) because a Mapping is addressed by
// provider *and* record; the validation style here deliberately mirrors it —
// safe record ids, each recognised parameter present exactly once, and a
// malformed link reported rather than silently opening something else.

import { isSafeRecordId, type RecordId } from "../shared";

/** A cross-route request that a workspace can be opened with. */
export type RouteIntent =
  | { readonly route: "composer"; readonly action: "new" }
  | { readonly route: "content"; readonly modelId: RecordId; readonly entryId?: RecordId }
  | { readonly route: "sitemapper"; readonly sitemapId: RecordId; readonly pageId?: RecordId }
  | { readonly route: "media"; readonly assetId: RecordId };

export type RouteIntentRoute = RouteIntent["route"];

export type RouteIntentParseOutcome =
  | { readonly status: "none" }
  | { readonly status: "matched"; readonly intent: RouteIntent }
  | { readonly status: "invalid"; readonly message: string };

export interface RouteIntentLocation {
  readonly pathname: string;
  readonly search: string;
}

/** The exact pathnames that carry an intent; every other route parses as `none`. */
const INTENT_PATHS = {
  "/composer": "composer",
  "/content": "content",
  "/sitemapper": "sitemapper",
  "/media": "media",
} as const satisfies Record<string, RouteIntentRoute>;

/** Recognised parameters per route; anything else on the URL is ignored. */
const INTENT_PARAMS: Record<RouteIntentRoute, readonly string[]> = {
  composer: ["new"],
  content: ["model", "entry"],
  sitemapper: ["sitemap", "page"],
  media: ["asset"],
};

function locationParts(input: RouteIntentLocation | URL | string): RouteIntentLocation {
  if (typeof input === "string") {
    const parsed = new URL(input, "https://intent.local");
    return { pathname: parsed.pathname, search: parsed.search };
  }
  if (input instanceof URL) return { pathname: input.pathname, search: input.search };
  return input;
}

function invalid(message: string): RouteIntentParseOutcome {
  return { status: "invalid", message };
}

/**
 * Read a single-valued parameter. A repeated or empty parameter is a malformed
 * link rather than a missing one, so it never falls back to the plain route.
 */
function readOnce(params: URLSearchParams, name: string): { present: false } | { present: true; value: string } | { present: true; repeated: true } {
  const values = params.getAll(name);
  if (values.length === 0) return { present: false };
  if (values.length !== 1 || !values[0]) return { present: true, repeated: true };
  return { present: true, value: values[0] };
}

function readRecordId(params: URLSearchParams, name: string, label: string): { status: "absent" } | { status: "ok"; value: RecordId } | { status: "invalid"; message: string } {
  const read = readOnce(params, name);
  if (!read.present) return { status: "absent" };
  if ("repeated" in read) return { status: "invalid", message: `This link must include one ${label}.` };
  if (!isSafeRecordId(read.value)) return { status: "invalid", message: `The ${label} is malformed.` };
  return { status: "ok", value: read.value };
}

/** Parse only the exact intent routes; a bare route without parameters is `none`. */
export function parseIntent(input?: RouteIntentLocation | URL | string): RouteIntentParseOutcome {
  const location = input ?? (typeof window === "undefined" ? { pathname: "", search: "" } : { pathname: window.location.pathname, search: window.location.search });
  const { pathname, search } = locationParts(location);
  const route = (INTENT_PATHS as Record<string, RouteIntentRoute | undefined>)[pathname];
  if (!route) return { status: "none" };

  const params = new URLSearchParams(search);
  if (!INTENT_PARAMS[route].some((name) => params.has(name))) return { status: "none" };

  switch (route) {
    case "composer": {
      const read = readOnce(params, "new");
      if (!read.present || "repeated" in read) return invalid("This Composer link must include one new-Composition flag.");
      // The flag is deliberately exact: `new=0` is a malformed link, not a request to do nothing.
      if (read.value !== "1") return invalid("The Composer new-Composition flag must be 1.");
      return { status: "matched", intent: { route: "composer", action: "new" } };
    }
    case "content": {
      const model = readRecordId(params, "model", "Content model id");
      if (model.status === "invalid") return invalid(model.message);
      if (model.status === "absent") return invalid("This Content link must include one Content model id.");
      const entry = readRecordId(params, "entry", "Content Entry id");
      if (entry.status === "invalid") return invalid(entry.message);
      return {
        status: "matched",
        intent: entry.status === "ok"
          ? { route: "content", modelId: model.value, entryId: entry.value }
          : { route: "content", modelId: model.value },
      };
    }
    case "sitemapper": {
      const sitemap = readRecordId(params, "sitemap", "Sitemap id");
      if (sitemap.status === "invalid") return invalid(sitemap.message);
      if (sitemap.status === "absent") return invalid("This Sitemapper link must include one Sitemap id.");
      const page = readRecordId(params, "page", "Sitemap page id");
      if (page.status === "invalid") return invalid(page.message);
      return {
        status: "matched",
        intent: page.status === "ok"
          ? { route: "sitemapper", sitemapId: sitemap.value, pageId: page.value }
          : { route: "sitemapper", sitemapId: sitemap.value },
      };
    }
    case "media": {
      const asset = readRecordId(params, "asset", "Media asset id");
      if (asset.status === "invalid") return invalid(asset.message);
      if (asset.status === "absent") return invalid("This Media link must include one Media asset id.");
      return { status: "matched", intent: { route: "media", assetId: asset.value } };
    }
  }
}

/** Build the canonical URL for an intent; the result always parses back to it. */
export function formatIntent(intent: RouteIntent): string {
  switch (intent.route) {
    case "composer":
      return "/composer?new=1";
    case "content": {
      const params = new URLSearchParams({ model: intent.modelId });
      if (intent.entryId !== undefined) params.set("entry", intent.entryId);
      return `/content?${params.toString()}`;
    }
    case "sitemapper": {
      const params = new URLSearchParams({ sitemap: intent.sitemapId });
      if (intent.pageId !== undefined) params.set("page", intent.pageId);
      return `/sitemapper?${params.toString()}`;
    }
    case "media":
      return `/media?${new URLSearchParams({ asset: intent.assetId }).toString()}`;
  }
}
