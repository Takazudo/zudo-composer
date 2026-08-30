import { describe, expect, it } from "vitest";
import { document, node } from "./fixtures";
import { isStructurallyValidDocument } from "../validate";

function code(value: unknown): string {
  const result = isStructurallyValidDocument(value);
  return result.ok ? "ok" : result.code;
}

describe("isStructurallyValidDocument", () => {
  it("accepts the exact current shape and returns the typed document", () => {
    const value = document([
      {
        ...node("home", [node("about")]),
        slug: "home",
        notes: "Landing page",
        source: { kind: "composition", ref: { providerId: "indexeddb", recordId: "home-page" } },
      },
    ]);
    const result = isStructurallyValidDocument(value);
    expect(result).toEqual({ ok: true, document: value });
  });

  it.each([
    ["not-an-object", null],
    ["invalid-document-keys", { ...document(), extra: true }],
    ["unsupported-schema-version", { ...document(), schemaVersion: 1 }],
    ["invalid-document-id", { ...document(), id: "" }],
    ["invalid-document-name", { ...document(), name: 1 }],
    ["root-cardinality", { ...document(), root: [] }],
    ["root-cardinality", { ...document(), root: [node("a"), node("b")] }],
    ["invalid-node-keys", document([{ ...node("home"), extra: true } as never])],
    ["invalid-node-id", document([{ ...node("home"), id: "" }])],
    ["duplicate-node-id", document([node("same", [node("same")])])],
    ["invalid-node-title", document([{ ...node("home"), title: 1 } as never])],
    ["invalid-node-slug", document([{ ...node("home"), slug: 1 } as never])],
    [
      "invalid-source",
      document([{ ...node("home"), source: { kind: "composition", ref: { providerId: "", recordId: "valid" } } }]),
    ],
    [
      "invalid-source",
      document([{ ...node("home"), source: { kind: "composition", ref: { providerId: "indexeddb", recordId: "../bad" } } }]),
    ],
    ["invalid-node-notes", document([{ ...node("home"), notes: 1 } as never])],
    ["invalid-children", document([{ ...node("home"), children: {} } as never])],
  ])("returns %s", (expected, value) => {
    expect(code(value)).toBe(expected);
  });

  it("rejects a shared-reference cycle with its own code", () => {
    const root = node("home");
    root.children.push(root);
    expect(code(document([root]))).toBe("cycle");
  });

  it("rejects a value that changes into a non-JSON-safe leaf during validation", () => {
    const root = node("home") as unknown as Record<string, unknown>;
    let reads = 0;
    Object.defineProperty(root, "title", {
      enumerable: true,
      get: () => {
        reads += 1;
        return reads === 1 ? "Home" : undefined;
      },
    });
    expect(code(document([root as never]))).toBe("not-json-safe");
  });

  it("requires exact keys inside CompositionRef", () => {
    const value = document([
      {
        ...node("home"),
        source: { kind: "composition", ref: { providerId: "indexeddb", recordId: "home", extra: true } },
      } as never,
    ]);
    expect(code(value)).toBe("invalid-source");
  });

  it("accepts the exact source union and rejects Mapping nodes with authored children", () => {
    const mapping = { kind: "mapping" as const, ref: { providerId: "mapping", recordId: "articles" }, route: { kind: "entry-field" as const, fieldId: "slug", titleFieldId: "title" } };
    expect(code(document([{ ...node("articles"), source: mapping }]))).toBe("ok");
    expect(code(document([{ ...node("articles", [node("synthetic")]), source: mapping }]))).toBe("mapping-children");
    expect(code(document([{ ...node("articles"), source: { ...mapping, route: { kind: "single", fieldId: "slug" } } } as never]))).toBe("invalid-source");
    expect(code(document([{ ...node("articles"), source: { ...mapping, route: { ...mapping.route, titleFieldId: "../bad" } } } as never]))).toBe("invalid-source");
    expect(code(document([{ ...node("articles"), source: { ...mapping, route: { ...mapping.route, extra: true } } } as never]))).toBe("invalid-source");
  });
});
