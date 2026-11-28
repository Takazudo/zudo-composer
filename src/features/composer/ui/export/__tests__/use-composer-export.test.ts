import { beforeEach, describe, expect, it } from "vitest";
import { generateJsx, type CompositionRecord } from "../../../../../composer/browser";
import { TEST_COMPONENT_IDS, makeDocument, makeNode, resetTestIds, testManifest } from "../../test-support/composer-fixtures";
import { createComposerExport } from "../use-composer-export";

beforeEach(() => {
  resetTestIds();
});

describe("createComposerExport", () => {
  it("starts closed with no result", () => {
    const doc = makeDocument([makeNode(TEST_COMPONENT_IDS.label, { text: "Hi" })]);
    const exp = createComposerExport(() => doc, testManifest);
    expect(exp.open.value).toBe(false);
    expect(exp.result.value).toBeNull();
  });

  it("openExport generates a result that is byte-for-byte the direct generateJsx() output", () => {
    const doc = makeDocument([makeNode(TEST_COMPONENT_IDS.label, { text: "Hi" })], "Byte parity doc");
    const exp = createComposerExport(() => doc, testManifest);

    exp.openExport();

    expect(exp.open.value).toBe(true);
    const direct = generateJsx(doc, testManifest);
    expect(exp.result.value).toEqual(direct);
    expect(exp.result.value!.code).toBe(direct.code);
  });

  it("surfaces a blocked result (opaque node) exactly as the generator reports it", () => {
    const doc = makeDocument([makeNode("unknown.thing", {})]);
    const exp = createComposerExport(() => doc, testManifest);

    exp.openExport();

    expect(exp.result.value!.ok).toBe(false);
    expect(exp.result.value!.blocked).toBe(true);
    expect(exp.result.value!.code).toBe("");
    expect(exp.result.value).toEqual(generateJsx(doc, testManifest));
  });

  it("closeExport hides the dialog without discarding the last result", () => {
    const doc = makeDocument([makeNode(TEST_COMPONENT_IDS.label, { text: "Hi" })]);
    const exp = createComposerExport(() => doc, testManifest);

    exp.openExport();
    exp.closeExport();

    expect(exp.open.value).toBe(false);
    expect(exp.result.value).not.toBeNull();
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
    const exp = createComposerExport(() => doc, testManifest, { record });

    exp.openExport();

    expect(exp.open.value).toBe(true);
    expect(exp.result.value).toBeNull();
    expect(exp.copyOutcome.value).toMatchObject({
      status: "blocked",
      diagnostic: { kind: "dependency", code: "missing-resolution" },
    });
  });
});
