// @ts-check
// Lifecycle proof for scripts/assistant/local-host.mjs, fully offline with the
// fake provider in temporary --dir hosts on a free loopback port (never the
// launcher's 4178 or the 4175–4177 lanes). Real launcher process, real dev
// server and real browser; serial by construction. The native-edit fixture
// proves refusals, restart, provider switching and --reset; then each of the
// four demos runs its editing journey, and every demo is restarted to prove
// persistence, isolation and Undo. `-- --host <name>` limits the demo part.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, expect } from "@playwright/test";
import { frame, lastReply, send } from "./browser-helpers.mjs";
import { freePort, launchLocalHost, runLauncherToExit as runToExit } from "./launch-local-host.mjs";
import { LOCAL_DEMOS, demoSource, firstRun, restartAndUndo, sourceDigest } from "./local-demo-journeys.mjs";
import { parseArgs } from "node:util";

const { values: cli } = parseArgs({ args: process.argv.slice(2).filter(arg => arg !== "--"), options: { host: { type: "string", multiple: true }, "skip-edit-host": { type: "boolean", default: false } } });
const demos = LOCAL_DEMOS.filter(demo => !cli.host?.length || cli.host.includes(demo.host));
if (cli.host?.some(host => !LOCAL_DEMOS.some(demo => demo.host === host))) throw new Error(`--host must be one of ${LOCAL_DEMOS.map(demo => demo.host).join(", ")}`);

const temporary = await mkdtemp(join(tmpdir(), "assistant-local-host-"));
const dir = join(temporary, "host");
const log = (/** @type {string} */ line) => console.log(`local-host: ${line}`);
const port = await freePort();
const origin = `http://127.0.0.1:${port}`;
const composition = join(dir, "cms/compositions/workspace-v1-native-proof/composition-home.composition.json");
const markerOf = () => readFile(join(dir, ".zudo-local-host.json"), "utf8");
/** @param {string[]} args */
const launch = args => launchLocalHost(["--dir", dir, "--port", String(port), ...args]);

/** @type {import('@playwright/test').Browser | undefined} */
let browser;
/** @type {Awaited<ReturnType<typeof launch>> | undefined} */
let running;
try {
  // Refusals: reserved ports and directories this command did not create.
  const foreign = join(temporary, "foreign");
  await mkdir(foreign);
  await writeFile(join(foreign, "keep.txt"), "not a local host");
  for (const args of [["--dir", foreign, "--reset"], ["--dir", foreign]]) {
    const result = (await runToExit([...args, "--port", String(port)]));
    assert.notEqual(result.code, 0, result.output);
    assert.match(result.output, /Refusing to (reset|use)/);
  }
  assert.equal(await readFile(join(foreign, "keep.txt"), "utf8"), "not a local host");
  const reserved = (await runToExit(["--dir", dir, "--port", "4177"]));
  assert.notEqual(reserved.code, 0);
  assert.match(reserved.output, /reserved/);
  // `pnpm assistant:local -- …` passes the separator through.
  const help = await runToExit(["--", "--help"]);
  assert.equal(help.code, 0, help.output);
  assert.match(help.output, /--host sample\|landing\|blog\|webshop\|edit-host/);
  log("refused a foreign --reset/--dir and a reserved port; accepted pnpm's -- separator");

  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  if (!cli["skip-edit-host"]) await editHostLifecycle(browser);
  await demoJourneys(browser);
  log("passed");
} catch (error) {
  if (running) console.error(running.output());
  throw error;
} finally {
  await running?.stop().catch(() => {});
  await browser?.close();
  await rm(temporary, { recursive: true, force: true });
}

/** @param {import('@playwright/test').Browser} browser */
async function editHostLifecycle(browser) {
  running = await launch(["--host", "edit-host", "--provider", "fake"]);
  assert.match(running.output(), /"edit-host" created/);
  assert.equal(running.url, `${origin}/composer?assistant=1&sitemap=main&page=home`);
  const marker = await markerOf();
  let page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(running.url);
  await expect(frame(page, "Current").getByText("Before replacement", { exact: true })).toBeVisible({ timeout: 120_000 });
  await send(page, "remember: Our readers are first-time gardeners.");
  await expect(lastReply(page).getByText("Memory update proposal")).toBeVisible();
  await lastReply(page).getByRole("button", { name: "Save to Memory" }).click();
  await expect(lastReply(page).getByText(/Saved as r\d+/)).toBeVisible();
  await send(page, 'replace "Before replacement" with "Persisted local change"');
  await expect(page.locator(".cms-assistant-review .cms-assistant-count").first()).toHaveText("1");
  await page.getByRole("button", { name: /^Draft/ }).click();
  await expect(frame(page, "Draft").getByText("Persisted local change", { exact: true })).toBeVisible();
  await expect(page.locator("#assistant-apply-state")).toContainText("rendered successfully", { timeout: 30_000 });
  await page.getByRole("button", { name: "Apply to Composer" }).click();
  await expect(page.getByRole("heading", { name: "Applied to Composer" })).toBeVisible({ timeout: 60_000 });
  assert.match(await readFile(composition, "utf8"), /Persisted local change/);
  await page.close();
  await running.stop();
  running = undefined;
  log("first run created the host; Memory saved, proposal applied, server stopped");

  // Restart: same data, no reinitialization, provider chosen again explicitly.
  running = await launch(["--provider", "fake"]);
  assert.match(running.output(), /"edit-host" reused/);
  assert.doesNotMatch(running.output(), /Creating a new/);
  assert.equal(await markerOf(), marker, "a normal start must not recreate the host");
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(running.url);
  await expect(frame(page, "Current").getByText("Persisted local change", { exact: true })).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('.cms-assistant-message[data-role="user"]').filter({ hasText: 'replace "Before replacement"' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: /^Memory/ }).click();
  await expect(page.getByRole("dialog", { name: /Site Memory/ }).getByRole("textbox")).toHaveValue(/first-time gardeners/);
  await page.close();
  await running.stop();
  running = undefined;
  log("restart reused the host: conversation, Memory and applied page change persisted");

  // Switching provider needs no reset; an unavailable CLI is reported, never replaced.
  running = await launch(["--provider", "claude-cli", "--executable", join(temporary, "missing-claude")]);
  assert.match(running.output(), /"edit-host" reused/);
  assert.match(running.output(), /Provider: claude-cli — unavailable: .*missing-claude is not an executable file/);
  assert.match(await readFile(join(dir, "zudo-composer.config.ts"), "utf8"), /"provider":"claude-cli"/);
  assert.equal(await markerOf(), marker);
  assert.match(await readFile(composition, "utf8"), /Persisted local change/);
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(running.url);
  await expect(page.getByText("AI replies are unavailable.")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
  await page.close();
  await running.stop();
  running = undefined;
  // A CLI that exists but does not start is found by the launcher and refused by the server's own check.
  const broken = join(temporary, "broken-claude");
  await writeFile(broken, "#!/bin/sh\necho 'broken on purpose' >&2\nexit 3\n", { mode: 0o755 });
  running = await launch(["--provider", "claude-cli", "--executable", broken]);
  assert.match(running.output(), /Provider: claude-cli — found .*broken-claude/);
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(running.url);
  await expect(page.getByText("AI replies are unavailable.")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
  await page.close();
  await running.stop();
  running = undefined;
  log("switched to claude-cli without reset; missing and failing executables shown as unavailable, never replaced");

  // Explicit --reset of our own host starts over.
  running = await launch(["--reset"]);
  assert.match(running.output(), /"edit-host" created/);
  assert.notEqual(await markerOf(), marker);
  assert.doesNotMatch(await readFile(composition, "utf8"), /Persisted local change/);
  assert.match(await readFile(join(dir, "zudo-composer.config.ts"), "utf8"), /"provider":"fake"/);
  await running.stop();
  running = undefined;
  log("--reset recreated this command's own host");
}

/** @param {import('@playwright/test').Browser} browser */
async function demoJourneys(browser) {
  const sources = await Promise.all(demos.map(demo => sourceDigest(demoSource(demo))));
  const hostDir = (/** @type {string} */ host) => join(temporary, "demos", host);
  /** @type {Map<string, Record<string, string>>} */
  const originals = new Map();
  for (const demo of demos) originals.set(demo.host, (await firstRun(browser, { dir: hostDir(demo.host), port, demo, log })).before);
  for (const demo of demos) {
    await restartAndUndo(browser, { dir: hostDir(demo.host), port, demo, before: /** @type {Record<string, string>} */ (originals.get(demo.host)), others: LOCAL_DEMOS.filter(other => other !== demo), log });
  }
  assert.deepEqual(await Promise.all(demos.map(demo => sourceDigest(demoSource(demo)))), sources, "packages/demo-* source, generated CMS and assets must be unchanged");
  log(`demos (${demos.map(demo => demo.host).join(", ")}): source packages unchanged`);
}
