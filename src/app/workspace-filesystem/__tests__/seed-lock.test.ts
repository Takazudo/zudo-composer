// Once-only seeding, without Web Locks.
//
// The browser serializes seeding across tabs; two dev servers are two
// processes, so the guarantee has to hold against a lock file held by a
// different process. One test therefore holds `.mutation.lock` from a real
// child process rather than simulating the contention in-process.

import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MUTATION_LOCK_FILENAME } from "../../../shared/node-fs";
import { WORKSPACE_SEED_LOCK_DIRECTORY, withWorkspaceSeedLock } from "../seed-lock";
import { workspaceDirectoryName } from "../scope";
import { WorkspaceRegistryError } from "../types";

const roots: string[] = [];
const children: ChildProcess[] = [];

async function registryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "zudo-workspace-seed-lock-"));
  roots.push(root);
  return root;
}

function lockPath(registryRoot: string, id: string): string {
  return join(registryRoot, WORKSPACE_SEED_LOCK_DIRECTORY, workspaceDirectoryName(id), MUTATION_LOCK_FILENAME);
}

/**
 * A second process holding the exact lock file, released when its stdin
 * closes. It creates the directory itself, so nothing in this process has
 * touched the lock before the contention starts.
 */
async function holdLockInAnotherProcess(path: string): Promise<ChildProcess> {
  const script = `
    const fs = require("node:fs");
    fs.mkdirSync(require("node:path").dirname(process.argv[1]), { recursive: true });
    const handle = fs.openSync(process.argv[1], "wx");
    fs.writeSync(handle, JSON.stringify({ pid: process.pid }));
    process.stdout.write("held\\n");
    process.stdin.resume();
    process.stdin.on("end", () => { fs.closeSync(handle); fs.unlinkSync(process.argv[1]); process.exit(0); });
  `;
  const child = spawn(process.execPath, ["-e", script, path], { stdio: ["pipe", "pipe", "inherit"] });
  children.push(child);
  await new Promise<void>((resolve, reject) => {
    child.stdout!.once("data", () => resolve());
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`Lock holder exited early with ${code}.`)));
  });
  return child;
}

afterEach(async () => {
  for (const child of children.splice(0)) child.kill("SIGKILL");
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("workspace seed lock", () => {
  it("does not double-seed when two callers race the same workspace", async () => {
    const registryRootPath = await registryRoot();
    let seeded = 0;
    let concurrent = 0;
    let peak = 0;
    const seed = () => withWorkspaceSeedLock("alpha", { registryRoot: registryRootPath }, async () => {
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      await new Promise<void>((resolve) => { setTimeout(resolve, 10); });
      if (seeded === 0) seeded += 1;
      concurrent -= 1;
      return seeded;
    });
    expect(await Promise.all([seed(), seed(), seed()])).toEqual([1, 1, 1]);
    expect(peak).toBe(1);
    await expect(stat(lockPath(registryRootPath, "alpha"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses to seed while another process holds the lock, and never runs the action", async () => {
    const registryRootPath = await registryRoot();
    const held = await holdLockInAnotherProcess(lockPath(registryRootPath, "alpha"));
    let ran = false;
    const attempt = withWorkspaceSeedLock("alpha", { registryRoot: registryRootPath, waitMs: 0 }, async () => { ran = true; });
    await expect(attempt).rejects.toMatchObject({ code: "conflict" });
    expect(ran).toBe(false);
    held.stdin!.end();
  });

  it("acquires the lock once the other process releases it", async () => {
    const registryRootPath = await registryRoot();
    const held = await holdLockInAnotherProcess(lockPath(registryRootPath, "alpha"));
    const waiting = withWorkspaceSeedLock("alpha", { registryRoot: registryRootPath, waitMs: 10_000, retryDelayMs: 10 }, async () => "seeded");
    held.stdin!.end();
    expect(await waiting).toBe("seeded");
  });

  it("does not retry a conflict raised by the seeding action itself", async () => {
    const registryRootPath = await registryRoot();
    let attempts = 0;
    const failing = withWorkspaceSeedLock("alpha", { registryRoot: registryRootPath, waitMs: 10_000, retryDelayMs: 1 }, async () => {
      attempts += 1;
      throw new WorkspaceRegistryError("create", "conflict", "Workspace attempt alpha already exists.", true);
    });
    await expect(failing).rejects.toThrow(/already exists/);
    expect(attempts).toBe(1);
  });

  it("scopes the lock per workspace", async () => {
    const registryRootPath = await registryRoot();
    const held = await holdLockInAnotherProcess(lockPath(registryRootPath, "alpha"));
    expect(await withWorkspaceSeedLock("beta", { registryRoot: registryRootPath, waitMs: 0 }, async () => "seeded")).toBe("seeded");
    held.stdin!.end();
  });
});
