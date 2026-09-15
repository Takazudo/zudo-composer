import { execFile } from "node:child_process";
import { cp, mkdtemp, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { installedPackageDigest } from "../installed-identity";

const run = promisify(execFile);
const UI_PACKAGE = fileURLToPath(new URL("../../../packages/ui", import.meta.url));
let parent: string;
let packed: string;

async function modes(root: string): Promise<Map<string, number>> {
  const found = new Map<string, number>();
  const visit = async (path: string): Promise<void> => {
    found.set(relative(root, path) || ".", (await stat(path)).mode & 0o777);
    for (const entry of await readdir(path, { withFileTypes: true })) if (entry.isDirectory()) await visit(join(path, entry.name)); else found.set(relative(root, join(path, entry.name)), (await stat(join(path, entry.name))).mode & 0o777);
  };
  await visit(root);
  return found;
}

beforeAll(async () => {
  parent = await realpath(await mkdtemp(join(tmpdir(), "ui-pack-parity-")));
  const { stdout } = await run("pnpm", ["pack", "--json", "--pack-destination", parent], { cwd: UI_PACKAGE });
  const { filename } = JSON.parse(stdout) as { filename: string };
  await run("tar", ["-xzf", filename, "-C", parent]);
  packed = join(parent, "package");
}, 120_000);

afterAll(async () => { if (parent) await rm(parent, { recursive: true, force: true }); });

describe("@zudo-composer/ui digest parity", () => {
  it("extracts with the 0644/0755 modes pnpm's store writes", async () => {
    for (const [path, mode] of await modes(packed)) expect([0o644, 0o755], path).toContain(mode);
  });

  it("attests the workspace-linked package and its packed tarball identically", async () => {
    expect(await installedPackageDigest(UI_PACKAGE)).toBe(await installedPackageDigest(packed));
  });

  it("breaks parity when the package directory holds a path outside the published set", async () => {
    const copy = join(parent, "copy");
    await cp(UI_PACKAGE, copy, { recursive: true, filter: (source) => !relative(UI_PACKAGE, source).split("/").includes("node_modules") });
    expect(await installedPackageDigest(copy)).toBe(await installedPackageDigest(packed));
    await writeFile(join(copy, "tsconfig.tsbuildinfo"), "{}\n");
    expect(await installedPackageDigest(copy)).not.toBe(await installedPackageDigest(packed));
  });
});
