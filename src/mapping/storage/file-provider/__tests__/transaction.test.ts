import { describe, expect, expectTypeOf, it } from "vitest";
import { DomainFileProviderClient, type FileProviderConfig } from "../../../../shared/file-provider";
import type { MappingPersistenceOperation } from "../../../model";
import { mappingFileProviderErrorAdapter } from "../error-adapter";

const config: FileProviderConfig = {
  endpoint: "/provider", capability: "test", capabilityHeader: "x-capability",
  operationHeader: "x-operation", maxBodyBytes: 1024,
};

describe("Mapping batch error operation identity", () => {
  it("keeps the transport literal outside the domain operation union", () => {
    // @ts-expect-error The wire-only batch name is not a domain operation.
    expectTypeOf<"transaction">().toMatchTypeOf<MappingPersistenceOperation>();
  });

  it("converts a failed batch transport into the domain transact operation", async () => {
    const client = new DomainFileProviderClient(config, mappingFileProviderErrorAdapter, async () => { throw new Error("offline"); });
    await expect(client.transaction([])).rejects.toMatchObject({ operation: "transact", code: "unavailable" });
  });

  it.each(["transaction", "future-server-operation"])("converts an unrecognized wire operation %s using the batch fallback", async (operation) => {
    const client = new DomainFileProviderClient(config, mappingFileProviderErrorAdapter, async () => new Response(JSON.stringify({
      ok: false, error: { domain: "mapping", operation, code: "future-code", message: "Batch failed" },
    }), { status: 500 }));
    await expect(client.transaction([])).rejects.toMatchObject({ operation: "transact", code: "unknown", message: "Batch failed" });
  });
});
