import { describe, expect, it } from "vitest";
import { createContentModelRecord, summarizeContentModel } from "../../library";
import { createContentCatalog } from "../catalog";
import type { ContentCatalogProvider } from "../types";

const model = createContentModelRecord({ name: "Posts", kind: "collection" }, { id: "posts", timestamp: "2026-01-01T00:00:00.000Z" });
function provider(id: string, overrides: Partial<ContentCatalogProvider["store"]> = {}): ContentCatalogProvider {
  return { descriptor: { id, label: id }, store: {
    listModels: async () => [summarizeContentModel(model)],
    getModel: async () => ({ status: "loaded", record: model }),
    ...overrides,
  } };
}

describe("Content catalog", () => {
  it("lists providers independently and isolates provider failures", async () => {
    const catalog = createContentCatalog([provider("good"), provider("bad", { listModels: async () => { throw new Error("offline"); } })]);
    expect(await catalog.listModels()).toEqual({ status: "listed", entries: [expect.objectContaining({ ref: { providerId: "good", recordId: "posts" } })], failures: [{ providerId: "bad", providerLabel: "bad", reason: "offline" }] });
  });

  it("distinguishes resolved, not-found, invalid, and provider-error outcomes", async () => {
    expect(await createContentCatalog([provider("good")]).resolveModel({ providerId: "good", recordId: "posts" })).toMatchObject({ status: "resolved" });
    expect(await createContentCatalog([]).resolveModel({ providerId: "missing", recordId: "posts" })).toEqual({ status: "not-found" });
    expect(await createContentCatalog([provider("bad", { getModel: async () => ({ status: "invalid", issue: { code: "invalid-record", message: "broken" }, raw: {} }) })]).resolveModel({ providerId: "bad", recordId: "posts" })).toEqual({ status: "invalid", reason: "broken" });
    expect(await createContentCatalog([provider("down", { getModel: async () => { throw new Error("down"); } })]).resolveModel({ providerId: "down", recordId: "posts" })).toEqual({ status: "provider-error", reason: "down" });
    expect(await createContentCatalog([]).resolveModel({ providerId: "", recordId: "../bad" })).toMatchObject({ status: "invalid" });
  });
});
