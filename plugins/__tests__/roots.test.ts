// The two root helpers whose output other subsystems depend on by identity
// rather than by shape: the record store compares the workspace root against
// its own `realpath`, and Vite's watcher compares its ignore globs against
// paths it discovers itself.

import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveWatchIgnored, resolveWorkspaceRoot } from "../roots.mjs";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryRoot(): Promise<string> {
  // Resolved, because this file is about the difference between a path and its
  // real path, and macOS `tmpdir()` is itself a symlink (`/var` -> `/private/var`).
  const root = await realpath(await mkdtemp(join(tmpdir(), "zudo-composer-roots-")));
  roots.push(root);
  return root;
}

describe("resolveWorkspaceRoot()", () => {
  it("resolves a symlinked host root to the directory a record store will accept", async () => {
    const parent = await temporaryRoot();
    const real = join(parent, "real-host");
    const link = join(parent, "linked-host");
    await mkdir(real);
    await symlink(real, link, "dir");

    // `createRecordTransactionStore` refuses a generations directory whose
    // `realpath` differs from the path it was handed, failing the whole domain
    // closed as `blocked`. A host reached through a symlink is therefore
    // unusable unless this resolution happens here, once, for every plugin.
    expect(resolveWorkspaceRoot(link)).toBe(real);
    expect(await realpath(resolveWorkspaceRoot(link))).toBe(resolveWorkspaceRoot(link));
  });

  it("returns an already-real root unchanged", async () => {
    const root = await temporaryRoot();
    expect(resolveWorkspaceRoot(root)).toBe(root);
  });

  it("falls back to the working directory, resolved the same way", () => {
    expect(resolveWorkspaceRoot(undefined)).toBe(resolveWorkspaceRoot(resolve(process.cwd())));
  });

  it("keeps a root that does not exist yet rather than failing to resolve it", () => {
    // Absent is not hostile: the host project directory is created by whatever
    // runs next, and reporting that is its job rather than this resolver's.
    const absent = resolve(tmpdir(), "zudo-composer-roots-absent");
    expect(resolveWorkspaceRoot(absent)).toBe(absent);
  });

  it("refuses a relative or unresolved override", () => {
    expect(() => resolveWorkspaceRoot("relative/host")).toThrow(/absolute resolved path/);
    expect(() => resolveWorkspaceRoot(`${resolve(".")}${sep}..`)).toThrow(/absolute resolved path/);
  });
});

describe("resolveWatchIgnored()", () => {
  it("turns each authoring root into a subtree glob Vite's watcher can match", () => {
    expect(resolveWatchIgnored([resolve("/tmp/host/cms/content")])).toEqual(["/tmp/host/cms/content/**"]);
  });

  it("drops absent roots and repeats, so an unconfigured domain adds no pattern", () => {
    const root = resolve("/tmp/host/cms");
    expect(resolveWatchIgnored([root, undefined, "", root])).toEqual([`${root.split(sep).join("/")}/**`]);
  });
});
