import { describe, expect, it } from "vitest";
import { document } from "./fixtures";
import { decodeSitemapDocument, encodeSitemapDocument } from "../codec";
import { SITEMAP_SCHEMA_VERSION } from "../types";

describe("Sitemap codec", () => {
  it("round-trips a current document", () => {
    const value = document();
    expect(decodeSitemapDocument(JSON.parse(encodeSitemapDocument(value)))).toEqual({
      status: "current",
      document: value,
    });
  });

  it("dispatches only on schemaVersion without structural validation", () => {
    const malformedCurrent = { schemaVersion: SITEMAP_SCHEMA_VERSION, root: "wrong" };
    expect(decodeSitemapDocument(malformedCurrent)).toEqual({
      status: "current",
      document: malformedCurrent,
    });
  });

  it("distinguishes future and malformed schemas", () => {
    expect(decodeSitemapDocument({ schemaVersion: SITEMAP_SCHEMA_VERSION + 1 })).toEqual({
      status: "future-schema",
      foundSchemaVersion: SITEMAP_SCHEMA_VERSION + 1,
    });
    expect(decodeSitemapDocument({ schemaVersion: 0 })).toEqual({ status: "malformed" });
    expect(decodeSitemapDocument({ schemaVersion: 1.5 })).toEqual({ status: "malformed" });
    expect(decodeSitemapDocument({})).toEqual({ status: "malformed" });
    expect(decodeSitemapDocument(null)).toEqual({ status: "malformed" });
  });
});

