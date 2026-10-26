import { describe, expect, it } from "vitest";
import { createBrowserCoordinator } from "../browser-coordinator.mjs";

describe("browser authoring exclusion", () => {
  it("blocks dirty tabs, never accepts the requesting tab's clean claim for another", async () => {
    const gate = createBrowserCoordinator({ challengeMs: 20 });
    const a = { send: (value: { challenge: string; epoch: number }) => gate.answer("a", a, value.challenge, value.epoch, true), resume: () => {} };
    const b = { send: (value: { challenge: string; epoch: number }) => gate.answer("b", b, value.challenge, value.epoch, false), resume: () => {} };
    gate.bind("a", a); gate.bind("b", b);
    let writes = 0;
    await expect(gate.run("a", async () => writes++)).rejects.toMatchObject({ code: "browser-dirty" });
    expect(writes).toBe(0); expect(gate.epoch).toBe(0);
  });
  it("drains actual admitted storage work and rejects late writes after mutation", async () => {
    const gate = createBrowserCoordinator({ challengeMs: 100 });
    const a = { send: (value: { challenge: string; epoch: number }) => gate.answer("a", a, value.challenge, value.epoch, true), resume: () => {} };
    gate.bind("a", a);
    let finish!: () => void;
    const work = gate.provider("a", 0, () => new Promise<void>(resolve => { finish = resolve; }));
    await Promise.resolve();
    let wrote = false;
    let finishEdit!: () => void, entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const edit = gate.run("a", async () => { wrote = true; entered(); await new Promise<void>(resolve => { finishEdit = resolve; }); }, true);
    expect(wrote).toBe(false); finish(); await work; await started;
    await expect(gate.provider("a", 0, async () => {})).rejects.toMatchObject({ code: "authoring-busy" });
    finishEdit(); await edit;
    await expect(gate.provider("a", 0, async () => {})).rejects.toMatchObject({ code: "stale-browser" });
    // Knowing the new epoch alone never re-authorizes a stale client's state.
    await expect(gate.provider("a", 1, async () => {})).rejects.toMatchObject({ code: "stale-browser" });
    gate.disconnect("a", a);
    expect(() => gate.bind("a", a, 0)).toThrow("Reconnect cannot authorize");
  });
  it("fails closed for a wrong peer, stale challenge, unresponsive client and joining tab", async () => {
    const gate = createBrowserCoordinator({ challengeMs: 10 });
    const a = { send: (value: { challenge: string; epoch: number }) => {
      gate.answer("a", {}, value.challenge, value.epoch, true);
      gate.answer("a", a, "old", value.epoch, true);
      expect(() => gate.bind("joining", a)).toThrow();
    }, resume: () => {} };
    gate.bind("a", a);
    await expect(gate.run("a", async () => {})).rejects.toMatchObject({ code: "browser-dirty" });
  });
  it("disconnect aborts a pending challenge but does not shorten committed work", async () => {
    const gate = createBrowserCoordinator({ challengeMs: 100 });
    const a = { send: () => gate.disconnect("a", a), resume: () => {} };
    gate.bind("a", a);
    await expect(gate.run("a", async () => { throw new Error("should not run"); })).rejects.toMatchObject({ code: "browser-dirty" });
    const b = { send: (value: { challenge: string; epoch: number }) => gate.answer("b", b, value.challenge, value.epoch, true), resume: () => {} };
    gate.bind("b", b);
    let finish!: () => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const edit = gate.run("b", () => new Promise<void>(resolve => { finish = resolve; entered(); }), true);
    await started; gate.disconnect("b", b);
    await expect(gate.provider("b", 0, async () => {})).rejects.toMatchObject({ code: "authoring-busy" });
    finish(); await edit;
  });
  it("shutdown cancels challenges before drain, preserving actual in-flight work", async () => {
    const gate = createBrowserCoordinator();
    const a = { send: () => {}, resume: () => {} }; gate.bind("a", a);
    const edit = gate.run("a", async () => {}); await Promise.resolve();
    gate.close(); await expect(edit).rejects.toMatchObject({ code: "browser-dirty" });
    await expect(gate.provider("a", 0, async () => {})).rejects.toMatchObject({ code: "authoring-busy" });
    await gate.drain();
  });
});
