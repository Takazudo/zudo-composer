import { beforeEach, describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/preact";
import { generateJsx, type CompositionRecord } from "../../../../../composer/browser";
import { TEST_COMPONENT_IDS, makeDocument, makeNode, resetTestIds, testManifest } from "../../test-support/composer-fixtures";
import { useComposerExport } from "../use-composer-export";

beforeEach(() => {
  resetTestIds();
});

describe("useComposerExport", () => {
  it("starts closed with no result", () => {
    const doc = makeDocument([makeNode(TEST_COMPONENT_IDS.label, { text: "Hi" })]);
    const { result } = renderHook(() => useComposerExport(() => doc, testManifest));
    expect(result.current.open).toBe(false);
    expect(result.current.result).toBeNull();
  });

  it("openExport generates a result that is byte-for-byte the direct generateJsx() output", () => {
    const doc = makeDocument([makeNode(TEST_COMPONENT_IDS.label, { text: "Hi" })], "Byte parity doc");
    const { result } = renderHook(() => useComposerExport(() => doc, testManifest));

    act(() => result.current.openExport());

    expect(result.current.open).toBe(true);
    const direct = generateJsx(doc, testManifest);
    expect(result.current.result).toEqual(direct);
    expect(result.current.result!.code).toBe(direct.code);
  });

  it("surfaces a blocked result (opaque node) exactly as the generator reports it", () => {
    const doc = makeDocument([makeNode("unknown.thing", {})]);
    const { result } = renderHook(() => useComposerExport(() => doc, testManifest));

    act(() => result.current.openExport());

    expect(result.current.result!.ok).toBe(false);
    expect(result.current.result!.blocked).toBe(true);
    expect(result.current.result!.code).toBe("");
    expect(result.current.result).toEqual(generateJsx(doc, testManifest));
  });

  it("closeExport hides the dialog without discarding the last result", () => {
    const doc = makeDocument([makeNode(TEST_COMPONENT_IDS.label, { text: "Hi" })]);
    const { result } = renderHook(() => useComposerExport(() => doc, testManifest));

    act(() => result.current.openExport());
    act(() => result.current.closeExport());

    expect(result.current.open).toBe(false);
    expect(result.current.result).not.toBeNull();
  });

  it("returns a typed dependency block instead of local-only JSX for an unresolved bound record", () => {
    const doc = makeDocument([makeNode(TEST_COMPONENT_IDS.label, { text: "Local only" })]);
    doc.binding = { sourceRecordId: "source", outletId: "outlet-main" };
    const record: CompositionRecord = {
      id: doc.id,
      createdAt: "2026-07-14T00:00:00.000Z",
      updatedAt: "2026-07-14T00:00:00.000Z",
      document: doc,
    };
    const { result } = renderHook(() => useComposerExport(() => doc, testManifest, { record }));

    act(() => result.current.openExport());

    expect(result.current.open).toBe(true);
    expect(result.current.result).toBeNull();
    expect(result.current.copyOutcome).toMatchObject({
      status: "blocked",
      diagnostic: { kind: "dependency", code: "missing-resolution" },
    });
  });
});
