// @vitest-environment node
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEMO_EDITOR_HOSTS, resolveDemoEditorHost } from "../demo-editor-hosts.mjs";
import { buildDemoEditor } from "../build-demo-editor.mjs";
import { buildDemoEditors } from "../build-demo-editors.mjs";
import { discoverPackedHosts } from "../packed-host-helpers.mjs";

const root = resolve(import.meta.dirname, "../..");
const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
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

describe("demo editor child process environment", () => {
  it("pins NODE_ENV to production in the spawn env for every discovered host", async () => {
    const hosts = discoverPackedHosts(root);
    expect(hosts.length).toBeGreaterThan(0);
    for (const hostDir of hosts) {
      let capturedEnv: NodeJS.ProcessEnv | undefined;
      // An operator shell, or a caller that changed its own NODE_ENV, must not
      // reach the child through `...process.env`; stub rather than assign, so
      // the spec restores vitest's own NODE_ENV instead of unsetting it.
      vi.stubEnv("NODE_ENV", "development");
      await buildDemoEditor(hostDir, {
        execFile: async (_file, _args, options) => {
          capturedEnv = options.env;
          return { stdout: "", stderr: "" };
        },
        verifyDemoEditorArtifact: async () => ({
          root: hostDir,
          manifest: { schemaVersion: 1, tool: { name: "zudo-composer", version: "0.0.0" }, hostId: "fake", projectId: "fake", sourceRevision: "0".repeat(40), projectSourceRevision: "0".repeat(40), mode: "disposable-demo-editor", assets: {}, routes: [], files: {} },
          files: [],
        }),
      });
      expect(process.env.NODE_ENV).toBe("development");
      expect(capturedEnv?.NODE_ENV).toBe("production");
      expect(capturedEnv?.ZUDO_DEMO_EDITOR_HOST).toBe(hostDir);
    }
  });
});
