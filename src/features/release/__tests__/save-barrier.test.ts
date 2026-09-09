import { describe, expect, it } from "vitest";
import { createWorkspaceSaveRegistry } from "../../../app/workspace-sessions";

describe("release save barrier", () => {
  it("does not change the authored generation when an unchanged editor is mounted or flushed", async () => {
    const registry = createWorkspaceSaveRegistry(); const before = registry.generation;
    const session = registry.register({ feature: "Composer", providerId: "db" }, { flush: async () => {} });
    expect(registry.generation).toBe(before); await registry.flush(); session.detach(); expect(registry.generation).toBe(before);
  });
  it("serializes concurrent barriers and drains same-session edits accepted during save after unmount", async () => {
    const registry = createWorkspaceSaveRegistry(); let finish!: () => void, writes = 0, concurrent = 0, maximum = 0;
    const session = registry.register({ feature: "Content", providerId: "db" }, { flush: async () => { concurrent++; maximum = Math.max(maximum, concurrent); writes++; if (writes === 1) await new Promise<void>((resolve) => { finish = resolve; }); concurrent--; } });
    session.changed(); expect(registry.hasPending).toBe(true);
    const a = registry.flush(), b = registry.flush(); session.changed(); session.detach(); finish();
    expect(await a).toMatchObject({ status: "ready" }); expect(await b).toMatchObject({ status: "ready" }); expect(writes).toBe(2); expect(maximum).toBe(1); expect(registry.hasPending).toBe(false);
  });
  it("keeps failed detached writes pending until explicit successful retry", async () => {
    const registry = createWorkspaceSaveRegistry(); let fail = true;
    const session = registry.register({ feature: "Asset", providerId: "files" }, { flush: async () => { if (fail) throw new Error("failed bytes"); }, retry: () => { fail = false; } });
    session.changed(); session.detach(); expect((await registry.flush()).status).toBe("failed"); expect(registry.hasPending).toBe(true);
    session.retry(); expect((await registry.flush()).status).toBe("ready"); expect(registry.hasPending).toBe(false);
  });
});
