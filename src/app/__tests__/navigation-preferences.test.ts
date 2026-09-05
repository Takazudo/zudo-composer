import { describe, expect, it } from "vitest";
import { pinAvailable, readPins, writePins, type NavigationModel, type NavigationPin } from "../navigation-preferences";
const model: NavigationModel = { providerId: "one", modelId: "people", label: "People", kind: "collection", views: [{ id: "contacts", label: "Contacts" }] };
const pin: NavigationPin = { label: "My contacts", target: { route: "content", providerId: "one", modelId: "people", viewId: "contacts" } };
describe("navigation preferences", () => {
  it("retains custom labels/order and uses provider-qualified model/view existence", () => {
    writePins([pin], localStorage);
    expect(readPins(localStorage)).toEqual([pin]);
    expect(pinAvailable(pin, [model])).toBe(true);
    expect(pinAvailable(pin, [{ ...model, providerId: "other" }])).toBe(false);
    expect(pinAvailable(pin, [{ ...model, views: [] }])).toBe(false);
  });
  it("drops malformed and duplicate preferences while keeping stale safe references available for removal", () => {
    const values = [pin, pin, { label: "x", target: { route: "content", modelId: "people" } }, { label: "bad", target: { ...pin.target, modelId: "../private" } }, { label: "entry", target: { ...pin.target, entryId: "person" } }];
    const storage = { getItem: () => JSON.stringify(values) } as unknown as Storage;
    expect(readPins(storage)).toEqual([pin]);
  });
  it("survives malformed or blocked storage", () => {
    expect(readPins({ getItem: () => "{" } as unknown as Storage)).toEqual([]);
    const storage = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } } as unknown as Storage;
    expect(readPins(storage)).toEqual([]);
    expect(() => writePins([pin], storage)).not.toThrow();
  });
});
