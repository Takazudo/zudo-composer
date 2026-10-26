// @ts-check
// Lifecycle proof for scripts/assistant/local-host.mjs, fully offline with the
// fake provider in a temporary --dir on a free loopback port (never the
// launcher's 4178 or the 4175–4177 lanes). Real launcher process, real dev
// server and real browser; serial by construction.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearTimeout } from "node:timers";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { frame, lastReply, send } from "./browser-helpers.mjs";

const launcher = fileURLToPath(new URL("./local-host.mjs", import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), "assistant-local-host-"));
const dir = join(temporary, "host");
const log = (/** @type {string} */ line) => console.log(`local-host: ${line}`);
const port = await new Promise((settle, reject) => {
  const probe = createServer().once("error", reject).listen(0, "127.0.0.1", () => {
    const address = probe.address();
    probe.close(() => settle(typeof address === "object" && address ? address.port : 0));
  });
});
const origin = `http://127.0.0.1:${port}`;
const composition = join(dir, "cms/compositions/workspace-v1-native-proof/composition-home.composition.json");
const markerOf = () => readFile(join(dir, ".zudo-local-host.json"), "utf8");

/** Runs the launcher to completion (refusals). @param {string[]} args */
function runToExit(args) {
  return new Promise((settle) => {
    const child = spawn(process.execPath, [launcher, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { output += chunk; });
    child.once("close", code => settle({ code, output }));
  });
}

/** Starts the launcher and resolves once it prints the URL. @param {string[]} args */
async function launch(args) {
  const child = spawn(process.execPath, [launcher, "--dir", dir, "--port", String(port), ...args], { stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  const closed = new Promise(settle => child.once("close", settle));
  await new Promise((settle, reject) => {
    const timer = setTimeout(() => reject(new Error(`launcher never printed its URL:\n${output}`)), 240_000);
    const check = () => { if (/Ctrl\+C stops/.test(output)) { clearTimeout(timer); settle(undefined); } };
    child.stdout.on("data", chunk => { output += chunk; check(); });
    child.stderr.on("data", chunk => { output += chunk; });
    closed.then(code => { clearTimeout(timer); reject(new Error(`launcher exited ${code} before ready:\n${output}`)); });
  });
  return {
    output: () => output,
    url: /Open:\s+(\S+)/.exec(output)?.[1] ?? "",
    async stop() {
      child.kill("SIGTERM");
      const code = await closed;
      assert.equal(code, 0, `launcher should stop cleanly:\n${output}`);
    },
  };
}

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
    const result = /** @type {{ code: number, output: string }} */ (await runToExit([...args, "--port", String(port)]));
    assert.notEqual(result.code, 0, result.output);
    assert.match(result.output, /Refusing to (reset|use)/);
  }
  assert.equal(await readFile(join(foreign, "keep.txt"), "utf8"), "not a local host");
  const reserved = /** @type {{ code: number, output: string }} */ (await runToExit(["--dir", dir, "--port", "4177"]));
  assert.notEqual(reserved.code, 0);
  assert.match(reserved.output, /reserved/);
  log("refused a foreign --reset/--dir and a reserved port");

  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
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
  await running.stop();
  running = undefined;
  log("switched to claude-cli without reset; unavailable executable reported");

  // Explicit --reset of our own host starts over.
  running = await launch(["--reset"]);
  assert.match(running.output(), /"edit-host" created/);
  assert.notEqual(await markerOf(), marker);
  assert.doesNotMatch(await readFile(composition, "utf8"), /Persisted local change/);
  assert.match(await readFile(join(dir, "zudo-composer.config.ts"), "utf8"), /"provider":"fake"/);
  await running.stop();
  running = undefined;
  log("--reset recreated this command's own host");
  log("passed");
} catch (error) {
  if (running) console.error(running.output());
  throw error;
} finally {
  await running?.stop().catch(() => {});
  await browser?.close();
  await rm(temporary, { recursive: true, force: true });
}
