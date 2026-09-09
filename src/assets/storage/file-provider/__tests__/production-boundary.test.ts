import { describe, expect, it } from "vitest";
import { fileProviderConfig } from "virtual:composer-file-provider-config";
import { createFileProviderAssetProvider, createFileProviderAssetStore } from "../store";

describe("production assets file-provider boundary", () => {
  it("has no virtual capability or usable provider in the build shape", () => {
    expect(fileProviderConfig).toBeUndefined();
    expect(createFileProviderAssetStore()).toBeUndefined();
    expect(createFileProviderAssetProvider()).toBeUndefined();
  });
});
