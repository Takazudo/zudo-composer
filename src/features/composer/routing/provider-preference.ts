import type { CompositionProviderId } from "../../../composer/browser";

export const COMPOSER_PROVIDER_PREFERENCE_KEY = "zudo-composer-provider";

export interface ComposerProviderPreference {
  read(): string | null;
  write(providerId: CompositionProviderId): void;
}

export interface ComposerPreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Small localStorage-compatible adapter. Best-effort behavior lives in the
 * coordinator so injected storage is allowed to throw here.
 */
export function createComposerProviderPreference(
  storage: ComposerPreferenceStorage,
  key = COMPOSER_PROVIDER_PREFERENCE_KEY,
): ComposerProviderPreference {
  return {
    read: () => storage.getItem(key),
    write: (providerId) => storage.setItem(key, providerId),
  };
}
