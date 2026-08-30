import { describe, expect, it } from "vitest";
import {
  createMediaRecord,
  decodeMediaRecord,
  loadMediaRecord,
  MEDIA_SCHEMA_VERSION,
  validateMediaRecord,
} from "../../";

const timestamp = "2026-01-01T00:00:00.000Z";
const checksum = "a".repeat(64);

function record() {
  return createMediaRecord({ fileName: "hero.png", mediaType: "image/png", byteLength: 42, checksum }, { id: "hero", timestamp });
}

describe("Media records", () => {
  it("validates the exact JSON-safe metadata envelope", () => {
    const value = record();
    expect(validateMediaRecord(value)).toEqual({ ok: true, value });
    expect(validateMediaRecord({ ...value, extra: true })).toMatchObject({ ok: false, issue: { code: "invalid-record" } });
    expect(validateMediaRecord({ ...value, document: { ...value.document, extra: true } })).toMatchObject({ ok: false, issue: { code: "malformed-document" } });
    expect(validateMediaRecord({ ...value, document: { ...value.document, checksum: Number.NaN } })).toMatchObject({ ok: false, issue: { code: "not-json-safe" } });
  });

  it.each([
    [null, "invalid-record"],
    [{ ...record(), id: "../escape" }, "unsafe-id"],
    [{ ...record(), document: { ...record().document, id: "other" } }, "id-mismatch"],
    [{ ...record(), createdAt: "not-a-date" }, "invalid-timestamp"],
    [{ ...record(), createdAt: "2026-01-02T00:00:00.000Z", updatedAt: timestamp }, "invalid-timestamp-order"],
    [{ ...record(), document: { ...record().document, fileName: "" } }, "invalid-file-name"],
    [{ ...record(), document: { ...record().document, fileName: "has/name.png" } }, "invalid-file-name"],
    [{ ...record(), document: { ...record().document, mediaType: "image/svg+xml" } }, "invalid-media-type"],
    [{ ...record(), document: { ...record().document, byteLength: -1 } }, "invalid-byte-length"],
    [{ ...record(), document: { ...record().document, checksum: "not-a-sha" } }, "invalid-checksum"],
  ] as const)("rejects %s with %s", (value, code) => {
    expect(validateMediaRecord(value)).toMatchObject({ ok: false, issue: { code } });
  });

  it("quarantines a newer document without changing the raw value", () => {
    const future = { ...record(), document: { ...record().document, schemaVersion: MEDIA_SCHEMA_VERSION + 1 } };
    expect(loadMediaRecord(future)).toEqual({ status: "future-schema", foundSchemaVersion: 2, raw: future });
    expect(decodeMediaRecord(future)).toEqual({ status: "future-schema", foundSchemaVersion: 2, raw: future });
  });

  it("retains malformed records as invalid outcomes", () => {
    const malformed = { ...record(), document: { ...record().document, checksum: "bad" } };
    expect(loadMediaRecord(malformed)).toEqual({ status: "invalid", issue: expect.objectContaining({ code: "invalid-checksum" }), raw: malformed });
  });
});
