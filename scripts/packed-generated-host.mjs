// @ts-check
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assertExternalWorkspace, assertInstalledHost, configurePackedHost, pnpm, run, tree } from "./packed-host-helpers.mjs";
import { checkNoDeploy } from "./check-no-deploy.mjs";

/** @param {string} directory */
export async function snapshotPackedFiles(directory) {
  /** @type {Record<string, string>} */
  const snapshot = {};
  for (const path of await tree(directory)) {
    const stat = await lstat(join(directory, path));
    assert.ok(!stat.isSymbolicLink(), `Creator output retained a filesystem link: ${path}`);
    if (stat.isFile()) snapshot[path] = createHash("sha256").update(await readFile(join(directory, path))).digest("hex");
  }
  return snapshot;
}

/** A byte snapshot also rejects links and retained dependencies/activation.
 * Run against the pristine creator result, never the disposable packed copy.
 * @param {string} hostRoot */
export async function snapshotGeneratedHost(hostRoot) {
  for (const path of ["node_modules", ".zudo-site-project", "pnpm-lock.yaml"]) {
    await assert.rejects(lstat(join(hostRoot, path)), { code: "ENOENT" }, `Preview creator output retained ${path}`);
  }
  const snapshot = await snapshotPackedFiles(hostRoot);
  for (const path of Object.keys(snapshot)) assert.ok(!path.endsWith(".tgz"), `Creator output retained a tarball: ${path}`);
  assert.ok(snapshot["site-project.json"] && snapshot["cms/workspaces/current.json"], "Creator output must include real canonical ready state");
  return snapshot;
}

/** Bootstrap with a real installed launcher; the result stays untouched while
 * the common packed runner installs and exercises a separate copy.
 * @param {{root: string, workspace: string, roots: string[], tarballs: import('./packed-host-helpers.mjs').Tarballs, env: NodeJS.ProcessEnv}} options */
export async function createPackedGeneratedHost({ root, workspace, roots, tarballs, env }) {
  const tool = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const contract = JSON.parse(await readFile(join(root, "packages/component-contract/package.json"), "utf8"));
  const launcher = join(workspace, "creator-launcher");
  const source = join(workspace, "generated");
  await mkdir(launcher);
  await assertExternalWorkspace(roots, launcher);
  await writeFile(join(launcher, "package.json"), `${JSON.stringify({
    name: "packed-creator-launcher", private: true, type: "module",
    dependencies: { "zudo-composer": tool.version, "@zudo-composer/component-contract": contract.version, preact: tool.peerDependencies.preact },
  }, null, 2)}\n`);
  await configurePackedHost(launcher, tarballs, tool.packageManager);
  await run(pnpm, ["install", "--no-frozen-lockfile"], launcher, { env });
  await run(pnpm, ["install", "--frozen-lockfile"], launcher, { env });
  await assertInstalledHost(launcher, env, roots);
  await run(process.execPath, [join(launcher, "node_modules/zudo-composer/bin/zudo-composer.mjs"), "init", source,
    "--name", "packed-generated-host", "--tool-tarball", tarballs["zudo-composer"].slice(5),
    "--contract-tarball", tarballs["@zudo-composer/component-contract"].slice(5)], launcher, { env });
  await assertExternalWorkspace(roots, source);
  // Version refs, no overrides and the strict source boundary must pass BEFORE
  // configurePackedHost introduces temporary file: dependencies in a copy.
  await run(process.execPath, [join(root, "scripts/check-creator.mjs"), "--host", source], root, { env });
  checkNoDeploy({ root, hostRoots: [source] });
  const snapshot = await snapshotGeneratedHost(source);
  return { source, async assertPristine() {
    assert.deepEqual(await snapshotGeneratedHost(source), snapshot, "Packed proof changed retained creator output");
    await run(process.execPath, [join(root, "scripts/check-creator.mjs"), "--host", source], root, { env });
  } };
}
