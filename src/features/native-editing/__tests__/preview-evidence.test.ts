import { describe, expect, it } from "vitest";
import { createComposerPreviewBridge } from "../../composer/preview/bridge";
import { readParentToPreview, readPreviewToParent, renderMessage, renderedMessage, readyMessage, type MessageEventLike, type NativeReviewIdentity } from "../../composer/preview/protocol";
import { fixtureComponentManifest, createFixtureSampleDocument } from "../../composer/test-support/fixture-pack";

const pack = { packId: fixtureComponentManifest.packId, packVersion: fixtureComponentManifest.packVersion };
const review: NativeReviewIdentity = { planId: "plan-one", digest: "a".repeat(64), dependencyDigest: "b".repeat(64), identity: { workspaceId: "work", sitemapId: "site", pageId: "home", providerId: "files", recordId: "home" }, frameSession: "11111111-1111-4111-8111-111111111111" };
const origin = "https://composer.test";

describe("native successful-render evidence", () => {
  it("accepts strict data evidence only from the exact source, origin and pack", () => {
    const source = {};
    const payload = renderedMessage(pack, 2, review);
    const event = { data: payload, source, origin };
    expect(readPreviewToParent(event, { source, origin, pack }).ok).toBe(true);
    expect(readPreviewToParent({ ...event, source: {} }, { source, origin, pack }).ok).toBe(false);
    expect(readPreviewToParent({ ...event, origin: "https://other.test" }, { source, origin, pack }).ok).toBe(false);
    expect(readPreviewToParent({ ...event, data: { ...payload, packVersion: "wrong" } }, { source, origin, pack }).ok).toBe(false);
    expect(readPreviewToParent({ ...event, data: { ...payload, jsx: "execute()" } }, { source, origin, pack }).ok).toBe(false);
    expect(readPreviewToParent({ ...event, data: { ...payload, nativeReview: { ...review, approve: true } } }, { source, origin, pack }).ok).toBe(false);
  });
  it("refuses editable review snapshots", () => {
    const source = {};
    const document = createFixtureSampleDocument();
    const payload = renderMessage(pack, 1, { document, localRecordId: document.id, nativeReview: review }, { mode: "edit", theme: "light", selectedId: null });
    expect(readParentToPreview({ data: payload, source, origin }, { source, origin, pack })).toMatchObject({ ok: false, reason: "invalid-payload" });
  });
  it("boot readiness and an old/replaced frame acknowledgment never reach current render evidence", () => {
    let listener!: (event: MessageEventLike) => void;
    const frameWindow = { postMessage() {} };
    const frame = { contentWindow: frameWindow };
    let accepted = 0;
    const bridge = createComposerPreviewBridge({ frame, location: { src: "/composer/preview", targetOrigin: origin }, hostWindow: { addEventListener(_, next) { listener = next; }, removeEventListener() {} }, pack, onRendered: () => accepted++ });
    const document = createFixtureSampleDocument();
    const revision = bridge.render({ document, localRecordId: document.id, nativeReview: review }, { mode: "preview", theme: "light", selectedId: null });
    listener({ source: frameWindow, origin, data: readyMessage(pack) }); expect(accepted).toBe(0);
    listener({ source: frameWindow, origin, data: renderedMessage(pack, revision, review) }); expect(accepted).toBe(0);
    listener({ source: frameWindow, origin, data: renderedMessage(pack, bridge.revision, review) }); expect(accepted).toBe(1);
    listener({ source: frameWindow, origin, data: renderedMessage(pack, bridge.revision, { ...review, planId: "other" }) }); expect(accepted).toBe(1);
    listener({ source: frameWindow, origin, data: renderedMessage(pack, bridge.revision, { ...review, frameSession: "22222222-2222-4222-8222-222222222222" }) }); expect(accepted).toBe(1);
    frame.contentWindow = { postMessage() {} };
    listener({ source: frameWindow, origin, data: renderedMessage(pack, bridge.revision, review) }); expect(accepted).toBe(1);
    bridge.dispose();
  });
});
