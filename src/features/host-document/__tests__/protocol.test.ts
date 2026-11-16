import { describe, expect, it } from "vitest";
import { acceptHostDocumentMessage, confirmedFirstAttemptRefusal, matchesHostDocumentFrame } from "../protocol";
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

it("binds visitor query/hash and accepts only captured same-origin navigation", () => {
  const navigable = { ...preview, navigation: { url: "/lessons/?course=old#pricing", pathnames: ["/lessons/", "/contact/"] } };
  const receiveNavigation = (data: unknown) => acceptHostDocumentMessage({ data, source, origin: "https://host.test" }, source, "https://host.test", navigable);
  const message = { ...ready, visitorUrl: navigable.navigation.url, type: "navigate", url: "/contact/?course=stable-id#inquiry" };
  expect(receiveNavigation(message)).toEqual({ type: "navigate", url: message.url });
  for (const url of ["//foreign.test/contact/", "https://foreign.test/contact/", "/not-captured/", "javascript:alert(1)"]) expect(receiveNavigation({ ...message, url })).toBeNull();
  expect(receiveNavigation({ ...message, visitorUrl: "/lessons/?course=other#pricing" })).toBeNull();
  expect(receiveNavigation({ ...message, type: "ready", url: undefined })).toBeNull();
  expect(receiveNavigation({ ...ready, visitorUrl: "/lessons/?course=other#pricing" })).toBeNull();
  const fragment = "/lessons/?course=old#next";
  expect(receiveNavigation({ ...message, visitorUrl: fragment, url: fragment })).toEqual({ type: "navigate", url: fragment });
});

it("requires the issued marker and complete post-bootstrap URL on every frame load", () => {
  const navigable = { ...preview, navigation: { url: "/lessons/?course=stable#price", pathnames: ["/lessons/"] } };
  const document = window.document.implementation.createHTMLDocument();
  const marker = document.createElement("meta"); marker.name = "zudo-host-document-frame"; marker.content = preview.frameId; document.head.append(marker);
  const frame = { contentDocument: document, contentWindow: { location: { href: "https://host.test/lessons/?course=stable#price" } } } as unknown as HTMLIFrameElement;
  expect(matchesHostDocumentFrame(frame, navigable, "https://host.test")).toBe(true);
  marker.remove(); expect(matchesHostDocumentFrame(frame, navigable, "https://host.test")).toBe(false);
  document.head.append(marker); marker.content = "other-frame"; expect(matchesHostDocumentFrame(frame, navigable, "https://host.test")).toBe(false);
  marker.content = preview.frameId;
  for (const href of ["https://foreign.test/lessons/?course=stable#price", "https://host.test/lessons/?course=wrong#price", "https://host.test/lessons/?course=stable#other"]) {
    Object.defineProperty(frame, "contentWindow", { configurable: true, value: { location: { href } } });
    expect(matchesHostDocumentFrame(frame, navigable, "https://host.test")).toBe(false);
  }
});

it("permits only a fragment change in the last pre-edit frame check", () => {
  const navigable = { ...preview, navigation: { url: "/lessons/?course=stable#old", pathnames: ["/lessons/"] } };
  const frame = { contentDocument: { querySelector: () => ({ getAttribute: () => preview.frameId }) }, contentWindow: { location: { href: "https://host.test/lessons/?course=stable#new" } } } as unknown as HTMLIFrameElement;
  expect(matchesHostDocumentFrame(frame, navigable, "https://host.test")).toBe(false);
  expect(matchesHostDocumentFrame(frame, navigable, "https://host.test", true)).toBe(true);
  Object.defineProperty(frame, "contentWindow", { value: { location: { href: "https://host.test/lessons/?course=other#new" } } });
  expect(matchesHostDocumentFrame(frame, navigable, "https://host.test", true)).toBe(false);
});
