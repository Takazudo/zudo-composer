import { describe, expect, it } from "vitest";
import { createHostEditRecovery } from "../recovery";
const storage = (): Storage => {
  const data = new Map<string, string>();
  return { get length() { return data.size; }, key: index => [...data.keys()][index] ?? null, getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: key => { data.delete(key); }, clear: () => data.clear() };
};
const id = (digit: string) => `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
const identity = { workspaceId: "pinsel", revision: "a".repeat(64), pathname: "/lessons/", packId: "pinsel", packVersion: "1", rendererId: "zfb", rendererVersion: "1", rendererDigest: "b".repeat(64) };
const request = (operationId = id("3")) => ({ workspaceId: identity.workspaceId, revision: identity.revision, pathname: identity.pathname, operationId, target: { renderedNodeId: "title", providerId: "files", recordId: "lessons", nodeId: "title" }, change: { kind: "field", prop: "text", value: "New title" } });
describe("durable host edit recovery", () => {
  it("retains exact request across a browser-session restart and clears only after receipt storage", () => {
    const local = storage(), ids = [id("1"), id("2")];
    const first = createHostEditRecovery(local, storage(), "http://localhost:4000", () => ids.shift()!);
    const pending = first.save(identity, { ...request(), change: { kind: "reorder-placement", direction: "up" } });
    const restarted = createHostEditRecovery(local, storage(), "http://localhost:4000", () => id("4"));
    expect(restarted.sessionId).not.toBe(first.sessionId);
    expect(restarted.list(identity)).toEqual([pending]);
    expect(restarted.list({ ...identity, workspaceId: "other" })).toEqual([]);
    expect(restarted.list({ ...identity, rendererId: "other" })).toEqual([]);
    expect(() => createHostEditRecovery(local, storage(), "http://localhost:5000", () => id("5")).list(identity)).toThrow("another origin");
    restarted.complete(pending, { operationId: `host-${pending.request.operationId}` });
    expect(restarted.list(identity)).toEqual([]);
    expect([...Array(local.length)].map((_, index) => local.key(index)).some(key => key?.endsWith(":receipt"))).toBe(true);
  });
  it("keeps independent tab requests and rejects mismatched identity or overwritten operation IDs", () => {
    const local = storage(), ids = [id("1"), id("2")];
    const first = createHostEditRecovery(local, storage(), "http://localhost:4000", () => ids.shift()!);
    const second = createHostEditRecovery(local, storage(), "http://localhost:4000", () => id("4"));
    const one = first.save(identity, request()); const two = second.save(identity, request(id("5")));
    expect(second.list(identity)).toHaveLength(2);
    expect(() => second.save(identity, request())).toThrow("another retained request");
    expect(() => first.save(identity, { ...request(id("6")), workspaceId: "other" })).toThrow("reviewed identity");
    first.complete(one); expect(second.list(identity)).toEqual([two]);
  });
  it("preserves malformed or uncertain records and does not clear pending if receipt storage fails", () => {
    const local = storage(), ids = [id("1"), id("2")];
    const recovery = createHostEditRecovery(local, storage(), "http://localhost:4000", () => ids.shift()!);
    const pending = recovery.save(identity, request());
    const normalSet = local.setItem;
    local.setItem = (key, value) => { if (key.endsWith(":receipt")) throw new Error("quota"); normalSet(key, value); };
    expect(() => recovery.complete(pending, {})).toThrow("quota");
    expect(recovery.list(identity)).toEqual([pending]);
    const key = [...Array(local.length)].map((_, index) => local.key(index)).find(key => key?.includes(pending.request.operationId))!;
    normalSet(key, "malformed");
    expect(() => recovery.list(identity)).toThrow("malformed"); expect(local.getItem(key)).toBe("malformed");
    expect(() => recovery.complete(pending)).toThrow("changed");
  });
});
