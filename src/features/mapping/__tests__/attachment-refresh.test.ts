import { describe, expect, it } from "vitest";
import type { MappingAttachmentCallbacks, MappingAttachmentSnapshot } from "../attachments";
import { RESOLVED_ENTRIES, harness, mappingRecord } from "./harness";

// #994: attachment refreshes coalesce per invalidation generation, a persisted
// change during a pass requires fresh work, and a superseded pass never
// publishes or lets a deep-linked editor open early.

type Gate = { release(snapshot: MappingAttachmentSnapshot): void; fail(reason: Error): void; started: Promise<void> };
function snapshot(name: string): MappingAttachmentSnapshot { return { targets: [], attachments: [], ...{ marker: name } } as MappingAttachmentSnapshot; }
function marker(value: MappingAttachmentSnapshot | null | undefined) { return (value as { marker?: string } | null | undefined)?.marker; }

function gatedCallbacks() {
  const gates: Gate[] = [];
  const callbacks: MappingAttachmentCallbacks = {
    list: () => new Promise<MappingAttachmentSnapshot>((resolve, reject) => { let started!: () => void; const gate: Gate = { release: resolve, fail: reject, started: new Promise<void>((done) => { started = done; }) }; gates.push(gate); started(); }),
    async attach() {}, async detach() {},
    async preview() { throw new Error("unused"); },
    async assertMappingDeletable() {},
    async withMappingMutation(_mapping, action) { return action(); },
  };
  return { callbacks, gates };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Mapping attachment refresh coalescing (#994)", () => {
  it("shares one pass between concurrent refreshes of the same generation", async () => {
    const { callbacks, gates } = gatedCallbacks();
    const h = harness([mappingRecord()], RESOLVED_ENTRIES, { attachments: callbacks });
    const first = h.controller.refreshAttachments(), second = h.controller.refreshAttachments();
    expect(first).toBe(second);
    await tick();
    expect(gates).toHaveLength(1);
    gates[0]!.release(snapshot("a"));
    await first;
    expect(marker(h.controller.state.attachments.snapshot)).toBe("a");
  });

  it("queues one trailing pass for a persisted change mid-pass and never publishes the superseded pass", async () => {
    const { callbacks, gates } = gatedCallbacks();
    const h = harness([mappingRecord()], RESOLVED_ENTRIES, { attachments: callbacks });
    const published: (string | undefined)[] = [];
    h.controller.subscribe((state) => { if (state.attachments.phase === "ready") published.push(marker(state.attachments.snapshot)); });
    const stale = h.controller.refreshAttachments();
    await tick();
    const fresh = h.controller.attachmentsChanged();
    // Further hints and joins during the stale pass share the single trailing pass.
    expect(h.controller.attachmentsChanged()).toBe(fresh);
    expect(h.controller.refreshAttachments()).toBe(fresh);
    await tick();
    expect(gates).toHaveLength(1);
    gates[0]!.release(snapshot("stale"));
    await stale;
    await expect.poll(() => gates.length).toBe(2);
    gates[1]!.release(snapshot("fresh"));
    await fresh;
    expect(gates).toHaveLength(2);
    expect(published).toEqual(["fresh"]);
    expect(marker(h.controller.state.attachments.snapshot)).toBe("fresh");
  });

  it("ignores a stale failure and publishes the trailing pass", async () => {
    const { callbacks, gates } = gatedCallbacks();
    const h = harness([mappingRecord()], RESOLVED_ENTRIES, { attachments: callbacks });
    const stale = h.controller.refreshAttachments(); await tick();
    const fresh = h.controller.attachmentsChanged();
    gates[0]!.fail(new Error("stale capture failed")); await stale;
    await expect.poll(() => gates.length).toBe(2);
    expect(h.controller.state.attachments.phase).not.toBe("error");
    gates[1]!.release(snapshot("fresh")); await fresh;
    expect(h.controller.state.attachments).toMatchObject({ phase: "ready", message: null });
    expect(marker(h.controller.state.attachments.snapshot)).toBe("fresh");
  });

  it("keeps a deep-linked editor closed until no pass can still flush its draft", async () => {
    const source = mappingRecord();
    const { callbacks, gates } = gatedCallbacks();
    const h = harness([source], RESOLVED_ENTRIES, { attachments: callbacks });
    const opening = h.controller.initialize({ providerId: "mapping-filesystem", mappingId: source.id });
    await expect.poll(() => gates.length).toBe(1);
    const fresh = h.controller.attachmentsChanged();
    await tick();
    gates[0]!.release(snapshot("stale"));
    await expect.poll(() => gates.length).toBe(2);
    expect(h.controller.state.mapping).toBeNull();
    expect(h.controller.state.deepLink?.status).toBe("loading");
    gates[1]!.release(snapshot("fresh"));
    await fresh; await opening;
    expect(h.controller.state.deepLink?.status).toBe("ready");
    expect(h.controller.state.mapping?.id).toBe(source.id);
    expect(marker(h.controller.state.attachments.snapshot)).toBe("fresh");
  });

  it("keeps library rows usable while the attachment pass is pending", async () => {
    const source = mappingRecord();
    const { callbacks, gates } = gatedCallbacks();
    const h = harness([source], RESOLVED_ENTRIES, { attachments: callbacks });
    const loading = h.controller.initialize();
    await expect.poll(() => h.controller.state.message).toBe("Mapping library ready.");
    expect(h.controller.state.mappings.map(({ id }) => id)).toEqual([source.id]);
    expect(h.controller.state.attachments.phase).toBe("loading");
    gates[0]!.release(snapshot("a"));
    await loading;
  });

  it("refreshes with a pass that began after the controller's own attach write", async () => {
    const { callbacks, gates } = gatedCallbacks();
    const h = harness([mappingRecord()], RESOLVED_ENTRIES, { attachments: callbacks });
    const before = h.controller.refreshAttachments(); await tick();
    // No store notification arrives during this write, so the in-flight pass is stale.
    const attaching = h.controller.attachCollection({ composition: { providerId: "files", recordId: "c" }, target: { nodeId: "n", slotId: "s" }, mapping: { providerId: "mapping-filesystem", recordId: "mapping-1" } });
    await tick(); await tick();
    gates[0]!.release(snapshot("before-write")); await before;
    await expect.poll(() => gates.length).toBe(2);
    gates[1]!.release(snapshot("after-write")); await attaching;
    expect(marker(h.controller.state.attachments.snapshot)).toBe("after-write");
  });

  it("bounds how long a deep link waits under continuous change hints", async () => {
    const source = mappingRecord();
    const { callbacks, gates } = gatedCallbacks();
    const h = harness([source], RESOLVED_ENTRIES, { attachments: callbacks });
    const opening = h.controller.initialize({ providerId: "mapping-filesystem", mappingId: source.id });
    for (let pass = 0; pass < 10 && h.controller.state.deepLink?.status === "loading"; pass++) {
      await expect.poll(() => gates.length).toBe(pass + 1);
      void h.controller.attachmentsChanged();
      gates[pass]!.release(snapshot(`pass-${pass}`));
      await tick(); await tick();
    }
    await opening;
    expect(h.controller.state.deepLink?.status).toBe("ready");
    expect(gates.length).toBeLessThanOrEqual(5);
    for (const gate of gates) gate.release(snapshot("drain"));
  });
});
