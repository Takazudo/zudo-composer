import { describe, expect, it } from "vitest";
import { decodeCompositionDocument } from "../codec";
import { COMPOSITION_SCHEMA_VERSION } from "../types";

describe("decodeCompositionDocument", () => {
  it("accepts only the current schema without rewriting the value", () => {
    const current = { schemaVersion: COMPOSITION_SCHEMA_VERSION, root: [] };
    expect(decodeCompositionDocument(current)).toEqual({ status: "current", document: current });
  });

  it("keeps malformed, older, and future values distinct", () => {
    expect(decodeCompositionDocument(null)).toEqual({ status: "malformed" });
    expect(decodeCompositionDocument({ schemaVersion: 1, root: [] })).toEqual({ status: "malformed" });
    expect(decodeCompositionDocument({ schemaVersion: COMPOSITION_SCHEMA_VERSION + 1 })).toEqual({
      status: "future-schema",
      foundSchemaVersion: COMPOSITION_SCHEMA_VERSION + 1,
    });
  });
});
