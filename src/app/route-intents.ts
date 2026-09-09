import { isSafeRecordId, type RecordId } from "../shared";

type ProviderTarget = { readonly providerId: string };
export type RouteIntent =
  | { readonly route: "composer"; readonly action: "new" }
  | (ProviderTarget & { readonly route: "composer"; readonly compositionId: RecordId })
  | (ProviderTarget & { readonly route: "content"; readonly modelId: RecordId; readonly entryId?: RecordId; readonly viewId?: string; readonly fieldId?: RecordId; readonly valuePath?: readonly (RecordId | number)[] })
  | (ProviderTarget & { readonly route: "mapping"; readonly mappingId: RecordId })
  | (ProviderTarget & { readonly route: "sitemapper"; readonly sitemapId: RecordId; readonly pageId?: RecordId })
  | (ProviderTarget & { readonly route: "assets"; readonly assetId: RecordId })
  | { readonly route: "review" };
export type RouteIntentRoute = RouteIntent["route"];
export type RouteIntentParseOutcome = { readonly status: "none" } | { readonly status: "matched"; readonly intent: RouteIntent } | { readonly status: "invalid"; readonly message: string };
export interface RouteIntentLocation { readonly pathname: string; readonly search: string; readonly hash?: string }
const PATHS: Record<string, RouteIntentRoute> = { "/composer": "composer", "/content": "content", "/mapping": "mapping", "/sitemapper": "sitemapper", "/assets": "assets", "/review": "review" };
const PARAMS: Record<RouteIntentRoute, readonly string[]> = { composer: ["provider", "composition", "new"], content: ["provider", "model", "entry", "view", "field", "path"], mapping: ["provider", "mapping"], sitemapper: ["provider", "sitemap", "page"], assets: ["provider", "asset"], review: [] };
export const isIntentProviderId = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9](?:[a-z0-9_-]{0,126}[a-z0-9])?$/.test(value);

/** Typed RFC6901 pointer segments: `f:` is a stable nested field id, `i:` a list index. */
export function encodeContentValuePath(path: readonly (RecordId | number)[]): string {
  if (path.length === 0 || path.length > 32) throw new TypeError("Content value path must contain 1-32 segments.");
  return `/${path.map((segment) => {
    if (typeof segment === "number") {
      if (!Number.isSafeInteger(segment) || segment < 0) throw new TypeError("Content value path index is malformed.");
      return `i:${segment}`;
    }
    if (!isSafeRecordId(segment)) throw new TypeError("Content value path field id is malformed.");
    return `f:${segment.replace(/~/g, "~0").replace(/\//g, "~1")}`;
  }).join("/")}`;
}

export function decodeContentValuePath(pointer: string): readonly (RecordId | number)[] {
  if (!pointer.startsWith("/") || pointer === "/") throw new TypeError("Content value path must be a non-empty RFC6901 pointer.");
  const encoded = pointer.slice(1).split("/");
  if (encoded.length > 32) throw new TypeError("Content value path is too deep.");
  return encoded.map((segment) => {
    if (/^i:(?:0|[1-9]\d*)$/.test(segment)) {
      const index = Number(segment.slice(2));
      if (!Number.isSafeInteger(index)) throw new TypeError("Content value path index is malformed.");
      return index;
    }
    if (!segment.startsWith("f:") || /~(?![01])/u.test(segment)) throw new TypeError("Content value path segment is malformed.");
    const fieldId = segment.slice(2).replace(/~1/g, "/").replace(/~0/g, "~");
    if (!isSafeRecordId(fieldId)) throw new TypeError("Content value path field id is malformed.");
    return fieldId;
  });
}

/** Editors publish their own accepted selection without asking the host to remount them. */
export function notifyRouteSelection(action: "push" | "replace" = "replace"): void { window.dispatchEvent(new CustomEvent("workspace-route-selection", { detail: action })); }

/** Exact paths and single-valued query fields. No hash routes or identity fallback. */
export function parseIntent(input?: RouteIntentLocation | URL | string): RouteIntentParseOutcome {
  try {
    const location = typeof input === "string" ? new URL(input, "https://intent.local") : input ?? (typeof window === "undefined" ? { pathname: "", search: "" } : window.location);
    const route = PATHS[location.pathname];
    if (!route) return { status: "none" };
    if ("hash" in location && location.hash) throw new Error("Workspace links cannot contain a hash route.");
    const params = new URLSearchParams(location.search);
    if ([...params.keys()].some((key) => !PARAMS[route].includes(key))) throw new Error("This workspace link contains an unsupported parameter.");
    if (route === "review") return { status: "matched", intent: { route } };
    if (!params.size) return { status: "none" };
    const read = (key: string, optional = false): string | undefined => {
      if (optional && !params.has(key)) return undefined;
      const values = params.getAll(key);
      if (values.length !== 1 || !values[0]) throw new Error(`This link must include one ${key} id.`);
      if (!(key === "provider" ? isIntentProviderId(values[0]) : isSafeRecordId(values[0]))) throw new Error(`The ${key} id is malformed.`);
      return values[0];
    };
    if (route === "composer" && params.has("new")) {
      if (params.size !== 1 || params.get("new") !== "1") throw new Error("The new-Composition flag must be 1 and cannot be combined with a target.");
      return { status: "matched", intent: { route, action: "new" } };
    }
    const providerId = read("provider")!;
    let intent: RouteIntent;
    switch (route) {
      case "composer": intent = { route, providerId, compositionId: read("composition")! }; break;
      case "mapping": intent = { route, providerId, mappingId: read("mapping")! }; break;
      case "assets": intent = { route, providerId, assetId: read("asset")! }; break;
      case "sitemapper": {
        const pageId = read("page", true);
        intent = { route, providerId, sitemapId: read("sitemap")!, ...(pageId === undefined ? {} : { pageId }) }; break;
      }
      case "content": {
        const entryId = read("entry", true), viewId = read("view", true), fieldId = read("field", true);
        const pointer = params.get("path");
        if (params.getAll("path").length > 1 || (params.has("path") && !pointer)) throw new Error("This link must include one path pointer.");
        if (fieldId !== undefined && entryId === undefined) throw new Error("A Content field target requires an Entry.");
        if (pointer !== null && fieldId === undefined) throw new Error("A Content value path requires a field target.");
        const valuePath = pointer === null ? undefined : decodeContentValuePath(pointer);
        intent = { route, providerId, modelId: read("model")!, ...(entryId === undefined ? {} : { entryId }), ...(viewId === undefined ? {} : { viewId }), ...(fieldId === undefined ? {} : { fieldId }), ...(valuePath === undefined ? {} : { valuePath }) }; break;
      }
    }
    return { status: "matched", intent };
  } catch (cause) { return { status: "invalid", message: cause instanceof Error ? cause.message : "This workspace link is malformed." }; }
}

export function formatIntent(intent: RouteIntent): string {
  const params = new URLSearchParams();
  if ("providerId" in intent) params.set("provider", intent.providerId);
  switch (intent.route) {
    case "review": break;
    case "composer": if ("action" in intent) params.set("new", "1"); else params.set("composition", intent.compositionId); break;
    case "mapping": params.set("mapping", intent.mappingId); break;
    case "assets": params.set("asset", intent.assetId); break;
    case "sitemapper": params.set("sitemap", intent.sitemapId); if (intent.pageId !== undefined) params.set("page", intent.pageId); break;
    case "content": {
      params.set("model", intent.modelId);
      if (intent.entryId !== undefined) params.set("entry", intent.entryId);
      if (intent.viewId !== undefined) params.set("view", intent.viewId);
      if (intent.fieldId !== undefined) params.set("field", intent.fieldId);
      if (intent.valuePath !== undefined) params.set("path", encodeContentValuePath(intent.valuePath));
      break;
    }
  }
  const href = `/${intent.route}${params.size ? `?${params}` : ""}`;
  const result = parseIntent(href);
  if (result.status !== "matched") throw new TypeError(result.status === "invalid" ? result.message : "Missing route target.");
  return href;
}
