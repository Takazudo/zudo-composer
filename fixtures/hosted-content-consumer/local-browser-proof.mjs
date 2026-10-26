/* global window */
// Browser proof of the persistent local host: a person saves, previews the exact saved snapshot,
// generates a local artifact and opens it, then finds everything again after a host restart.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { assertRendererPrepared, startHost } from "./local-proof.mjs";

// Prefer the machine's preinstalled Playwright (its browsers are installed); fall back to the workspace copy.
async function loadChromium() {
  try { return createRequire(import.meta.url)("playwright").chromium; }
  catch { return (await import("@playwright/test")).chromium; }
}

export async function runLocalBrowserProof({ directory } = {}) {
  await assertRendererPrepared();
  const root = directory ? resolve(directory) : await mkdtemp(join(tmpdir(), "composer-local-browser-"));
  const dataDir = join(root, "data");
  const title = "ブラウザーで保存したローカル講座";
  let host = startHost(dataDir);
  let browser;
  try {
    let { url } = await host.ready;
    browser = await (await loadChromium()).launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${url}/`);
    await page.getByRole("note").filter({ hasText: "Local only." }).waitFor();
    const field = page.getByRole("textbox", { name: "講座名" });
    await field.waitFor();
    await field.fill(title);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.waitForFunction(() => window.localHosted?.handle.state.phase === "saved");

    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await page.waitForFunction(() => !!window.localHosted.handle.state.reviewedSnapshot);
    const reviewed = await page.evaluate(() => ({ snapshot: window.localHosted.handle.state.reviewedSnapshot, preview: window.localHosted.preview.state }));
    assert.equal(reviewed.preview.status, "rendered", "The preview frame acknowledged a real render");
    assert.equal(reviewed.preview.result.snapshotId, reviewed.snapshot.id, "Preview acknowledgement names the exact saved snapshot");
    assert.equal(reviewed.preview.result.snapshotDigest, reviewed.snapshot.digest, "Preview acknowledgement names the exact snapshot digest");
    assert.equal(await page.frameLocator("#preview").locator("h1").textContent(), title, "Preview shows the saved title");
    assert.match(await page.locator("#preview-identity").textContent(), new RegExp(reviewed.snapshot.id), "Page names the previewed snapshot");

    await page.getByRole("button", { name: "Generate local artifact", exact: true }).click();
    const link = page.locator("#artifact-list a[data-local-artifact]").first();
    await link.waitFor({ timeout: 15_000 });
    const item = page.locator(`#artifact-list li[data-status="integrated"]`).first();
    await item.waitFor({ timeout: 15_000 });
    assert.match(await item.textContent(), /Local artifact ready/, "Status is labeled as a local artifact");
    const bodyText = await page.locator("body").innerText();
    const statusText = `${await page.locator("#artifact-list").innerText()} ${await page.locator(".hosted-content-editor__publication").innerText()}`;
    assert.match(statusText, /local artifact/i, "Publication status names a local artifact");
    assert.doesNotMatch(statusText, /deployed|live|production|published/i, "Publication status never claims a live or production result");
    assert.match(bodyText, /Nothing here is live, deployed or in production/, "The page states it is local only");

    const artifactUrl = await link.getAttribute("href");
    const publicationId = await link.getAttribute("data-local-artifact");
    const [artifactPage] = await Promise.all([context.waitForEvent("page"), link.click()]);
    await artifactPage.waitForLoadState("load");
    assert.match(artifactPage.url(), /^http:\/\/127\.0\.0\.1:\d+\/$/, "The artifact opens at the root of its own local URL");
    assert.notEqual(new URL(artifactPage.url()).origin, new URL(url).origin, "The artifact is served apart from the editor");
    assert.equal(await artifactPage.locator("h1").textContent(), title, "The opened artifact shows the saved title");
    assert.equal(await artifactPage.locator('[data-host-component="host:OfferPage"]').count(), 1, "The artifact is the real host component output");
    const { manifest } = await (await fetch(`${url}/api/local/artifact?id=${publicationId}`)).json();
    assert.deepEqual([manifest.snapshotId, manifest.snapshotDigest], [reviewed.snapshot.id, reviewed.snapshot.digest], "The artifact was generated from the exact previewed snapshot");
    await artifactPage.locator("img").evaluate(image => image.decode());
    assert.ok(await artifactPage.locator("img").evaluate(image => image.naturalWidth > 0), "The artifact's approved image decodes");
    assert.deepEqual(errors, [], "No page errors");
    await context.close();

    // Restart the host process on the same directory: a new browser context finds the same work.
    await host.stop();
    host = startHost(dataDir);
    ({ url } = await host.ready);
    const reopened = await browser.newContext();
    const again = await reopened.newPage();
    again.on("pageerror", error => errors.push(error.message));
    await again.goto(`${url}/`);
    const restored = again.getByRole("textbox", { name: "講座名" });
    await restored.waitFor();
    assert.equal(await restored.inputValue(), title, "Saved content survives a host restart");
    await again.locator(`#artifact-list a[href="${artifactUrl}"]`).waitFor();
    const reopenedArtifact = await reopened.newPage();
    await reopenedArtifact.goto(`${url}${artifactUrl}`);
    assert.match(reopenedArtifact.url(), /^http:\/\/127\.0\.0\.1:\d+\/$/, "The local artifact URL still opens after restart");
    assert.equal(await reopenedArtifact.locator("h1").textContent(), title, "The local artifact survives a host restart");
    assert.deepEqual(errors, [], "No page errors after restart");
    return { snapshotId: reviewed.snapshot.id, digest: reviewed.snapshot.digest, artifactUrl, restarted: true };
  } finally {
    await browser?.close();
    await host.stop();
    if (!directory) await rm(root, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify({ proof: "persistent-local-host-browser", ...await runLocalBrowserProof({ directory: process.argv[2] }) }, null, 2));
}
