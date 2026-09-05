import { describe, expect, it, vi } from "vitest";
import { activeComponentProvider } from "../../features/composer/active-pack";
import { createMappingAttachmentService } from "../mapping-attachment-service";

describe("mapping attachment aggregate service", () => {
  it("guards save-session flush re-entry", async () => {
    const flushTarget: { service?: ReturnType<typeof createMappingAttachmentService> } = {};
    const flush = vi.fn(async () => {
      await flushTarget.service?.flush?.();
      return { status: "ready" as const, generation: 0 };
    });
    const service = createMappingAttachmentService({
      getCurrentSiteProject: async () => { throw new Error("not called"); },
      workspace: {
        metadata: async () => { throw new Error("not called"); },
        updateMetadata: async () => { throw new Error("not called"); },
      },
      componentCatalog: activeComponentProvider.catalog,
      flush,
      subscribe: () => () => undefined,
    });
    flushTarget.service = service;

    await service.flush?.();

    expect(flush).toHaveBeenCalledTimes(1);
  });
});
