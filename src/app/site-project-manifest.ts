import { componentPackManifestSchema, type JsonValue } from "@zudo-composer/component-contract";
import { activeComponentManifest } from "../features/composer/active-pack";
import { canonicalStringifyJson, type SiteProjectValidationContext } from "../site-project";

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * The application-owned, manifest-only bridge into pure SiteProject services.
 * It is parsed directly from the pinned active provider; no component runtime
 * functions or hand-maintained fallback component registry cross this seam.
 */
export const activeSiteProjectComponentManifest = deepFreeze(
  componentPackManifestSchema.parse(structuredClone(activeComponentManifest)),
);

export const activeSiteProjectValidationContext: SiteProjectValidationContext = Object.freeze({
  componentPack: activeSiteProjectComponentManifest,
});

export const ACTIVE_SITE_PROJECT_COMPONENT_PACK_REQUIREMENT = Object.freeze({
  contractVersion: activeSiteProjectComponentManifest.contractVersion,
  packId: activeSiteProjectComponentManifest.packId,
  packVersion: activeSiteProjectComponentManifest.packVersion,
});

/** Deterministic transport text derived solely from the validated active manifest. */
export function serializeActiveSiteProjectComponentManifest(): string {
  return canonicalStringifyJson(activeSiteProjectComponentManifest as unknown as JsonValue);
}
