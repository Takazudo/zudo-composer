import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { APP_ROOT, SITE_BUILD_ENTRY } from "../../../plugins/roots.mjs";
import { SITE_MANIFEST, verifySiteStaticArtifact, type ToolIdentity } from "../../site-build.mjs";

const run = promisify(execFile);
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("installed static build identity", () => {
  it("builds from a non-Git installation with explicit, environment and absent host revisions, and never inherits the host's Git HEAD", async () => {
    const temporary = await realpath(await mkdtemp(join(tmpdir(), "site-identity-install-")));
    directories.push(temporary);
    const host = join(temporary, "host with spaces");
    const toolRoot = join(host, "node_modules/zudo-composer");
    const demo = join(APP_ROOT, "packages/demo-webshop");
    await mkdir(toolRoot, { recursive: true });
    // Copy the tool into node_modules: a symlink to the checkout would retain
    // its Git tree and could let the old APP_ROOT lookup keep passing.
    for (const name of ["package.json", "index.html", "bin", "plugins", "server", "src", "packages/image-editor"]) {
      await cp(join(APP_ROOT, name), join(toolRoot, name), {
        recursive: true,
        filter: (path) => !relative(APP_ROOT, path).split(sep).some((part) => ["node_modules", "__tests__", "type-tests"].includes(part)),
      });
    }
    // Dependency bytes are reused for this bounded unit lane. The manager's
    // packed-install gate independently verifies the real dependency closure.
    await symlink(join(APP_ROOT, "node_modules"), join(toolRoot, "node_modules"), "dir");
    for (const name of ["package.json", "zudo-composer.config.ts", "components", "styles", "site-project.json", "cms/assets"]) {
      await cp(join(demo, name), join(host, name), { recursive: true });
    }
    await mkdir(join(host, "node_modules/@zudo-composer"));
    await symlink(join(APP_ROOT, "node_modules/preact"), join(host, "node_modules/preact"), "dir");
    await symlink(join(APP_ROOT, "node_modules/@zudo-composer/component-contract"), join(host, "node_modules/@zudo-composer/component-contract"), "dir");
    // Keep real HTML/CSS compilation, config loading and manifest verification
    // behind the actual bin, with a tiny visitor in this disposable tool copy.
    await writeFile(join(toolRoot, SITE_BUILD_ENTRY), `
      import "virtual:zudo-composer-host-styles";
      import "./styles.css";
      document.getElementById("app").textContent = "Installed package visitor";
    `);
    const metadataPath = join(toolRoot, "package.json");
    const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    const tool: ToolIdentity = { name: metadata.name, version: "8.7.6-identity-proof", gitHead: "f".repeat(40) };
    await writeFile(metadataPath, JSON.stringify({ ...metadata, ...tool }));
    await expect(run("git", ["rev-parse", "HEAD"], { cwd: toolRoot })).rejects.toMatchObject({ code: 128 });

    const directory = join(host, "dist-site");
    const env = { ...process.env };
    delete env.GITHUB_SHA;
    const scenarios = [
      { args: ["--source-revision", "a".repeat(40)], env: { ...env, GITHUB_SHA: "b".repeat(40) }, revision: "a".repeat(40) },
      { args: [], env: { ...env, GITHUB_SHA: "c".repeat(40) }, revision: "c".repeat(40) },
      { args: [], env, revision: undefined },
    ];
    for (const scenario of scenarios) {
      const result = await run(process.execPath, [join(toolRoot, "bin/zudo-composer.mjs"), "build-site", "--root", relative(temporary, host), ...scenario.args], { cwd: temporary, env: scenario.env, encoding: "utf8", timeout: 25_000 });
      expect(result.stdout).toContain(`tool ${tool.name}@${tool.version}`);
      const manifest = await verifySiteStaticArtifact({ directory, expectedSourceRevision: scenario.revision });
      expect(manifest.tool).toEqual(tool);
      expect(manifest.sourceRevision).toBe(scenario.revision);
      expect(Object.hasOwn(manifest, "sourceRevision")).toBe(scenario.revision !== undefined);
      expect(manifest.projectId).toBe("demo-webshop");
      expect(manifest.routes).toHaveLength(21);
      expect(manifest.files).toHaveProperty("index.html");
    }

    await run("git", ["init", "--quiet"], { cwd: host });
    await run("git", ["-c", "user.name=Build identity test", "-c", "user.email=identity@example.test", "-c", "commit.gpgSign=false", "-c", "core.hooksPath=/dev/null", "commit", "--allow-empty", "--quiet", "-m", "Host revision must not identify the installed tool"], { cwd: host });
    const { stdout: hostHead } = await run("git", ["rev-parse", "HEAD"], { cwd: toolRoot, encoding: "utf8" });
    expect(hostHead.trim()).toMatch(/^[a-f0-9]{40}$/);
    await writeFile(metadataPath, JSON.stringify({ ...metadata, version: tool.version }));
    await run(process.execPath, [join(toolRoot, "bin/zudo-composer.mjs"), "build-site"], { cwd: host, env, encoding: "utf8", timeout: 25_000 });
    const manifest = JSON.parse(await readFile(join(directory, SITE_MANIFEST), "utf8"));
    expect(manifest.tool).toEqual({ name: tool.name, version: tool.version });
    expect(manifest).not.toHaveProperty("sourceRevision");
    await expect(verifySiteStaticArtifact({ directory, expectedSourceRevision: hostHead.trim() })).rejects.toThrow(/sourceRevision does not match/);
  });
});
