import { describe, expect, it } from "vitest";
import { acceptHostDocumentMessage, confirmedFirstAttemptRefusal } from "../protocol";
import type { HostDocumentPreview } from "../../../../server/host-document/types";
const identity = { workspaceId: "pinsel", revision: "a".repeat(64), pathname: "/lessons/", packId: "pinsel", packVersion: "1", rendererId: "zfb", rendererVersion: "1", rendererDigest: "b".repeat(64) };
const target = { renderedNodeId: "mapped-price", providerId: "files", recordId: "consultation", nodeId: "price", componentId: "price", parentRenderedNodeId: null, slotId: null, props: {}, entries: [] };
const preview: HostDocumentPreview = { identity, frameId: "frame", html: "", targets: [target] };
const source = {} as Window;
const ready = { protocol: "zudo-host-document-v1", type: "ready", identity, frameId: "frame" };
const receive = (data: unknown, sender: MessageEventSource = source, origin = "https://host.test") => acceptHostDocumentMessage({ data, source: sender, origin }, source, "https://host.test", preview);
describe("host document evidence", () => {
  it("accepts only the exact frame and every reviewed identity", () => {
    expect(receive(ready)).toEqual({ type: "ready" });
    expect(receive(ready, {} as Window)).toBeNull(); expect(receive(ready, source, "https://foreign.test")).toBeNull();
    for (const key of Object.keys(identity)) expect(receive({ ...ready, identity: { ...identity, [key]: "stale" } })).toBeNull();
    expect(receive({ ...ready, frameId: "old-frame" })).toBeNull(); expect(receive({ ...ready, extra: true })).toBeNull();
  });
  it("resolves selection only to a qualified target from that document", () => {
    const { renderedNodeId, providerId, recordId, nodeId } = target;
    const message = { ...ready, type: "select", target: { renderedNodeId, providerId, recordId, nodeId } };
    expect(receive(message)).toEqual({ type: "select", target });
    expect(receive({ ...message, target: { ...message.target, recordId: "other" } })).toBeNull();
  });
});

it("never discards an uncertain original request because recovery now fails its current guards", () => {
  for (const code of ["stale-plan", "wrong-workspace", "invalid-request", "component-invalid"]) {
    expect(confirmedFirstAttemptRefusal(true, code)).toBe(false);
    expect(confirmedFirstAttemptRefusal(false, code)).toBe(true);
  }
  expect(confirmedFirstAttemptRefusal(false, "commit-uncertain")).toBe(false);
});
