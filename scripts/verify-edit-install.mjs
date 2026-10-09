// @ts-check
/* global HTMLImageElement */
// This owns browser port 4175. Invoke through heavy-guard after building dist.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import { createPackedWorkspace, isolatedEnvironment, packPackage, repositoryRoots, run, startHostServer } from "./packed-host-helpers.mjs";

const root = resolve(import.meta.dirname, "..");
const roots = await repositoryRoots(root);
const temporary = await createPackedWorkspace(roots);
const host = join(temporary, "host");
const env = isolatedEnvironment(roots);
const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
/** @type {Awaited<ReturnType<typeof startHostServer>> | undefined} */
let server;
/** @type {import('@playwright/test').Browser | undefined} */
let browser;

/** Run the installed CLI with JSON stdin; never import repository internals.
 * @param {string[]} args @param {unknown} input
 */
async function cli(args, input) {
  const child = spawn("corepack", ["pnpm", "exec", "zudo-composer", ...args], { cwd: host, env, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => { stdout += String(chunk); });
  child.stderr.on("data", chunk => { stderr += String(chunk); });
  const done = new Promise((resolveDone, reject) => child.once("error", reject).once("exit", code => code === 0 ? resolveDone(stdout) : reject(new Error(`CLI ${args.join(" ")} failed (${code}): ${stderr}\n${stdout}`))));
  child.stdin.end(JSON.stringify(input));
  await done;
  const envelope = JSON.parse(stdout);
  assert.equal(envelope.ok, true, JSON.stringify(envelope));
  return envelope.result;
}

try {
  await cp(join(root, "fixtures/edit-host"), host, { recursive: true });
  await mkdir(join(temporary, "packs"));
  const tool = await packPackage(root, join(temporary, "packs"));
  const contract = await packPackage(join(root, "packages/component-contract"), join(temporary, "packs"));
  await writeFile(join(host, "package.json"), JSON.stringify({
    name: "native-edit-host", version: "0.0.0", private: true, type: "module", packageManager: manifest.packageManager,
    exports: { "./components": "./components/pack.mjs" },
    dependencies: { "zudo-composer": tool, "@zudo-composer/component-contract": contract, preact: manifest.dependencies.preact ?? manifest.peerDependencies?.preact ?? manifest.devDependencies.preact },
  }, null, 2));
  await writeFile(join(host, "pnpm-workspace.yaml"), `packages: []\nstrictPeerDependencies: true\noverrides:\n  zudo-composer: '${tool}'\n  '@zudo-composer/component-contract': '${contract}'\n`);
  await run("corepack", ["pnpm", "install"], host, { env });
  await run("corepack", ["pnpm", "install", "--frozen-lockfile"], host, { env });
  const { stdout } = await run(process.execPath, ["initialize.mjs"], host, { env });
  const initialized = JSON.parse(stdout);
  assert.equal(initialized.workspaceId, "native-proof");
  const { proveEdits, exactText } = await import("./fixtures/native-edit/operations.mjs");
  const lastPlan = await proveEdits(cli, initialized);
  const publicProof = await run(process.execPath, ["verify.mjs", lastPlan.id], host, { env });
  console.log(publicProof.stdout.trim());

  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  for (const pass of ["first open", "server restart"]) {
    server = await startHostServer(host, { env, command: process.execPath, args: [join(host, "node_modules/zudo-composer/bin/zudo-composer.mjs"), "dev", "--host", "127.0.0.1", "--port", "4175", "--strict-port"] });
    await assert.rejects(cli(["edit", "plan", "--stdin"], { workspaceId: initialized.workspaceId, page: "/", after: { nodeId: "list" }, insert: { kind: "text", text: "Must not write while GUI owns host" } }), /authoring-busy/);
    await assert.rejects(cli(["edit", "apply", "--stdin"], { planId: lastPlan.id, approve: lastPlan.digest }), /authoring-busy/);
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = /** @type {string[]} */ ([]);
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("http://127.0.0.1:4175/composer?provider=files&composition=home");
    const canvas = page.frameLocator('iframe[title="Composer preview canvas"]');
    await expect(canvas.getByText("Before replacement", { exact: true })).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => canvas.locator("p").filter({ hasText: "正確な日本語の追記。" }).textContent()).toBe(exactText);
    await expect(canvas.getByRole("cell", { name: "そのまま保持", exact: true })).toBeVisible();
    await expect(canvas.getByRole("cell", { name: "Before cell", exact: true })).toBeVisible();
    const image = canvas.getByRole("img", { name: "Native managed image", exact: true });
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate(element => element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0)).toBe(true);
    assert.deepEqual(errors, [], `${pass}: browser runtime errors`);
    await context.close();
    await server.stop(); server = undefined;
    console.log(`Installed native editing Composer ${pass}: passed.`);
  }
} finally {
  await browser?.close();
  await server?.stop();
  await rm(temporary, { recursive: true, force: true });
}
