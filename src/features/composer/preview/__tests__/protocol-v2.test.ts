import { describe, expect, it } from "vitest";
import { fixtureComponentManifest, createFixtureSampleDocument } from "../../test-support/fixture-pack";
import {
  COMPOSER_PREVIEW_PROTOCOL_VERSION,
  readParentToPreview,
  readPreviewToParent,
  readyMessage,
  requestHistoryMessage,
  renderMessage,
} from "../protocol";
import { canvasHistoryRequest } from "../preview-app";

const source = {};
const pack = { packId: fixtureComponentManifest.packId, packVersion: fixtureComponentManifest.packVersion };
const expected = { source, origin: "https://composer.test", pack };
const event = (data: unknown) => ({ source, origin: expected.origin, data });
const snapshot = () => {
  const document = createFixtureSampleDocument();
  return { document, localRecordId: document.id };
};

describe("Composer preview protocol v2 pack handshake", () => {
  it("stamps both directions with the exact active pack identity", () => {
    const ready = readyMessage(pack);
    const render = renderMessage(pack, 1, snapshot(), { mode: "edit", theme: "light", selectedId: null });
    expect(ready).toMatchObject({ v: 2, packId: fixtureComponentManifest.packId, packVersion: fixtureComponentManifest.packVersion });
    expect(render).toMatchObject({ v: COMPOSER_PREVIEW_PROTOCOL_VERSION, ...pack });
    expect(readPreviewToParent(event(ready), expected).ok).toBe(true);
    expect(readParentToPreview(event(render), expected).ok).toBe(true);
  });

  it.each(["packId", "packVersion"] as const)("rejects wrong %s before dispatch", (key) => {
    const ready = { ...readyMessage(pack), [key]: "wrong" };
    const render = { ...renderMessage(pack, 1, snapshot(), { mode: "edit", theme: "light", selectedId: null }), [key]: "wrong" };
    expect(readPreviewToParent(event(ready), expected)).toMatchObject({ ok: false, reason: "pack-mismatch" });
    expect(readParentToPreview(event(render), expected)).toMatchObject({ ok: false, reason: "pack-mismatch" });
  });

  it("requires an explicit local record identity", () => {
    const message = renderMessage(pack, 1, snapshot(), { mode: "edit", theme: "light", selectedId: null });
    const withoutRecord: Record<string, unknown> = { ...message };
    delete withoutRecord.localRecordId;
    expect(readParentToPreview(event(withoutRecord), expected)).toMatchObject({ ok: false, reason: "invalid-payload" });
  });
});

describe("Composer preview history requests", () => {
  it.each(["undo", "redo"] as const)("accepts a strict %s request", (direction) => {
    const message = requestHistoryMessage(pack, direction);
    expect(readPreviewToParent(event(message), expected)).toMatchObject({
      ok: true,
      message: { type: "request-history", direction },
    });
  });

  it.each([
    ["missing direction", { ...requestHistoryMessage(pack, "undo"), direction: undefined }],
    ["unknown direction", { ...requestHistoryMessage(pack, "undo"), direction: "back" }],
    ["extra key", { ...requestHistoryMessage(pack, "redo"), extra: true }],
  ])("rejects malformed history request: %s", (_label, message) => {
    expect(readPreviewToParent(event(message), expected)).toMatchObject({
      ok: false,
      reason: "invalid-payload",
    });
  });

  const keyEvent = (
    key: string,
    init: KeyboardEventInit,
    target: EventTarget | null = null,
  ): KeyboardEvent => {
    const keydown = new KeyboardEvent("keydown", { key, ...init });
    Object.defineProperty(keydown, "target", { value: target });
    return keydown;
  };

  it("uses the shared shortcut detector for non-editable canvas chrome", () => {
    expect(canvasHistoryRequest(keyEvent("z", { ctrlKey: true }), "edit", false)).toBe("undo");
    expect(canvasHistoryRequest(keyEvent("Z", { metaKey: true, shiftKey: true }), "edit", false)).toBe("redo");
    expect(canvasHistoryRequest(keyEvent("y", { ctrlKey: true }), "edit", false)).toBe("redo");
  });

  it("preserves native undo for inline sessions and editable targets", () => {
    const input = document.createElement("input");
    const editable = document.createElement("div");
    Object.defineProperty(editable, "isContentEditable", { value: true });

    expect(canvasHistoryRequest(keyEvent("z", { ctrlKey: true }), "edit", true)).toBeNull();
    expect(canvasHistoryRequest(keyEvent("z", { ctrlKey: true }, input), "edit", false)).toBeNull();
    expect(canvasHistoryRequest(keyEvent("z", { ctrlKey: true }, editable), "edit", false)).toBeNull();
  });

  it("suppresses history requests in preview mode", () => {
    expect(canvasHistoryRequest(keyEvent("z", { ctrlKey: true }), "preview", false)).toBeNull();
  });
});
