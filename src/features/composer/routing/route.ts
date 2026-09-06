import type { CompositionProviderId, CompositionRecordRef } from "../../../composer/browser";
import { formatIntent, parseIntent, type RouteIntentLocation } from "../../../app/route-intents";

export type ComposerRoute = { readonly kind: "index" } | ({ readonly kind: "detail" } & Readonly<CompositionRecordRef>);
export type ComposerRouteErrorCode = "wrong-document-path" | "invalid-route" | "unknown-provider";
export interface ComposerRouteError extends RouteIntentLocation { readonly code: ComposerRouteErrorCode; readonly message: string }
export type ComposerRouteResolution = { readonly status: "matched"; readonly route: ComposerRoute } | { readonly status: "not-found"; readonly error: ComposerRouteError };
export type ComposerRouteLocation = RouteIntentLocation;
export interface ComposerRouteConfig { readonly isKnownProvider: (providerId: string) => boolean }
export const COMPOSER_DOCUMENT_PATH = "/composer";

export function parseComposerRoute(location: ComposerRouteLocation, config: ComposerRouteConfig): ComposerRouteResolution {
  const error = (code: ComposerRouteErrorCode, message: string): ComposerRouteResolution => ({ status: "not-found", error: { ...location, code, message } });
  if (location.pathname !== COMPOSER_DOCUMENT_PATH) return error("wrong-document-path", "This is not the Composer document.");
  const outcome = parseIntent(location);
  if (outcome.status === "invalid") return error("invalid-route", outcome.message);
  if (outcome.status === "none" || (outcome.intent.route === "composer" && "action" in outcome.intent)) return { status: "matched", route: { kind: "index" } };
  if (outcome.intent.route !== "composer") return error("invalid-route", "This is not a Composition target.");
  if (!config.isKnownProvider(outcome.intent.providerId)) return error("unknown-provider", `The composition provider "${outcome.intent.providerId}" is not available.`);
  return { status: "matched", route: { kind: "detail", providerId: outcome.intent.providerId as CompositionProviderId, recordId: outcome.intent.compositionId } };
}
export function formatComposerRoute(route: ComposerRoute): string {
  return route.kind === "index" ? COMPOSER_DOCUMENT_PATH : formatIntent({ route: "composer", providerId: route.providerId, compositionId: route.recordId });
}
