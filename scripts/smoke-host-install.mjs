// @ts-check
/* global AbortSignal */

// The install proof: a real host project, outside this repository, that
// installs the packed package and runs it.
//
// Everything else in the gate exercises zudo-composer from inside its own
// checkout, where a workspace install hoists dependencies the host root can see
// and every source file is one relative path away. This script is the only
// place that answers the question the whole conversion rests on: does a
// stranger's project, holding nothing but a tarball, boot the tool, author with
// it, keep the data across a restart, and still own that data once the tool is
// removed again?
//
// The synthesized fixture retains six claims, each failing loudly:
//   1. install   — the packed tarball resolves and installs from a bare host
//   2. boot      — `zudo-composer dev` serves every documented route with NO
//                  prerequisite sample activation
//   3. author    — a record created in the browser lands as JSON on the HOST's
//                  disk, under the host's own configured directories
//   4. restart   — a restarted server and a FRESH browser context still see it,
//                  which is what proves nothing hid in browser storage
//   5. release   — activated releases validate across checkout/packed runtimes
//                  in both directions, through the actual release CLI/reader
//   6. discard   — removing the tool leaves the CMS data behind, readable
//
// Every disk-discovered demo host is then copied outside the repository and
// independently installed, booted, seeded, tested and built. dist-site writes
// are allowed only after the installed public artifact verifier accepts them.

import assert from "node:assert/strict";
import { lstat, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { AUTHORING_ROUTES } from "./routes.mjs";
import { authoringSiteRoutes } from "./host-site-routes.mjs";
import { HOSTED_SITE_ROUTES } from "../packages/demo-studio/hosted-routes.mjs";
import { verifyReleasePortability } from "./verify-release-portability.mjs";
import {
  FIRST_PARTY, WRITABLE, assertConfinedWrites, assertInstalledHost,
  configurePackedHost, copyPackedHost, createPackedWorkspace, discoverPackedHosts,
  isolatedEnvironment, packPackage, pnpm, repositoryRoots, run as runCommand,
  selectPackedHosts, startHostServer as spawnHostServer, tree,
} from "./packed-host-helpers.mjs";
import { MISSING_RUNTIME, packMissingRuntime, plantHoistedDependency } from "./packed-host-negatives.mjs";
import { createPackedGeneratedHost, snapshotPackedFiles } from "./packed-generated-host.mjs";
import { checkNoDeploy } from "./check-no-deploy.mjs";

/** @typedef {import("@playwright/test").Page} Page */
/** @typedef {import("./packed-host-helpers.mjs").HostManifest} HostManifest */
/** @typedef {import("./packed-host-helpers.mjs").Tarballs} Tarballs */
/** @typedef {{packageManager: string, peerDependencies: {preact: string}, devDependencies: Record<string, string>}} ToolPackage */

const root = resolve(import.meta.dirname, "..");
const roots = await repositoryRoots(root);
const environment = isolatedEnvironment(roots);
const ORIGIN = "http://127.0.0.1:4175";
const HOST_NAME = "zudo-composer-install-smoke-host";
const SITEMAP_NAME = "Install smoke sitemap";

/** @param {string} message */
function step(message) {
  process.stdout.write(`[host-install] ${message}\n`);
}

/** @param {string} command @param {string[]} args @param {string} cwd */
function run(command, args, cwd) {
  return runCommand(command, args, cwd, { env: environment });
}

/** @param {string} hostRoot */
function startHostServer(hostRoot) {
  return spawnHostServer(hostRoot, { env: environment });
}

/** @param {{output: () => string}} server @param {string[]} [routes] */
async function fetchAuthoringRoutes(server, routes = AUTHORING_ROUTES) {
  for (const route of routes) {
    const response = await fetch(`${ORIGIN}${route}`, { headers: { accept: "text/html" }, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`${route} answered ${response.status} on a freshly installed host.`);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/, `${route} did not return an HTML document`);
    await response.arrayBuffer();
  }
  if (/Failed to resolve dependency/.test(server.output())) {
    throw new Error(`The installed dev server could not resolve its own dependencies:\n${server.output()}`);
  }
}

/**
 * Open a workspace and create one sitemap through the real authoring UI.
 *
 * A failure here reports what the page was actually showing: this runs against
 * a host nobody can open afterwards, so a bare locator timeout would leave
 * nothing to diagnose from.
 * @param {Page} page
 */
async function authorOneSitemap(page) {
  try {
    await page.goto(`${ORIGIN}/sitemapper`);
    // This host is fresh: require the first-project path rather than accepting
    // an already-open workspace that would skip the bootstrap proof.
    const create = page.getByRole("button", { name: "Create project", exact: true });
    await create.click({ timeout: 90_000 });
    const projectDialog = page.getByRole("dialog", { name: "Create project", exact: true });
    await projectDialog.getByRole("textbox", { name: "Project name", exact: true }).fill("Install smoke project");
    await projectDialog.getByRole("button", { name: "Create project", exact: true }).click();
    await projectDialog.waitFor({ state: "hidden", timeout: 90_000 });
    await page.getByRole("heading", { name: "Sitemaps", exact: true }).waitFor({ timeout: 90_000 });
    const newSitemap = page.getByRole("button", { name: "New sitemap", exact: true });
    await newSitemap.click({ timeout: 90_000 });
    const dialog = page.getByRole("dialog", { name: "Create sitemap" });
    await dialog.getByRole("textbox", { name: "Sitemap name" }).fill(SITEMAP_NAME);
    await dialog.getByRole("button", { name: "Create sitemap" }).click();
    // The dialog closes only after store.put resolves. Its textbox has the same
    // name as the editor field, so waiting on that field alone can race the save.
    await dialog.waitFor({ state: "hidden", timeout: 60_000 });
    await page.getByRole("textbox", { name: "Sitemap name", exact: true }).waitFor({ timeout: 60_000 });
  } catch (cause) {
    const text = await page.locator("body").innerText().catch(() => "<no body>");
    throw new Error(`Authoring failed on the installed host. The page was showing:\n${text}`, { cause });
  }
}

/** @param {string} workspace @param {Tarballs} tarballs @param {ToolPackage} toolPackage */
async function proveSynthesizedHost(workspace, tarballs, toolPackage) {
  const hostRoot = join(workspace, "self-host");
  let server;
  let browser;
  try {
    step("writing a bare host project that has never seen this repository");
    for (const directory of ["styles", "components", "public/uploaded-assets",
      "cms/compositions", "cms/content", "cms/mappings", "cms/sitemaps", "cms/assets"]) {
      await mkdir(join(hostRoot, directory), { recursive: true });
    }
    // `fixtures/self-host` is the reference shape; only its package name is
    // rewritten, so this host proves the same seam under a name of its own rather
    // than inheriting the fixture's identity.
    for (const file of ["components/pack.ts", "components/components.tsx", "styles/base.css"]) {
      const source = await readFile(join(root, "fixtures/self-host", file), "utf8");
      await writeFile(join(hostRoot, file), source.replaceAll("self-host/components", `${HOST_NAME}/components`));
    }
    await writeFile(join(hostRoot, "zudo-composer.config.ts"), `import { defineComposerConfig } from "zudo-composer/config";\n\nexport default defineComposerConfig({ pack: "${HOST_NAME}/components" });\n`);
    await writeFile(join(hostRoot, "package.json"), `${JSON.stringify({
      name: HOST_NAME,
      packageManager: toolPackage.packageManager,
      version: "0.0.0",
      private: true,
      type: "module",
      // The self-reference pack shape: the host's own `exports` is what makes
      // `${HOST_NAME}/components` a public bare import the contract admits.
      exports: { "./components": "./components/pack.ts" },
      scripts: { dev: "zudo-composer dev" },
      devDependencies: {
        "zudo-composer": "workspace:*",
        "@zudo-composer/component-contract": "workspace:*",
        preact: toolPackage.peerDependencies.preact,
      },
    }, null, 2)}\n`);
    await configurePackedHost(hostRoot, tarballs, toolPackage.packageManager);

    step("installing");
    await run(pnpm, ["install", "--no-frozen-lockfile"], hostRoot);
    await run(pnpm, ["install", "--frozen-lockfile"], hostRoot);
    await assertInstalledHost(hostRoot, environment, roots);
    const installedTree = await tree(hostRoot);

    step("booting, with no sample activation of any kind");
    server = await startHostServer(hostRoot);
    await fetchAuthoringRoutes(server);

    step("resolving editor source aliases through the installed launcher");
    const { stdout: editorJson } = await run(process.execPath, ["--input-type=module", "-e", `
      import { createRequire } from 'node:module';
      import { realpath } from 'node:fs/promises';
      import { dirname, resolve } from 'node:path';
      import { pathToFileURL } from 'node:url';
      const require = createRequire(resolve('package.json'));
      const toolRoot = await realpath(dirname(require.resolve('zudo-composer/package.json')));
      const { resolveComposerDevConfig } = await import(pathToFileURL(resolve(toolRoot, 'server/dev-server.mjs')));
      const { inlineConfig } = await resolveComposerDevConfig({workspaceRoot:process.cwd()});
      const entries = ['@zudo-composer/image-editor', '@zudo-composer/image-editor/worker'].map(name => {
        const alias = inlineConfig.resolve.alias.find(alias => alias.find.test(name));
        if (!alias || !alias.replacement.startsWith(toolRoot + '/packages/image-editor/src/')) throw new Error('Editor alias escaped installed tool');
        return '/@fs' + alias.replacement;
      });
      console.log(JSON.stringify({toolRoot, entries}));
    `], hostRoot);
    const editor = JSON.parse(editorJson.trim().split("\n").at(-1) ?? "");
    for (const entry of editor.entries) {
      const response = await fetch(`${ORIGIN}${entry}`);
      if (!response.ok || !(await response.text()).includes("export")) throw new Error(`Installed editor transform failed: ${entry}`);
    }

    step("authoring one record through the browser");
    browser = await chromium.launch();
    const editorPage = await browser.newPage();
    await editorPage.goto(ORIGIN);
    const workerResponse = editorPage.waitForResponse(response => response.url().includes('/packages/image-editor/src/worker/worker.ts'), {timeout:30_000});
    await editorPage.evaluate(async (entries) => {
      const core = await import(/* @vite-ignore */ entries[0]);
      const { createImageEditorClient } = await import(/* @vite-ignore */ entries[1]);
      const service = createImageEditorClient();
      try {
        const source = {width:2,height:2,data:new Uint8ClampedArray(16).fill(255)};
        await service.registerSource(source);
        const result = await service.renderFull(core.createEditDoc(source));
        if (result.width !== 2 || result.data.length !== 16 || result.data[0] !== 255) throw new Error('Installed worker render failed');
      } finally { service.dispose(); }
    }, editor.entries);
    const servedWorker = await workerResponse;
    const workerPath = decodeURIComponent(new URL(servedWorker.url()).pathname);
    const workerFile = await realpath(workerPath.startsWith('/@fs/') ? workerPath.slice('/@fs'.length) : resolve(hostRoot, `.${workerPath}`));
    if (!servedWorker.ok() || workerFile !== join(editor.toolRoot, 'packages/image-editor/src/worker/worker.ts')) throw new Error(`Worker escaped installed tool graph: ${servedWorker.url()}`);
    await editorPage.close();
    const authoring = await browser.newContext();
    await authorOneSitemap(await authoring.newPage());
    await authoring.close();

    const sitemapsDirectory = join(hostRoot, "cms/sitemaps");
    const authored = (await tree(sitemapsDirectory)).filter((path) => path.endsWith(".json"));
    if (authored.length === 0) throw new Error(`Authoring wrote no JSON under ${sitemapsDirectory}.`);
    const authoredJson = await Promise.all(authored.map((path) => readFile(join(sitemapsDirectory, path), "utf8")));
    if (!authoredJson.some((text) => text.includes(SITEMAP_NAME))) {
      throw new Error(`No file under ${sitemapsDirectory} carries the authored name.`);
    }

    step("restarting the server and reopening in a fresh browser context");
    await server.stop();
    server = await startHostServer(hostRoot);
    const reopened = await browser.newContext();
    const page = await reopened.newPage();
    await page.goto(`${ORIGIN}/sitemapper`);
    await page.getByRole("link", { name: SITEMAP_NAME, exact: true }).waitFor({ timeout: 60_000 });
    await reopened.close();
    await browser.close();
    browser = undefined;

    await server.stop();
    server = undefined;
    step("releasing and validating activation across checkout and packed runtimes in both directions");
    await verifyReleasePortability({ checkoutRoot: root, hostRoot });

    step("checking that every write landed inside the host's own directories");
    await assertConfinedWrites(hostRoot, installedTree);

    step("removing the tool and confirming the host keeps its data");
    const manifest = /** @type {HostManifest} */ (JSON.parse(await readFile(join(hostRoot, "package.json"), "utf8")));
    delete manifest.devDependencies?.["zudo-composer"];
    if (manifest.pnpm) delete /** @type {Record<string, string>} */ (manifest.pnpm.overrides)["zudo-composer"];
    await writeFile(join(hostRoot, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await rm(join(hostRoot, "node_modules"), { recursive: true, force: true });
    for (const [path, text] of authored.map((path, index) => [path, authoredJson[index]])) {
      const survived = await readFile(join(sitemapsDirectory, path), "utf8");
      if (survived !== text) throw new Error(`${path} changed when the tool was removed.`);
      JSON.parse(survived);
    }
    for (const file of ["components/pack.ts", "styles/base.css", "zudo-composer.config.ts"]) {
      await readFile(join(hostRoot, file), "utf8");
    }

    step(`passed: ${AUTHORING_ROUTES.length} routes, ${authored.length} authored record file(s), all writes confined to ${WRITABLE.join("/")}, data survived removal.`);
  } finally {
    await browser?.close();
    await server?.stop();
    await rm(hostRoot, { recursive: true, force: true });
  }
}

/** @param {string} hostRoot */
async function verifyInstalledSiteArtifact(hostRoot) {
  // Import from the consumer cwd, never from this script's checkout. Building
  // alone cannot grant dist-site permission: re-open and verify every byte.
  const { stdout } = await run(process.execPath, ["--input-type=module", "-e", `
    import assert from 'node:assert/strict';
    import { readFile } from 'node:fs/promises';
    import { createRequire } from 'node:module';
    import { resolve } from 'node:path';
    import { verifySiteStaticArtifact } from 'zudo-composer/site-build';
    const manifest = await verifySiteStaticArtifact({ directory: resolve('dist-site'), expectedSourceRevision: 'packed-host-install' });
    const project = JSON.parse(await readFile('site-project.json', 'utf8'));
    const require = createRequire(resolve('package.json'));
    const tool = JSON.parse(await readFile(require.resolve('zudo-composer/package.json'), 'utf8'));
    assert.equal(manifest.projectId, project.id);
    assert.ok(manifest.routes.length > 0, 'The packed site artifact has no routes');
    assert.deepEqual(manifest.tool, { name: tool.name, version: tool.version, ...(tool.gitHead === undefined ? {} : { gitHead: tool.gitHead }) });
    console.log(JSON.stringify({ projectId: manifest.projectId, routes: manifest.routes, files: Object.keys(manifest.files).length }));
  `], hostRoot);
  const manifest = JSON.parse(stdout);
  step(`${basename(hostRoot)}: verified installed artifact, ${manifest.routes.length} routes and ${manifest.files} files`);
  return /** @type {{projectId: string, routes: string[], files: number}} */ (manifest);
}

/** Crawl the exact verified artifact routes through the activated installed
 * host, including a refresh and a rendered heading for every emitted page.
 * @param {string[]} routes */
async function verifyInstalledSiteRoutes(routes) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    /** @type {string[]} */
    const failures = [];
    page.on("pageerror", (error) => failures.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") failures.push(message.text()); });
    page.on("requestfailed", (request) => { if (request.failure()?.errorText !== "net::ERR_ABORTED") failures.push(`${request.url()}: ${request.failure()?.errorText}`); });
    for (const route of routes) {
      assert.equal((await page.goto(`${ORIGIN}${route}`))?.status(), 200, `${route} direct navigation failed`);
      await page.locator("h1").first().waitFor({ state: "visible", timeout: 90_000 });
      assert.equal((await page.reload())?.status(), 200, `${route} refresh failed`);
      await page.locator("h1").first().waitFor({ state: "visible", timeout: 90_000 });
      assert.equal(await page.getByRole("heading", { name: "Page not found", exact: true }).count(), 0, `${route} is absent from the activated host`);
    }
    assert.deepEqual(failures, [], "Installed site routes reported runtime failures");
  } finally { await browser.close(); }
}

/** Confirm ready state through the actual installed authoring UI before seed.
 * @param {string} hostRoot */
async function verifyGeneratedReadyHost(hostRoot) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    /** @type {string[]} */
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const [route, labels] of [
      ["/composer", ["Home", "Site frame"]], ["/content", ["Welcome"]],
      ["/mapping", ["Home"]], ["/sitemapper", ["My site"]], ["/assets", ["starter.png"]],
    ]) {
      await page.goto(`${ORIGIN}${route}`);
      for (const label of labels) await page.getByText(label, { exact: true }).first().waitFor({ timeout: 90_000 });
      assert.equal(await page.getByRole("button", { name: "Create project", exact: true }).count(), 0, "Generated output unexpectedly requires first activation");
    }
    assert.deepEqual(errors, [], "Generated host reported browser runtime errors");
    await assert.rejects(lstat(join(hostRoot, ".zudo-site-project")), { code: "ENOENT" }, "Opening ready CMS must not create an activated release");
  } finally { await browser.close(); }
}

/**
 * @param {string} sourceHost @param {string} workspace @param {Tarballs} tarballs
 * @param {ToolPackage} toolPackage @param {string | undefined} negative
 * @param {boolean} [generated]
 */
async function proveDiskHost(sourceHost, workspace, tarballs, toolPackage, negative, generated = false) {
  const name = basename(sourceHost);
  const hostRoot = join(workspace, name);
  let server;
  /** @type {Awaited<ReturnType<typeof plantHoistedDependency>> | undefined} */
  let planted;
  try {
    step(`${name}: copying the complete host tree outside the repository`);
    await copyPackedHost(sourceHost, hostRoot);
    const manifest = await configurePackedHost(hostRoot, tarballs, toolPackage.packageManager);
    for (const section of [manifest.dependencies, manifest.devDependencies, manifest.peerDependencies, manifest.optionalDependencies]) {
      if (section?.["@zudo-sg/ui"]) assert.equal(section["@zudo-sg/ui"], toolPackage.devDependencies["@zudo-sg/ui"], "The provider must retain its exact Git pin");
    }
    if (negative === "hoisted-dependency") {
      planted = await plantHoistedDependency({ root, sourceHost, hostRoot, env: environment });
      step(`${name}: source-host control resolved root-hoisted ${planted.name}; only the copied config now imports it undeclared`);
    }

    step(`${name}: installing the tool and contract tarballs with exact overrides`);
    await run(pnpm, ["install", "--no-frozen-lockfile"], hostRoot);
    await run(pnpm, ["install", "--frozen-lockfile"], hostRoot);
    const installed = await assertInstalledHost(hostRoot, environment, roots);
    step(`${name}: package resolution is confined to ${hostRoot}/node_modules (${FIRST_PARTY.length} packed packages)`);
    assert.equal(Object.keys(installed).length, FIRST_PARTY.length);
    const installedTree = await tree(hostRoot);
    const readyCms = generated ? await snapshotPackedFiles(join(hostRoot, "cms")) : undefined;

    step(`${name}: booting the installed CLI and fetching all ${AUTHORING_ROUTES.length} authoring routes`);
    server = await startHostServer(hostRoot);
    await fetchAuthoringRoutes(server);
    if (generated) await verifyGeneratedReadyHost(hostRoot);
    await server.stop();
    server = undefined;

    if (generated) {
      assert.deepEqual(await snapshotPackedFiles(join(hostRoot, "cms")), readyCms, "Opening generated ready CMS changed its bytes");
      step(`${name}: checking generated-host types and its own checks before reseeding`);
      await run(pnpm, ["run", "check"], hostRoot);
    }
    step(`${name}: checking authored source, importing assets and seeding through the installed CLI`);
    await run(pnpm, ["exec", "zudo-composer", "generate", "--check"], hostRoot);
    // The host's self-contained seed script runs assets import followed by seed.
    await run(pnpm, ["run", "seed"], hostRoot);
    step(`${name}: building its static site and running its own test suite`);
    await run(pnpm, ["exec", "zudo-composer", "build-site", "--source-revision", "packed-host-install"], hostRoot);
    await run(pnpm, ["run", "test"], hostRoot);
    const artifact = await verifyInstalledSiteArtifact(hostRoot);
    const routes = authoringSiteRoutes(artifact.routes);
    if (name === "demo-studio") assert.deepEqual([...routes].sort(), [...HOSTED_SITE_ROUTES].sort(), "Studio artifact differs from its frozen production live-route data");
    server = await startHostServer(hostRoot);
    await fetchAuthoringRoutes(server, routes);
    await verifyInstalledSiteRoutes(routes);
    await server.stop();
    server = undefined;
    await assertConfinedWrites(hostRoot, installedTree, async () => { await verifyInstalledSiteArtifact(hostRoot); });
    step(`${name}: passed installed dev, generate, seed, build, tests and write confinement`);
  } finally {
    await server?.stop();
    await planted?.remove();
    await rm(hostRoot, { recursive: true, force: true });
  }
}

const selection = selectPackedHosts(process.argv.slice(2).filter((argument) => argument !== "--"), discoverPackedHosts(root));
checkNoDeploy({ root });
const workspace = await createPackedWorkspace(roots);
try {
  step(`external workspace: ${workspace}`);
  step(`packing the actual tool and contract for ${selection.hosts.length} disk host(s)${selection.fixture ? " and the synthesized fixture" : ""}`);
  /** @type {Tarballs} */
  const tarballs = {};
  for (const [name, directory] of [["zudo-composer", root], ["@zudo-composer/component-contract", join(root, "packages/component-contract")]]) {
    tarballs[name] = await packPackage(directory, join(workspace, "tarballs"));
  }
  if (selection.negative === "missing-runtime") {
    tarballs["zudo-composer"] = await packMissingRuntime(tarballs["zudo-composer"], workspace);
    step(`negative missing-runtime: excluded ${MISSING_RUNTIME} through the tool files allowlist and repacked with pnpm`);
  }
  const toolPackage = /** @type {ToolPackage} */ (JSON.parse(await readFile(join(root, "package.json"), "utf8")));
  if (selection.fixture) await proveSynthesizedHost(workspace, tarballs, toolPackage);
  for (const host of selection.hosts) await proveDiskHost(host, workspace, tarballs, toolPackage, selection.negative);
  if (selection.generated) {
    step("generated: creating canonical ready output through a separately installed CLI");
    const generated = await createPackedGeneratedHost({ root, workspace, roots, tarballs, env: environment });
    const copies = join(workspace, "generated-proof");
    await mkdir(copies);
    await proveDiskHost(generated.source, copies, tarballs, toolPackage, undefined, true);
    await generated.assertPristine();
    step("generated: passed installed creation, strict pristine-output checks and the full packed-host proof");
  }
  step(`passed: ${selection.hosts.length} disk host(s)${selection.fixture ? " plus the synthesized fixture" : ""}${selection.generated ? " plus freshly generated output" : ""}`);
} finally {
  await rm(workspace, { recursive: true, force: true });
}
