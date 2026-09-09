import { describe, expect, it } from "vitest";
import { createAssetRecord } from "../../../assets";
import { createMemoryAssetProvider } from "../fixtures";

const timestamp = "2026-01-01T00:00:00.000Z";
const bytes = new Uint8Array([1, 2, 3]);
const checksum = "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81";

function asset(id: string, updatedAt = timestamp) {
  return createAssetRecord({ fileName: `${id}.png`, mimeType: "image/png", byteLength: bytes.byteLength, checksum }, { id, timestamp: updatedAt });
}

describe("in-memory Asset provider", () => {
  it("lists summaries newest-first and returns detached records", async () => {
    const provider = createMemoryAssetProvider({ records: [asset("older"), asset("newer", "2026-01-02T00:00:00.000Z")] });
    expect(await provider.initialization.initialize()).toMatchObject({ status: "ready", summaries: [{ id: "newer" }, { id: "older" }] });
    expect(await provider.store.list()).toMatchObject([{ id: "newer" }, { id: "older" }]);
    const loaded = await provider.store.get("newer");
    expect(loaded.status).toBe("loaded");
    if (loaded.status === "loaded") {
      loaded.record.document.fileName = "mutated.png";
      expect(await provider.store.get("newer")).toMatchObject({ status: "loaded", record: { document: { fileName: "newer.png" } } });
    }
  });

  it("reports absent and mismatched bytes separately from valid metadata", async () => {
    const provider = createMemoryAssetProvider({
      records: [asset("present"), asset("missing"), asset("mismatch")],
      bytes: { present: bytes, mismatch: new Uint8Array([9]) },
      missingBytes: ["missing"],
    });
    expect(await provider.store.get("present")).toMatchObject({ status: "loaded" });
    expect(await provider.store.get("missing")).toMatchObject({ status: "bytes-missing", reason: "missing" });
    expect(await provider.store.get("mismatch")).toMatchObject({ status: "bytes-missing", reason: "checksum-mismatch" });
  });

  it("supports writes, idempotent deletes, seed, and explicit startFresh", async () => {
    const provider = createMemoryAssetProvider();
    await provider.store.put(asset("one"), bytes);
    expect(await provider.store.get("one")).toMatchObject({ status: "loaded" });
    expect(await provider.store.delete("one")).toBe(true);
    expect(await provider.store.delete("one")).toBe(false);
    await provider.store.seed!({ records: [asset("seeded")], bytes: { seeded: bytes } });
    expect(await provider.store.list()).toHaveLength(1);
    expect((await provider.initialization.startFresh()).status).toBe("ready");
    expect(await provider.store.list()).toEqual([]);
  });

  it("quarantines malformed fixture metadata until startFresh", async () => {
    const valid = asset("valid");
    const future = { ...valid, id: "future", document: { ...valid.document, id: "future", schemaVersion: 3 } };
    const provider = createMemoryAssetProvider({ records: [valid, future as never] });
    expect(await provider.initialization.initialize()).toMatchObject({
      status: "recovery-required",
      summaries: [{ id: "valid" }],
      recovery: { reason: "future-schema", sourcePreserved: true, affectedRecordIds: ["future"] },
    });
    expect(await provider.store.get("future")).toMatchObject({ status: "future-schema" });
    await provider.initialization.startFresh();
    expect(await provider.store.list()).toEqual([]);
  });
});
