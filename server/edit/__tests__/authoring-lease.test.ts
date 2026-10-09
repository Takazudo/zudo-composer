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
