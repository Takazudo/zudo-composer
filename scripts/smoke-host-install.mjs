// @ts-check

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
// Six claims, in order, each failing loudly on its own line:
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
// It deliberately uses the host-self-reference pack shape: the host owns its
// components, so the proof needs no second package and stays about zudo-composer.

import { execFile as execFileCallback, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { chromium } from "@playwright/test";
import { verifyReleasePortability } from "./verify-release-portability.mjs";

/** @typedef {import("node:child_process").ExecFileOptionsWithStringEncoding} ExecFileOptions */
/** @typedef {import("@playwright/test").Page} Page */
/** @typedef {{packageManager: string, peerDependencies: {preact: string}}} ToolPackage */
/** @typedef {{devDependencies: Record<string, string>}} HostManifest */

const execFile = promisify(execFileCallback);
const root = resolve(import.meta.dirname, "..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const PORT = 4175;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const HOST_NAME = "zudo-composer-install-smoke-host";
const SITEMAP_NAME = "Install smoke sitemap";

/** Routes the README promises a host. Each must answer the shell, not a 404. */
const ROUTES = ["/", "/composer", "/content", "/mapping", "/sitemapper", "/assets"];

/**
 * Directories a host agrees zudo-composer may write into. `node_modules` is the
 * package manager's; the rest come from `zudo-composer.config.ts` defaults plus
 * the disposable release root. Anything else appearing under the host root is a
 * write-confinement failure.
 */
const WRITABLE = ["node_modules", "cms", "public", ".zudo-site-project"];

/** @param {string} message */
function step(message) {
  process.stdout.write(`[host-install] ${message}\n`);
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {string} cwd
 * @param {ExecFileOptions} [options]
 * @returns {Promise<{stdout: string, stderr: string}>}
 */
async function run(command, args, cwd, options = {}) {
  const { stdout, stderr } = await execFile(command, args, { cwd, env: process.env, maxBuffer: 64 * 1024 * 1024, encoding: "utf8", ...options });
  return { stdout, stderr };
}

/**
 * Every path beneath `directory`, relative and sorted, excluding `node_modules`.
 * @param {string} directory
 * @param {string} [prefix]
 * @returns {Promise<string[]>}
 */
async function tree(directory, prefix = "") {
  const entries = await readdir(join(directory, prefix), { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.name === "node_modules") continue;
    paths.push(path);
    if (entry.isDirectory()) paths.push(...await tree(directory, path));
  }
  return paths.sort();
}

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`${ORIGIN}/@vite/client`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((settle) => setTimeout(settle, 500));
  }
  throw new Error(`The installed dev server never answered on ${ORIGIN}.`);
}

/**
 * Start the host's own installed bin and resolve once it is serving. The child
 * gets its own process group so the whole Vite tree can be signalled at once.
 * @param {string} hostRoot
 */
async function startHostServer(hostRoot) {
  const child = spawn(pnpm, ["exec", "zudo-composer", "dev", "--host", "127.0.0.1", "--port", String(PORT), "--strict-port"], {
    cwd: hostRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += String(chunk); });
  child.stderr.on("data", (chunk) => { output += String(chunk); });
  // A server that dies during startup has to lose the race rather than let it
  // run out the full poll budget. The listener is dropped as soon as the race
  // is decided, so a later exit can never reject a promise nobody is awaiting.
  const exited = new Promise((_, reject) => {
    child.on("exit", (code) => reject(new Error(`The installed dev server exited with ${code}:\n${output}`)));
  });
  try {
    await Promise.race([waitForServer(), exited]);
  } finally {
    child.removeAllListeners("exit");
  }
  return {
    output: () => output,
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const stopped = new Promise((settle) => child.once("exit", settle).once("error", settle));
      const pid = /** @type {number} */ (child.pid);
      try { process.kill(-pid, "SIGTERM"); } catch { return; }
      await stopped;
    },
  };
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

const workspace = await realpath(await mkdtemp(join(tmpdir(), "zudo-composer-install-smoke-")));
const hostRoot = join(workspace, "host");
let server;
let browser;
try {
  step("packing the package and the contract it declares as a peer");
  const packDirectory = join(workspace, "tarballs");
  await mkdir(packDirectory, { recursive: true });
  const tarballs = /** @type {Record<string, string>} */ ({});
  for (const [name, directory] of [["zudo-composer", root], ["@zudo-composer/component-contract", join(root, "packages/component-contract")]]) {
    const { stdout } = await run(pnpm, ["pack", "--pack-destination", packDirectory], directory);
    tarballs[name] = /** @type {string} */ (stdout.trim().split("\n").at(-1));
    if (!tarballs[name]?.endsWith(".tgz")) throw new Error(`pnpm pack did not name a tarball for ${name}: ${stdout}`);
  }

  step("writing a bare host project that has never seen this repository");
  const toolPackage = /** @type {ToolPackage} */ (JSON.parse(await readFile(join(root, "package.json"), "utf8")));
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
      "zudo-composer": `file:${tarballs["zudo-composer"]}`,
      "@zudo-composer/component-contract": `file:${tarballs["@zudo-composer/component-contract"]}`,
      preact: toolPackage.peerDependencies.preact,
    },
  }, null, 2)}\n`);
  // Build permissions stay package-specific; this host needs no Git subdependency exception.
  await writeFile(join(hostRoot, "pnpm-workspace.yaml"), 'allowBuilds:\n  "@zudo-composer/component-contract": true\n  esbuild: true\n');

  step("installing");
  await run(pnpm, ["install"], hostRoot);
  await run(pnpm, ["install", "--frozen-lockfile"], hostRoot);
  const installedTree = await tree(hostRoot);

  step("booting, with no sample activation of any kind");
  server = await startHostServer(hostRoot);
  for (const route of ROUTES) {
    const response = await fetch(`${ORIGIN}${route}`, { headers: { accept: "text/html" } });
    if (!response.ok) throw new Error(`${route} answered ${response.status} on a freshly installed host.`);
  }
  if (/Failed to resolve dependency/.test(server.output())) {
    throw new Error(`The installed dev server could not resolve its own dependencies:\n${server.output()}`);
  }

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
  const written = (await tree(hostRoot)).filter((path) => !installedTree.includes(path));
  const escaped = written.filter((path) => !WRITABLE.includes(path.split("/")[0]));
  if (escaped.length > 0) throw new Error(`Writes escaped the host's directories: ${escaped.join(", ")}`);

  step("removing the tool and confirming the host keeps its data");
  const manifest = /** @type {HostManifest} */ (JSON.parse(await readFile(join(hostRoot, "package.json"), "utf8")));
  delete manifest.devDependencies["zudo-composer"];
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

  step(`passed: ${ROUTES.length} routes, ${authored.length} authored record file(s), all writes confined to ${WRITABLE.join("/")}, data survived removal.`);
} finally {
  await browser?.close();
  await server?.stop();
  await rm(workspace, { recursive: true, force: true });
}
