import { describe, expect, it } from "vitest";
import { fileProviderConfig } from "virtual:composer-file-provider-config";
import { createFileProviderMediaProvider, createFileProviderMediaStore } from "../store";

describe("production media file-provider boundary", () => {
  it("has no virtual capability or usable provider in the build shape", () => {
    expect(fileProviderConfig).toBeUndefined();
    expect(createFileProviderMediaStore()).toBeUndefined();
    expect(createFileProviderMediaProvider()).toBeUndefined();
  });
});
