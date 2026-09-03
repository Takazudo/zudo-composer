import { describe, expect, it } from "vitest";
import { SITEMAP_SCHEMA_VERSION } from "../../model";
import type { SitemapDocument } from "../../model";
import {
  countUnassignedSitemapPages,
  loadSitemapRecord,
  SitemapPersistenceError,
  summarizeSitemap,
  validateSitemapRecord,
} from "..";
import type { SitemapRecord } from "..";

function record(id = "site-map"): SitemapRecord {
  const document: SitemapDocument = {
    schemaVersion: SITEMAP_SCHEMA_VERSION,
    id,
    name: "Site map",
    root: [{
      id: "home",
      title: "Home",
      source: { kind: "unassigned" },
      children: [{ id: "about", title: "About", source: { kind: "unassigned" }, children: [] }],
    }],
  };
  return {
    id,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    document,
  };
}

describe("Sitemap library records", () => {
  it("validates the envelope and enforces record/document id equality", () => {
    expect(validateSitemapRecord(record()).ok).toBe(true);
    expect(validateSitemapRecord(record("unsafe/id"))).toMatchObject({
      ok: false,
      issue: { code: "unsafe-id" },
    });
    expect(validateSitemapRecord({ ...record(), id: "another" })).toMatchObject({
      ok: false,
      issue: { code: "record-document-id-mismatch" },
    });
    expect(validateSitemapRecord(record().document)).toMatchObject({
      ok: false,
      issue: { code: "invalid-record-keys" },
    });
  });

  it("classifies invalid and future-schema data as outcomes preserving source", () => {
    const malformed = { ...record(), updatedAt: "yesterday" };
    expect(loadSitemapRecord(malformed)).toEqual({
      status: "invalid",
      issue: expect.objectContaining({ code: "invalid-updated-at" }),
      raw: malformed,
    });

    const future = {
      ...record(),
      document: { ...record().document, schemaVersion: SITEMAP_SCHEMA_VERSION + 1 },
    };
    expect(loadSitemapRecord(future)).toEqual({
      status: "future-schema",
      foundSchemaVersion: SITEMAP_SCHEMA_VERSION + 1,
      raw: future,
    });
  });

  it("uses one recursive summary shape", () => {
    expect(summarizeSitemap(record())).toEqual({
      id: "site-map",
      name: "Site map",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      pageCount: 2,
      unassignedCount: 2,
    });
  });

  it("counts only the pages with no Composition and no Mapping", () => {
    const assigned = record();
    assigned.document.root[0]!.source = { kind: "composition", ref: { providerId: "p", recordId: "c" } };
    expect(countUnassignedSitemapPages(assigned)).toBe(1);
    expect(summarizeSitemap(assigned).unassignedCount).toBe(1);
  });

  it("carries typed retryable operational failure metadata", () => {
    expect(new SitemapPersistenceError("get", "read-failed", "failed", true)).toMatchObject({
      name: "SitemapPersistenceError",
      operation: "get",
      code: "read-failed",
      retryable: true,
    });
    expect(new SitemapPersistenceError("put", "validation", "invalid", false)).toMatchObject({
      operation: "put",
      code: "validation",
      retryable: false,
    });
  });
});
