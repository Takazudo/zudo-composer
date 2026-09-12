// @ts-check
// Shared by the installed Node proof and the browser smoke. Both runtimes use
// one isolated host so the pack bytes/spec stay fixed while the tool and its
// contract cross from workspace sources to tarballs and back.
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { createRequire } from "node:module";
import { realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

/** @typedef {import('../src/site-project/api/types').SiteProjectActiveSelection} ActiveSelection */
/** @typedef {import('../src/site-project/api/types').ReleaseToolchain} ReleaseToolchain */

/**
 * Run actual release commands, then validate each activated artifact through
 * the opposite runtime's production delivery reader, with no toolchain override.
 * The caller owns and cleans up this disposable host.
 * @param {{checkoutRoot: string, hostRoot: string}} options
 */
export async function verifyReleasePortability({ checkoutRoot, hostRoot }) {
  checkoutRoot = await realpath(checkoutRoot);
  hostRoot = await realpath(hostRoot);
  const require = createRequire(join(hostRoot, "package.json"));
  const installedRoot = await realpath(dirname(require.resolve("zudo-composer/package.json")));
  assert.notEqual(installedRoot, checkoutRoot, "Release proof must use distinct checkout and packed runtimes");
  const contract = "node_modules/@zudo-composer/component-contract";
  assert.notEqual(await realpath(join(checkoutRoot, contract)), await realpath(join(hostRoot, contract)), "Release proof must cross the contract workspace/install boundary");

  // Ambient developer/test overrides must not redirect this proof's writes.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("ZUDO_")));
  const processOptions = { cwd: hostRoot, env, encoding: /** @type {const} */ ("utf8"), timeout: 60_000, maxBuffer: 8 * 1024 * 1024 };

  /** @param {string} toolRoot @param {Record<string, unknown>} request */
  async function release(toolRoot, request) {
    const pending = execFile(process.execPath, [join(toolRoot, "bin/zudo-composer.mjs"), "release"], processOptions);
    pending.child.stdin?.end(JSON.stringify({ protocolVersion: 2, ...request }));
    const { stdout } = await pending;
    const response = JSON.parse(stdout);
    assert.equal(response.ok, true, `Release ${String(request.operation)} failed: ${stdout}`);
    return response.result;
  }

  /** @param {string} toolRoot @param {'project' | 'read'} operation */
  async function evaluate(toolRoot, operation) {
    const { stdout } = await execFile(process.execPath, ["--input-type=module", "-e", `
      import assert from "node:assert/strict";
      import { join } from "node:path";
      import { pathToFileURL } from "node:url";
      const [toolRoot, operation] = process.argv.slice(1);
      const { loadHostContext } = await import(pathToFileURL(join(toolRoot, "server/host-context.mjs")));
      const { createModuleEvaluator } = await import(pathToFileURL(join(toolRoot, "server/module-evaluator.mjs")));
      const { pack, packIdentity, workspaceRoot } = await loadHostContext();
      if (operation === "read") {
        const { readActivatedSiteRelease } = await createModuleEvaluator(toolRoot)(join(toolRoot, "server/site-project-local/dev-reader.ts"));
        const active = await readActivatedSiteRelease({ pack, packIdentity, workspaceRoot });
        assert.ok(active, "The release proof must validate an activated release");
        console.log(JSON.stringify({ identity: active.release.identity, toolchain: active.release.stage.toolchain, projectId: active.project.id }));
      } else {
        const component = pack.manifest.components[0];
        assert.ok(component, "The release fixture requires a component");
        const timestamp = "2026-09-13T00:00:00.000Z";
        const record = (id, document) => ({ id, createdAt: timestamp, updatedAt: timestamp, document });
        console.log(JSON.stringify({
          schemaVersion: 2, id: "release-proof", name: "Release portability proof",
          componentPack: { contractVersion: pack.manifest.contractVersion, packId: pack.manifest.packId, packVersion: pack.manifest.packVersion },
          providers: {
            compositions: [{ id: "files", records: [record("home", {
              schemaVersion: 2, id: "home", name: "Home",
              root: [{ id: "component", componentId: component.id, componentVersion: component.schemaVersion, props: component.defaults, slots: {} }],
            })] }],
            content: [{ id: "content-filesystem", models: [], entries: [] }],
            mappings: [{ id: "mapping-filesystem", records: [] }],
            sitemaps: [{ id: "sitemap-filesystem", records: [record("main", {
              schemaVersion: 3, id: "main", name: "Main", navigation: { primary: [], footer: [] },
              root: [{ id: "home", title: "Home", source: { kind: "composition", ref: { providerId: "files", recordId: "home" } }, children: [] }],
            })] }],
          },
          activeSitemap: { providerId: "sitemap-filesystem", recordId: "main" }, collectionAttachments: [],
        }));
      }
    `, toolRoot, operation], processOptions);
    return JSON.parse(stdout.trim().split("\n").at(-1) ?? "");
  }

  const project = await evaluate(installedRoot, "project");
  /** @type {ActiveSelection | null} */
  let expectedActive = (await release(installedRoot, { operation: "active" })).active;
  /** @type {ReleaseToolchain | undefined} */
  let firstToolchain;
  for (const [producer, consumer, label, projectId] of [
    [checkoutRoot, installedRoot, "checkout -> packed", "checkout-release-proof"],
    [installedRoot, checkoutRoot, "packed -> checkout", "packed-release-proof"],
  ]) {
    const plan = await release(producer, { operation: "plan", project: { ...project, id: projectId }, workingPrecondition: null, selection: [], expectedRevision: null, expectedActive });
    await release(producer, { operation: "apply", plan });
    const completed = await release(producer, { operation: "build", projectId, buildId: plan.buildId });
    assert.deepEqual(completed.build.routes.map(/** @param {{pathname: string}} route */ (route) => route.pathname), ["/"]);
    await release(producer, { operation: "activate", ...completed.identity, expectedActive });
    assert.deepEqual((await release(consumer, { operation: "describe" })).toolchain, plan.toolchain, `${label}: current and activated toolchains differ`);
    const active = await evaluate(consumer, "read");
    assert.equal(active.projectId, projectId);
    assert.deepEqual(active.identity, completed.identity);
    assert.deepEqual(active.toolchain, plan.toolchain);
    if (firstToolchain) assert.deepEqual(active.toolchain, firstToolchain, "Both producers must derive the same installed release toolchain");
    firstToolchain = active.toolchain;
    expectedActive = completed.identity;
    console.log(`Activated release portability passed: ${label} (real CLI plan/apply/build/activate and production reader).`);
  }
}
