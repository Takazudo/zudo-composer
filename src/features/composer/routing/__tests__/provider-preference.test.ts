import { describe, expect, it, vi } from "vitest";

import {
  COMPOSER_PROVIDER_PREFERENCE_KEY,
  createComposerProviderPreference,
} from "../provider-preference";

describe("Composer provider preference adapter", () => {
  it("uses the stable localStorage key", () => {
    const storage = { getItem: vi.fn(() => "files"), setItem: vi.fn() };
    const preference = createComposerProviderPreference(storage);
    expect(preference.read()).toBe("files");
    preference.write("indexeddb");
    expect(storage.getItem).toHaveBeenCalledWith(COMPOSER_PROVIDER_PREFERENCE_KEY);
    expect(storage.setItem).toHaveBeenCalledWith(
      COMPOSER_PROVIDER_PREFERENCE_KEY,
      "indexeddb",
    );
  });

  it("supports a host-configured key", () => {
    const storage = { getItem: vi.fn(() => null), setItem: vi.fn() };
    const preference = createComposerProviderPreference(storage, "custom-provider-key");
    preference.read();
    preference.write("files");
    expect(storage.getItem).toHaveBeenCalledWith("custom-provider-key");
    expect(storage.setItem).toHaveBeenCalledWith("custom-provider-key", "files");
  });
});
