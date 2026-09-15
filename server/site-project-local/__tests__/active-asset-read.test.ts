import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { project } from "../../../src/site-project/compiler/__tests__/fixtures";
import { fixture, review, call, catalog, PNG, toolchain } from "./release-fixture";
import { createSiteProjectApiService } from "../../../src/site-project/api/service";
import { createLocalSiteProjectStore } from "../store";
import { readActivatedSiteAssets } from "../dev-reader";
import type { CompletedRelease, SiteProjectActiveSelection } from "../../../src/site-project/api/types";

async function releasedAsset(bytes = PNG) {
  const context = await fixture({ assets: true });
  const asset = await context.assets!.upload({ fileName: "image.png", declaredMimeType: "image/png", bytes });
  const value = project(); value.providers.compositions[0]!.records[0]!.document.root[0]!.props.href = `/uploaded-assets/asset-${asset.id}`;
  const plan = await review(context.service, value);
  await call(context.service, "apply", { plan });
  const completed = await call<CompletedRelease>(context.service, "build", { projectId: plan.candidate.id, buildId: plan.buildId });
  await call(context.service, "activate", { ...completed.identity, expectedActive: null });
  return { ...context, value, completed, pin: completed.stage.assetLock!.pins[0]! };
}

describe("lock-free activated Assets reads", () => {
  it("serves many concurrent pinned Assets reads while another writer holds the lock, without touching it", async () => {
    const { testRoot, completed, pin } = await releasedAsset();
    const lock = join(testRoot, ".transaction-lock"), owner = JSON.stringify({ pid: process.pid, nonce: "a".repeat(24) });
    await mkdir(lock); await writeFile(join(lock, "owner.json"), owner);
    const reader = createLocalSiteProjectStore({ testRoot, lockTimeoutMs: 15 });
    const locked = vi.spyOn(reader as unknown as { lock: () => Promise<unknown> }, "lock");
    const results = await Promise.all(Array.from({ length: 24 }, () => reader.readActiveAsset(pin.url)));
    for (const result of results) expect(result).toMatchObject({ status: "ok", value: { bytes: PNG, mimeType: "image/png", identity: completed.identity } });
    await expect(Promise.all(Array.from({ length: 8 }, () => readActivatedSiteAssets(pin.url, { testRoot, lockTimeoutMs: 15, toolchain })))).resolves.toHaveLength(8);
    expect(locked).not.toHaveBeenCalled();
    expect(await reader.list()).toMatchObject({ status: "unavailable", message: expect.stringContaining("Release writer lock unavailable") });
    expect(await readFile(join(lock, "owner.json"), "utf8")).toBe(owner);
  });
  it("falls back to the locked read when the lock-free resolution keeps failing", async () => {
    const { testRoot, completed, pin } = await releasedAsset();
    const reader = createLocalSiteProjectStore({ testRoot });
    const internals = reader as unknown as { lock: () => Promise<unknown>; verifyLayout: () => Promise<void> };
    const locked = vi.spyOn(internals, "lock"), verifyLayout = internals.verifyLayout.bind(reader);
    let failures = 3; vi.spyOn(internals, "verifyLayout").mockImplementation(async () => { if (failures-- > 0) throw new Error("writer temporary state"); return verifyLayout(); });
    expect(await reader.readActiveAsset(pin.url)).toMatchObject({ status: "ok", value: { bytes: PNG, identity: completed.identity } });
    expect(locked).toHaveBeenCalledTimes(1);
    expect(await reader.readActiveAsset(`/uploaded-assets/sha256-${"f".repeat(64)}.png`)).toEqual({ status: "not-found" });
    expect(locked).toHaveBeenCalledTimes(1);
  });
  it("serves pinned Assets while an apply is paused mid-write and after it commits", async () => {
    const context = await releasedAsset();
    let release!: () => void, paused!: () => void;
    const gate = new Promise<void>((done) => { release = done; }), reached = new Promise<void>((done) => { paused = done; });
    let points = 0;
    const gated = createLocalSiteProjectStore({ testRoot: context.testRoot, componentPack: catalog.pack, async fault(point) { if (point === "after-close" && ++points === 2) { paused(); await gate; } } });
    const service = createSiteProjectApiService({ ...context.dependencies, projectStore: gated, buildStore: gated });
    const plan = await review(context.service, { ...project(), name: "Changed" }, { expectedRevision: context.completed.identity.revision, expectedActive: context.completed.identity });
    const applying = call(service, "apply", { plan });
    await reached;
    const reader = createLocalSiteProjectStore({ testRoot: context.testRoot });
    const during = await Promise.all(Array.from({ length: 12 }, () => reader.readActiveAsset(context.pin.url)));
    const settling = Array.from({ length: 12 }, () => reader.readActiveAsset(context.pin.url));
    release(); await applying;
    for (const result of [...during, ...await Promise.all(settling)]) expect(result).toMatchObject({ status: "ok", value: { bytes: PNG, identity: context.completed.identity } });
  });
  it("keeps the delivery seam's toolchain and missing-root checks", async () => {
    const { testRoot, parent, pin } = await releasedAsset();
    await expect(readActivatedSiteAssets(pin.url, { testRoot, toolchain })).resolves.toMatchObject({ bytes: PNG, mimeType: "image/png" });
    await expect(readActivatedSiteAssets(pin.url, { testRoot, toolchain: { ...toolchain, installedPackDigest: "f".repeat(64) } })).rejects.toThrow(/current installed runtime/);
    await expect(readActivatedSiteAssets(pin.url, { testRoot: join(parent, "missing"), toolchain })).resolves.toBeNull();
    await expect(readFile(join(parent, "missing"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("never returns bytes that mismatch the returned identity during concurrent activation changes", async () => {
    const first = await releasedAsset();
    const secondBytes = new Uint8Array([...PNG, 7]);
    const secondAsset = await first.assets!.upload({ fileName: "second.png", declaredMimeType: "image/png", bytes: secondBytes });
    const secondProject = structuredClone(first.value); secondProject.providers.compositions[0]!.records[0]!.document.root[0]!.props.href = `/uploaded-assets/asset-${secondAsset.id}`;
    const plan = await review(first.service, secondProject, { expectedRevision: first.completed.identity.revision, expectedActive: first.completed.identity });
    await call(first.service, "apply", { plan });
    const second = await call<CompletedRelease>(first.service, "build", { projectId: plan.candidate.id, buildId: plan.buildId });
    const secondPin = second.stage.assetLock!.pins[0]!;
    const expected = new Map([[first.completed.identity.buildId, { url: first.pin.url, bytes: PNG }], [second.identity.buildId, { url: secondPin.url, bytes: secondBytes }]]);
    let flipping = true;
    const writer = (async () => {
      let current: SiteProjectActiveSelection = first.completed.identity;
      for (let flip = 0; flip < 12; flip++) {
        const target = current.buildId === first.completed.identity.buildId ? second.identity : first.completed.identity;
        expect(await first.store.activate({ target, expectedActive: current })).toMatchObject({ status: "ok" });
        current = target;
      }
      flipping = false;
    })();
    const reader = createLocalSiteProjectStore({ testRoot: first.testRoot });
    const statuses = new Set<string>();
    const readers = Array.from({ length: 4 }, async () => {
      while (flipping) for (const url of [first.pin.url, secondPin.url]) {
        const result = await reader.readActiveAsset(url);
        statuses.add(result.status);
        expect(result.status, JSON.stringify(result)).not.toBe("unavailable");
        if (result.status === "ok") expect(expected.get(result.value.identity.buildId)).toEqual({ url, bytes: result.value.bytes });
      }
    });
    await Promise.all([writer, ...readers]);
    expect(statuses.has("ok")).toBe(true);
  });
});
