import { describe, expect, it } from "vitest";
import { activeComponentManifest, createActiveSampleDocument } from "../../active-pack";
import {
  COMPOSER_PREVIEW_PROTOCOL_VERSION,
  readParentToPreview,
  readPreviewToParent,
  readyMessage,
  renderMessage,
} from "../protocol";

const source = {};
const pack = { packId: activeComponentManifest.packId, packVersion: activeComponentManifest.packVersion };
const expected = { source, origin: "https://composer.test", pack };
const event = (data: unknown) => ({ source, origin: expected.origin, data });
const snapshot = () => {
  const document = createActiveSampleDocument();
  return { document, localRecordId: document.id };
};

describe("Composer preview protocol v2 pack handshake", () => {
  it("stamps both directions with the exact active pack identity", () => {
    const ready = readyMessage(pack);
    const render = renderMessage(pack, 1, snapshot(), { mode: "edit", theme: "light", selectedId: null });
    expect(ready).toMatchObject({ v: 2, packId: activeComponentManifest.packId, packVersion: activeComponentManifest.packVersion });
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
