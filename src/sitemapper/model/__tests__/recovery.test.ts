import { describe, expect, it } from "vitest";
import { document } from "./fixtures";
import { loadSitemapDocument } from "../recovery";
import { SITEMAP_SCHEMA_VERSION } from "../types";

describe("loadSitemapDocument", () => {
  it.each([null, undefined, "", "   "])("returns a detached fresh sample for empty input", (raw) => {
    const sample = document();
    const outcome = loadSitemapDocument(raw, sample);
    expect(outcome.status).toBe("fresh");
    expect(outcome.document).toEqual(sample);
    expect(outcome.document).not.toBe(sample);
    expect(outcome.document.root[0]).not.toBe(sample.root[0]);
  });

  it("returns a valid current document", () => {
    const stored = document();
    stored.name = "Edited";
    const outcome = loadSitemapDocument(JSON.stringify(stored), document());
    expect(outcome).toEqual({ status: "ok", document: stored });
  });

  it("recovers unparseable, unsupported, and structurally invalid input", () => {
    expect(loadSitemapDocument("{bad", document())).toMatchObject({
      status: "recovered",
      reason: "invalid-json",
    });
    expect(loadSitemapDocument(JSON.stringify({}), document())).toMatchObject({
      status: "recovered",
      reason: "unsupported-schema",
    });
    expect(loadSitemapDocument(JSON.stringify({ ...document(), root: [] }), document())).toMatchObject({
      status: "recovered",
      reason: "invalid-document",
    });
  });

  it("quarantines a future schema and preserves the exact raw string", () => {
    const raw = ` { "schemaVersion": ${SITEMAP_SCHEMA_VERSION + 1}, "future": true } `;
    const sample = document();
    const outcome = loadSitemapDocument(raw, sample);
    expect(outcome).toEqual({
      status: "quarantined",
      document: sample,
      quarantinedRaw: raw,
      foundSchemaVersion: SITEMAP_SCHEMA_VERSION + 1,
    });
    expect(outcome.document).not.toBe(sample);
  });
});

