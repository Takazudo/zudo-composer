import { describe, expect, it } from "vitest";
import {
  createAssetRecord,
  decodeAssetRecord,
  loadAssetRecord,
  ASSET_SCHEMA_VERSION,
  validateAssetRecord,
} from "../../";

const timestamp = "2026-01-01T00:00:00.000Z";
const checksum = "a".repeat(64);

function record() {
  return createAssetRecord({ fileName: "hero.png", mimeType: "image/png", byteLength: 42, checksum }, { id: "hero", timestamp });
}
function versionPatch(patch: Record<string, unknown>) {
  const value = record();
  return { ...value, document: { ...value.document, versions: [{ ...value.document.versions[0], ...patch }] } };
}

describe("Assets records", () => {
  it("validates the exact JSON-safe metadata envelope", () => {
    const value = record();
    expect(validateAssetRecord(value)).toEqual({ ok: true, value });
    expect(validateAssetRecord({ ...value, extra: true })).toMatchObject({ ok: false, issue: { code: "invalid-record" } });
    expect(validateAssetRecord({ ...value, document: { ...value.document, extra: true } })).toMatchObject({ ok: false, issue: { code: "malformed-document" } });
    expect(validateAssetRecord(versionPatch({ byteLength: Number.NaN }))).toMatchObject({ ok: false, issue: { code: "not-json-safe" } });
  });

  it.each([
    [null, "invalid-record"],
    [{ ...record(), id: "../escape" }, "unsafe-id"],
    [{ ...record(), document: { ...record().document, id: "other" } }, "id-mismatch"],
    [{ ...record(), createdAt: "not-a-date" }, "invalid-timestamp"],
    [{ ...record(), createdAt: "2026-01-02T00:00:00.000Z", updatedAt: timestamp }, "invalid-timestamp-order"],
    [{ ...record(), document: { ...record().document, fileName: "" } }, "invalid-file-name"],
    [{ ...record(), document: { ...record().document, fileName: "has/name.png" } }, "invalid-file-name"],
    [versionPatch({ mimeType: "image/svg+xml" }), "invalid-mime-type"],
    [versionPatch({ byteLength: -1 }), "invalid-byte-length"],
    [versionPatch({ checksum: "not-a-sha" }), "invalid-checksum"],
    [versionPatch({ url: "/elsewhere" }), "malformed-document"],
    [{ ...record(), revision: 0 }, "invalid-record"],
  ] as const)("rejects %s with %s", (value, code) => {
    expect(validateAssetRecord(value)).toMatchObject({ ok: false, issue: { code } });
  });

  it("quarantines a newer document without changing the raw value", () => {
    const future = { ...record(), document: { ...record().document, schemaVersion: ASSET_SCHEMA_VERSION + 1 } };
    expect(loadAssetRecord(future)).toEqual({ status: "future-schema", foundSchemaVersion: ASSET_SCHEMA_VERSION + 1, raw: future });
    expect(decodeAssetRecord(future)).toEqual({ status: "future-schema", foundSchemaVersion: ASSET_SCHEMA_VERSION + 1, raw: future });
  });

  it("retains malformed records as invalid outcomes", () => {
    const malformed = versionPatch({ checksum: "bad" });
    expect(loadAssetRecord(malformed)).toEqual({ status: "invalid", issue: expect.objectContaining({ code: "invalid-checksum" }), raw: malformed });
  });
  it("rejects provisional formats, missing heads, and duplicate immutable versions", () => {
    const value = record();
    expect(validateAssetRecord({ ...value, document: { ...value.document, schemaVersion: 0 } }).ok).toBe(false);
    expect(validateAssetRecord({ ...value, document: { ...value.document, currentVersionId: "b".repeat(64) } }).ok).toBe(false);
    expect(validateAssetRecord({ ...value, document: { ...value.document, versions: [...value.document.versions, ...value.document.versions] } }).ok).toBe(false);
    expect(validateAssetRecord({ ...value, document: { ...value.document, state: ["active"] } }).ok).toBe(false);
  });
});
