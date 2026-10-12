import { describe, expect, it } from "vitest";
import {
  hostedReadyMessage, hostedRenderMessage, hostedRenderedMessage, hostedDocumentErrorMessage,
  readHostedPreviewRequest, readHostedPreviewResponse, hostedRenderSchema,
  type HostedPreviewBinding,
} from "../preview";
import { readParentToPreview, readyMessage, readPreviewToParent } from "../../features/composer/preview/protocol";
const pack = { packId: "host-pack", packVersion: "1" };
const renderer = { rendererId: "real-renderer", rendererVersion: "3" };
const binding: HostedPreviewBinding = {
  frameSession: "boot-1", frameGeneration: 1, requestId: 1, snapshotId: "snapshot-A", snapshotDigest: "digest-A",
  draftRevision: "r1", baseline: { gitSha: "git-0", contentDigest: "content-0" }, definition: "definition-1", routeId: "course",
};
const source = {};
const expected = { source, origin: "https://host.example", pack, renderer };
const event = (data: unknown) => ({ data, source, origin: expected.origin });

describe("hosted document messages share the strict Composer wire", () => {
  it("uses the exact existing envelope and disjoint additive types", () => {
    const request = hostedRenderMessage(pack, renderer, binding, { title: "日本語", price: 0, hidden: false });
    expect(request.channel).toBe("composer-preview"); expect(request.v).toBe(2);
    expect(readHostedPreviewRequest(event(request), expected).ok).toBe(true);
    expect(readParentToPreview(event(request), expected).ok).toBe(false);
    expect(readHostedPreviewResponse(event(readyMessage(pack)), expected).ok).toBe(false);
    expect(readPreviewToParent(event(readyMessage(pack)), expected).ok).toBe(true);
  });
  it("checks exact owning window and origin before touching payload", () => {
    const bomb = { get type() { throw new Error("Must not read payload"); } };
    expect(readHostedPreviewRequest({ data: bomb, source: {}, origin: expected.origin }, expected)).toEqual({ ok: false, reason: "wrong-source" });
    expect(readHostedPreviewRequest({ data: bomb, source, origin: "https://foreign.example" }, expected)).toEqual({ ok: false, reason: "wrong-origin" });
    expect(readHostedPreviewRequest(event(bomb), { ...expected, source: null })).toEqual({ ok: false, reason: "wrong-source" });
  });
  it.each([
    { v: 1 }, { channel: "other" }, { type: "rendered" }, { extra: true }, { frameGeneration: -1 },
    { requestId: 0 }, { snapshotId: "" }, { routeId: "" }, { baseline: { gitSha: "g", contentDigest: "d", extra: true } },
  ])("rejects malformed envelope/binding %j", (change) => {
    const request = hostedRenderMessage(pack, renderer, binding, null);
    expect(readHostedPreviewRequest(event({ ...request, ...change }), expected)).toMatchObject({ ok: false, reason: "invalid-payload" });
  });
  it("requires exact pack and host renderer identity on readiness and results", () => {
    expect(readHostedPreviewResponse(event(hostedReadyMessage({ ...pack, packVersion: "2" }, renderer, "boot")), expected)).toMatchObject({ ok: false, reason: "pack-mismatch" });
    expect(readHostedPreviewResponse(event(hostedReadyMessage(pack, { ...renderer, rendererVersion: "4" }, "boot")), expected)).toMatchObject({ ok: false, reason: "renderer-mismatch" });
  });
  it.each([undefined, () => null, new Date(), Infinity, { vnode: () => null }, { module: new Map() }])("accepts only neutral JSON %j", (renderData) => {
    expect(hostedRenderSchema.safeParse({ ...hostedRenderMessage(pack, renderer, binding, null), renderData }).success).toBe(false);
  });
  it("rejects cyclic JSON, accessors and raw prototype keys without executing them", () => {
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    const accessor = { get unsafe() { throw new Error("Must not execute"); } };
    const prototype = JSON.parse('{"__proto__":{"polluted":true}}');
    const symbols = { [Symbol("hidden")]: "not JSON" };
    const array = Object.assign([1], { executable: "ignored property" });
    for (const renderData of [cyclic, accessor, prototype, symbols, array]) {
      expect(hostedRenderSchema.safeParse({ ...hostedRenderMessage(pack, renderer, binding, null), renderData }).success).toBe(false);
    }
  });
  it("strictly parses detached JSON and echoes all render identity into results", () => {
    const data = { slots: [{ value: "original" }] };
    const request = hostedRenderMessage(pack, renderer, binding, data);
    data.slots[0].value = "mutated";
    expect(request.renderData).toEqual({ slots: [{ value: "original" }] });
    const result = hostedRenderedMessage(request);
    expect(result).not.toHaveProperty("renderData");
    expect(result).toMatchObject(binding);
    expect(readHostedPreviewResponse(event(result), expected).ok).toBe(true);
    expect(readHostedPreviewResponse(event(hostedDocumentErrorMessage(request, "missing-dependency", "Image unavailable")), expected).ok).toBe(true);
  });
});
