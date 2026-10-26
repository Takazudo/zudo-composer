import { describe, expect, it } from "vitest";
import { nativeBrowserOwner, type NativeBrowserOwner } from "../session-owner";
describe("browser revision ownership across module and server lifetimes", () => {
  it("preserves the original client and old epoch through HMR", () => {
    const scope: { [key: symbol]: NativeBrowserOwner | undefined } = {};
    const first = nativeBrowserOwner(scope, "server-a", () => "original"); first.owner.epoch = 4;
    const next = nativeBrowserOwner(scope, "server-a", () => "must-not-rebind-fresh");
    expect(next.owner).toBe(first.owner); expect(next.owner.epoch).toBe(4); expect(next.changedServer).toBe(false);
  });
  it("refuses a new server's reset epoch without overwriting retained ownership", () => {
    const scope: { [key: symbol]: NativeBrowserOwner | undefined } = {};
    const first = nativeBrowserOwner(scope, "server-a", () => "old"); first.owner.epoch = 0;
    const restarted = nativeBrowserOwner(scope, "server-b", () => "fresh");
    expect(restarted.changedServer).toBe(true); expect(restarted.owner).toEqual({ clientId: "old", capability: "server-a", epoch: 0 });
    expect(nativeBrowserOwner(scope, "server-b", () => "fresh").changedServer).toBe(true);
  });
});
