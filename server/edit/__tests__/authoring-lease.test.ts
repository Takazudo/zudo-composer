import { mkdtemp, lstat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { acquireAuthoringLease } from "../authoring-lease.mjs";
it("excludes another process owner and joins concurrent shutdown before unlocking", async () => {
  const root = await mkdtemp(join(tmpdir(), "authoring-lease-"));
  try {
    const lease = await acquireAuthoringLease(root, "server");
    await expect(acquireAuthoringLease(root, "cli")).rejects.toMatchObject({ code: "authoring-busy" });
    const first = lease.release(), second = lease.release();
    expect(first).toBe(second);
    await second;
    await expect(lstat(join(root, ".zudo-authoring.lock"))).rejects.toMatchObject({ code: "ENOENT" });
    const reopened = await acquireAuthoringLease(root, "cli");
    await reopened.release();
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("executes service work only inside the live owner's scope and drains it before release", async () => {
  const { executeAuthoringOperation } = await import("../authoring-lease.mjs");
  const root = await mkdtemp(join(tmpdir(), "authoring-owned-operation-"));
  try {
    const lease = await acquireAuthoringLease(root, "dev-server");
    await expect(executeAuthoringOperation(root, async () => "external")).rejects.toMatchObject({ code: "authoring-busy" });
    let finish!: () => void, entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const work = lease.execute(() => executeAuthoringOperation(root, async () => { entered(); await new Promise<void>(resolve => { finish = resolve; }); return "owned"; }));
    await started;
    const release = lease.release();
    await expect(lstat(join(root, ".zudo-authoring.lock"))).resolves.toBeDefined();
    finish(); expect(await work).toBe("owned"); await release;
    await expect(lease.execute(async () => "closed")).rejects.toThrow("closing");
    const next = await acquireAuthoringLease(root, "cli"); await next.release();
  } finally { await rm(root, { recursive: true, force: true }); }
});
