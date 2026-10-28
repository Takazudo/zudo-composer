// @ts-check
/* global getComputedStyle */
// The four real demos through the persistent launcher (scripts/assistant/local-host.mjs),
// one at a time, with the offline fake provider and the real pack renderers.
// Evidence class: real launcher, dev server, renderers and editing service;
// deterministic fake replies. Not live-inference evidence.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";
import { frame, highlighted, lastReply, send } from "./browser-helpers.mjs";
import { launchLocalHost } from "./launch-local-host.mjs";

const repo = fileURLToPath(new URL("../..", import.meta.url));

/**
 * One row per demo. `find`/`replace` target a real editable Composition field on
 * Home. `shared` is visible Home text from the locked shared site-frame template
 * and `owned` a Content value delivered through Mapping; the Assistant must not
 * be able to change either.
 * @typedef {{ host: "sample" | "landing" | "blog" | "webshop", name: string, pack: string, home: { sitemapId: string, pageId: string }, heading: string, token: string, find: string, replace: string, shared: string, owned: string }} Demo
 * @type {readonly Demo[]}
 */
export const LOCAL_DEMOS = Object.freeze([
  { host: "sample", name: "Sample Studio", pack: "@zudo-composer/ui/composer-pack", home: { sitemapId: "sample-studio-sitemap", pageId: "home-node" }, heading: "Clear ideas, carefully shaped", token: "--palette-neutral-0", find: "Clear ideas, carefully shaped", replace: "Clear ideas, shaped together", shared: "SAMPLE_SHARED", owned: "SAMPLE_OWNED" },
  { host: "landing", name: "Orrery", pack: "demo-landing/components", home: { sitemapId: "demo-landing-sitemap", pageId: "home-node" }, heading: "Every moving part of your week", token: "--land-palette-gray-0", find: "Plan next week in ten minutes", replace: "Plan next week in five minutes", shared: "A fictional product for a demo site.", owned: "Which calendars does Orrery work with?" },
  { host: "blog", name: "Margin Notes", pack: "demo-blog/components", home: { sitemapId: "margin-notes-sitemap", pageId: "home" }, heading: "Notes from the margin", token: "--blog-palette-gray-0", find: "The Sunday note", replace: "The Saturday note", shared: "Margin Notes is a two-author journal", owned: "A desk with one thing on it" },
  { host: "webshop", name: "Nightjar Supply", pack: "demo-webshop/components", home: { sitemapId: "nightjar-supply-sitemap", pageId: "home" }, heading: "Letters from the shelf", token: "--shop-palette-gray-0", find: "Letters from the shelf", replace: "Letters from the workbench", shared: "Nightjar Supply is a demo shop.", owned: "Brass Rule 30 cm" },
]);

/** Every tracked-or-not byte of a demo package except installs and build output. @param {string} dir */
export async function sourceDigest(dir) {
  const hash = createHash("sha256");
  const walk = async (/** @type {string} */ current) => {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (["node_modules", "dist-site", "dist-editor", ".vite"].includes(entry.name)) continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) hash.update(relative(dir, path)).update("\0").update(await readFile(path)).update("\0");
    }
  };
  await walk(dir);
  return hash.digest("hex");
}

export const demoSource = (/** @type {Demo} */ demo) => join(repo, "packages", `demo-${demo.host}`);

/** Content and Mapping records of an editable host, which Assistant edits never write. @param {string} dir */
const ownedData = async (/** @type {string} */ dir) => Promise.all(["cms/content", "cms/mappings"].map(path => sourceDigest(join(dir, path))));

/** Saved Composition JSON + derived JSX of the host's workspace. @param {string} dir @param {Demo} demo */
async function canonical(dir, demo) {
  const root = join(dir, `cms/compositions/workspace-v1-${demo.host}-assistant`);
  const names = (await readdir(root)).filter(name => name.endsWith(".composition.json") || name.endsWith(".tsx")).sort();
  return Object.fromEntries(await Promise.all(names.map(async name => [name, await readFile(join(root, name), "utf8")])));
}
const withoutTimestamps = (/** @type {Record<string, string>} */ files) => Object.fromEntries(Object.entries(files).map(([name, text]) => [name, text.replace(/"updatedAt": "[^"]+"/g, "")]));

/**
 * @param {import('@playwright/test').Browser} browser
 * @param {{ dir: string, port: number, demo: Demo, log: (line: string) => void }} options
 */
export async function firstRun(browser, { dir, port, demo, log }) {
  const running = await launchLocalHost(["--host", demo.host, "--provider", "fake", "--dir", dir, "--port", String(port)]);
  try {
    assert.match(running.output(), new RegExp(`"${demo.host}" created`));
    assert.equal(running.url, `http://127.0.0.1:${port}/composer?assistant=1&sitemap=${demo.home.sitemapId}&page=${demo.home.pageId}`, "first run opens the demo's Home");
    assert.match(await readFile(join(dir, "zudo-composer.config.ts"), "utf8"), new RegExp(`pack: "${demo.pack.replaceAll("/", "\\/")}"`), "the source host's own pack specifier is kept");
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = /** @type {string[]} */ ([]);
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(running.url);
    const current = frame(page, "Current");
    await expect(current.getByText(demo.heading).first()).toBeVisible({ timeout: 120_000 });
    await expect.poll(() => current.locator("html").evaluate((html, token) => getComputedStyle(html).getPropertyValue(token).trim(), demo.token), { timeout: 30_000 }).not.toBe("");
    // Lazy images below the fold may not load yet; none that finished may be broken.
    await expect.poll(() => current.locator("img").evaluateAll(images => images.map(image => /** @type {HTMLImageElement} */ (image)).filter(image => image.complete && image.naturalWidth === 0).length), { timeout: 30_000 }).toBe(0);
    // The demo's managed images entered through the owning Assets store and are served by this host.
    const catalog = JSON.parse(await readFile(join(dir, "cms/assets/catalog.json"), "utf8"));
    assert.ok(catalog.records.length > 0, "the demo's assets were imported");
    for (const record of catalog.records) {
      const response = await fetch(`http://127.0.0.1:${port}${record.document.versions[0].url}`);
      assert.equal(response.status, 200, record.document.versions[0].url);
      assert.match(response.headers.get("content-type") ?? "", /^image\//u);
    }
    await expect(current.getByText(demo.shared).first()).toBeVisible();
    log(`${demo.name}: Home rendered with the real pack, styles and ${catalog.records.length} managed assets`);

    await send(page, `remember: ${demo.name} memory marker.`);
    await lastReply(page).getByRole("button", { name: "Save to Memory" }).click();
    await expect(lastReply(page).getByText(/Saved as r\d+/)).toBeVisible();

    const before = await canonical(dir, demo);
    const owned = await ownedData(dir);
    // Neither the shared template nor Content delivered through Mapping is an editable page field.
    for (const text of [demo.shared, demo.owned]) {
      await send(page, `replace "${text}" with "Changed by AI"`);
      await expect(lastReply(page)).toContainText("couldn't find");
      await expect(page.getByText("No pending AI changes")).toBeVisible();
    }
    assert.deepEqual(await canonical(dir, demo), before, "a refused request must not write saved JSON/JSX");

    await send(page, `replace "${demo.find}" with "${demo.replace}"`);
    await expect(page.locator(".cms-assistant-review .cms-assistant-count").first()).toHaveText("1");
    assert.deepEqual(await canonical(dir, demo), before, "a proposal must not write saved JSON/JSX");
    await page.getByRole("button", { name: /^Draft/ }).click();
    const draft = frame(page, "Draft");
    await expect(draft.getByText(demo.replace).first()).toBeVisible({ timeout: 60_000 });
    await expect(draft.locator(".zc-review-badge")).toHaveText(["Changed 1/1"]);
    await expect.poll(() => highlighted(draft)).not.toEqual([]);
    await expect(page.locator("#assistant-apply-state")).toContainText("rendered successfully", { timeout: 30_000 });
    await page.getByRole("button", { name: "Current", exact: true }).click();
    await expect(frame(page, "Current").locator(".zc-review-badge")).toHaveText(["Will change 1/1"]);
    await expect.poll(() => highlighted(frame(page, "Current"), "zc-review-delete")).not.toEqual([]);
    log(`${demo.name}: draft proposed, Current/Draft annotated, saved files untouched`);

    await page.getByRole("button", { name: "Apply to Composer" }).click();
    await expect(page.getByRole("heading", { name: "Applied to Composer" })).toBeVisible({ timeout: 60_000 });
    const applied = await canonical(dir, demo);
    const changed = Object.keys(applied).filter(name => applied[name] !== before[name]);
    assert.ok(changed.some(name => name.endsWith(".composition.json")) && changed.some(name => name.endsWith(".tsx")), `Apply writes JSON and derived JSX (${changed.join(", ")})`);
    for (const name of changed) {
      assert.ok(applied[name]?.includes(demo.replace), `${name} carries the applied text`);
      assert.doesNotMatch(applied[name] ?? "", /zc-review|Will change|Changed 1\/1/u, `${name} must not contain review annotations`);
    }
    await page.reload();
    await expect(page.getByRole("heading", { name: "Applied to Composer" })).toBeVisible({ timeout: 60_000 });
    await expect(frame(page, "Current").getByText(demo.replace).first()).toBeVisible({ timeout: 60_000 });
    const composer = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await composer.goto(`http://127.0.0.1:${port}/composer?provider=files&composition=${changed.find(name => name.endsWith(".tsx"))?.replace(/^composition-|\.tsx$/gu, "")}`);
    const canvas = composer.frameLocator('iframe[title="Composer preview canvas"]');
    await expect(canvas.getByText(demo.replace).first()).toBeVisible({ timeout: 60_000 });
    await expect(canvas.locator(".zc-review-badge")).toHaveCount(0);
    await composer.close();
    assert.deepEqual(await ownedData(dir), owned, "Content and Mapping records are never written by an Assistant edit");
    log(`${demo.name}: Apply receipt, saved JSON/JSX, reload and plain Composer preview carry the change without annotations; Content and Mapping untouched`);
    assert.deepEqual(errors, []);
    await page.close();
    return { before, applied };
  } finally {
    await running.stop();
  }
}

/**
 * Restart: same data, conversation/Memory/applied change kept; then Undo restores the original.
 * @param {import('@playwright/test').Browser} browser
 * @param {{ dir: string, port: number, demo: Demo, before: Record<string, string>, others: readonly Demo[], log: (line: string) => void }} options
 */
export async function restartAndUndo(browser, { dir, port, demo, before, others, log }) {
  const running = await launchLocalHost(["--provider", "fake", "--dir", dir, "--port", String(port)]);
  try {
    assert.match(running.output(), new RegExp(`"${demo.host}" reused`));
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(running.url);
    await expect(frame(page, "Current").getByText(demo.replace).first()).toBeVisible({ timeout: 120_000 });
    await expect(page.locator('.cms-assistant-message[data-role="user"]').filter({ hasText: `replace "${demo.find}"` })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: /^Memory/ }).click();
    const memory = page.getByRole("dialog", { name: /Site Memory/ }).getByRole("textbox");
    await expect(memory).toHaveValue(new RegExp(`${demo.name} memory marker`));
    for (const other of others) assert.doesNotMatch(await memory.inputValue(), new RegExp(other.name), `${demo.name} Memory must not hold ${other.name}'s`);
    await page.getByRole("dialog", { name: /Site Memory/ }).getByRole("button", { name: "Close" }).click();
    log(`${demo.name}: restart kept the conversation, Memory and applied change; no other demo's state leaked in`);
    for (let attempt = 0; ; attempt++) {
      await page.getByRole("button", { name: "Undo apply" }).click();
      const outcome = await Promise.race([
        page.getByRole("heading", { name: "Undo committed" }).waitFor({ timeout: 60_000 }).then(() => "done"),
        page.locator(".cms-assistant-review [role=alert]").filter({ hasText: "Finish saving in every authoring tab" }).waitFor({ timeout: 60_000 }).then(() => "refused"),
      ]);
      if (outcome === "done") break;
      assert.ok(attempt < 2, "Undo kept being refused by browser coordination");
    }
    assert.deepEqual(withoutTimestamps(await canonical(dir, demo)), withoutTimestamps(before), "Undo restores the original saved JSON/JSX");
    log(`${demo.name}: Undo restored the original content`);
    await page.close();
  } finally {
    await running.stop();
  }
}
