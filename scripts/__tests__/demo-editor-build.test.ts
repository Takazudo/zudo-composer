// @vitest-environment node
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEMO_EDITOR_HOSTS, resolveDemoEditorHost } from "../demo-editor-hosts.mjs";
import { buildDemoEditors } from "../build-demo-editors.mjs";
import { discoverPackedHosts } from "../packed-host-helpers.mjs";

const root = resolve(import.meta.dirname, "../..");
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});
async function temporary() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "demo-editor-build-")));
  directories.push(directory);
  return directory;
}

describe("demo editor host selection", () => {
  it("maps shop explicitly to the webshop and covers each discovered repository host", () => {
    expect(resolveDemoEditorHost("shop")).toBe(join(root, "packages/demo-webshop"));
    expect(Object.keys(DEMO_EDITOR_HOSTS).map((name) => resolveDemoEditorHost(name)).sort()).toEqual(discoverPackedHosts(root));
    expect(() => resolveDemoEditorHost("absent-demo")).toThrow("No site-project.json");
    expect(() => resolveDemoEditorHost("")).toThrow("Usage:");
    expect(() => resolveDemoEditorHost("--help")).toThrow("Usage:");
  });

  it("accepts caller-relative and absolute directories and canonicalizes symlinks", async () => {
    const directory = await temporary();
    const host = join(directory, "custom host");
    await mkdir(host);
    await writeFile(join(host, "site-project.json"), "{}");
    await symlink(host, join(directory, "linked-host"), "dir");
    expect(resolveDemoEditorHost("custom host", { cwd: directory })).toBe(host);
    expect(resolveDemoEditorHost(host, { cwd: "/" })).toBe(host);
    expect(resolveDemoEditorHost("linked-host", { cwd: directory })).toBe(host);
    // Name mapping belongs to the repo, independent of a caller's cwd.
    expect(resolveDemoEditorHost("sample", { cwd: directory })).toBe(join(root, "packages/demo-sample"));
  });

  it("discovers future hosts, awaits each build, and stops after a failed host", async () => {
    const directory = await temporary();
    for (const name of ["future-host", "demo-one"]) {
      const host = join(directory, "packages", name);
      await mkdir(host, { recursive: true });
      await writeFile(join(host, "zudo-composer.config.mjs"), "export default {};");
    }
    let active = 0;
    let peak = 0;
    const built: string[] = [];
    await buildDemoEditors(directory, async (host) => {
      peak = Math.max(peak, ++active);
      await new Promise((done) => setTimeout(done, 1));
      built.push(host);
      active--;
    });
    expect(peak).toBe(1);
    expect(built).toEqual(discoverPackedHosts(directory));
    const failed: string[] = [];
    await expect(buildDemoEditors(directory, async (host) => {
      failed.push(host);
      throw new Error("Invalid host project");
    })).rejects.toThrow("Invalid host project");
    expect(failed).toEqual([built[0]]);
  });
});
