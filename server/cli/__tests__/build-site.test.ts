import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { APP_ROOT } from "../../../plugins/roots.mjs";
import { SITE_HEADERS, SITE_MANIFEST, createSiteManifest, siteHeaders } from "../../site-build.mjs";
import { runSiteBuild } from "../../site-build/run.mjs";

const run = promisify(execFile);
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function artifact() {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), "build-site-cli-")));
  directories.push(cwd);
  const host = join(cwd, "host with spaces");
  const directory = join(host, "dist-site");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "index.html"), "<!doctype html><title>Existing static artifact</title>");
  await writeFile(join(directory, SITE_HEADERS), siteHeaders([]));
  const manifest = await createSiteManifest({ directory, projectId: "artifact-proof", sourceRevision: "a".repeat(40), projectSourceRevision: "b".repeat(64), routes: ["/", "/manifest-only-route"] });
  await writeFile(join(directory, SITE_MANIFEST), JSON.stringify(manifest));
  // Inspection must not evaluate config or compile the project again.
  await writeFile(join(host, "zudo-composer.config.ts"), 'throw new Error("Inspection loaded host config");');
  await writeFile(join(host, "site-project.json"), "invalid project source");
  return { cwd, host, directory, manifest };
}

function cli(cwd: string, ...args: string[]) {
  return run(process.execPath, [join(APP_ROOT, "bin/zudo-composer.mjs"), "build-site", ...args], { cwd, timeout: 20_000, encoding: "utf8" });
}

describe("build-site artifact commands", () => {
  it("prints only the verified manifest routes from an external cwd and defaults to the current host", async () => {
    const { cwd, host, manifest } = await artifact();
    const explicit = await cli(cwd, "--root", relative(cwd, host), "--print-routes");
    expect(explicit.stdout).toBe(`${JSON.stringify(manifest.routes)}\n`);
    expect(explicit.stderr).toBe("");
    const current = await cli(host, "--print-routes");
    expect(current.stdout).toBe(explicit.stdout);
    expect(current.stderr).toBe("");
  });

  it("verifies a caller-relative artifact without a host project and can print its routes", async () => {
    const { cwd, directory, manifest } = await artifact();
    const verified = await cli(cwd, "--verify", relative(cwd, directory));
    expect(verified.stdout).toBe(`Static site verified: artifact-proof, 2 files, 2 routes, source ${"a".repeat(40)}.\n`);
    expect(verified.stderr).toBe("");
    const routes = await cli(cwd, "--verify", directory, "--print-routes");
    expect(JSON.parse(routes.stdout)).toEqual(manifest.routes);
    expect(routes.stderr).toBe("");
  });

  it("exits unsuccessfully without printing routes for a damaged or missing artifact", async () => {
    const { cwd, directory } = await artifact();
    await writeFile(join(directory, "index.html"), "tampered");
    await expect(cli(cwd, "--verify", directory, "--print-routes")).rejects.toMatchObject({
      code: 1, stdout: "", stderr: expect.stringContaining("Site artifact checksum: index.html"),
    });
    await expect(cli(cwd, "--print-routes")).rejects.toMatchObject({
      code: 1, stdout: "", stderr: expect.stringContaining(join(cwd, "dist-site")),
    });
  });

  it("keeps the demo wrapper on the same installed command with a caller-relative host", async () => {
    const { cwd, host, manifest } = await artifact();
    const result = await run(process.execPath, [join(APP_ROOT, "scripts/build-site-static.mjs"), "--", relative(cwd, host), "--print-routes"], { cwd, timeout: 20_000, encoding: "utf8" });
    expect(result.stdout).toBe(`${JSON.stringify(manifest.routes)}\n`);
    expect(result.stderr).toBe("");
  });

  it("rejects unresolved direct API paths before inspecting files", async () => {
    await expect(runSiteBuild({ workspaceRoot: "host", printRoutes: true })).rejects.toThrow(/Workspace root must be an absolute resolved path/);
    await expect(runSiteBuild({ verifyDirectory: "dist-site" })).rejects.toThrow(/Verification directory must be an absolute resolved path/);
  });
});
