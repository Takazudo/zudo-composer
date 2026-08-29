import { describe, expect, it } from "vitest";
import { fixtureManifest } from "../../../__tests__/fixtures";
import { fileProviderConfig } from "virtual:composer-file-provider-config";
import { createFileProviderCompositionStore } from "../store";

describe("production file-provider boundary", () => {
  it("has no virtual capability or usable provider when the build-shaped module is used", () => {
    expect(fileProviderConfig).toBeUndefined();
    expect(createFileProviderCompositionStore({ catalog: fixtureManifest })).toBeUndefined();
  });
});
