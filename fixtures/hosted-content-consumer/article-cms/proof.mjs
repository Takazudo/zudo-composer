/* global window, document */
// Article CMS acceptance: a real browser drives the host admin over the loopback HTTP host and SQLite.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { articleRef } from "./article-data.mjs";
import { buildArticleUi, startArticleCms } from "./server.mjs";

const welcome = articleRef("welcome");
const identities = state => ({ draftRevision: state.draftRevision, baseline: state.baseline, definition: state.definition });
const publicImports = new Set(["zudo-composer/hosted-content", "zudo-composer/hosted-content/editor", "zudo-composer/hosted-content/editor.css", "../render.mjs", "./app.css"]);

export async function runArticleCmsProof({ directory } = {}) {
  const root = directory ? resolve(directory) : await mkdtemp(join(tmpdir(), "article-cms-"));
  const evidence = { node: process.version, checks: [] };
  const check = (name, condition) => { assert.ok(condition, name); evidence.checks.push(name); };
  let host = await startArticleCms({ directory: root }), browser;
  const api = async (path, payload) => {
    const response = await fetch(`${host.url}${path}`, payload === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const body = await response.json();
    if (!response.ok) throw Object.assign(new Error(body.message), { code: body.code, status: response.status, body });
    return body;
  };
  const q = value => encodeURIComponent(JSON.stringify(value));
  try {
    // 11–12. The admin is built from supported exports only, and its browser bytes carry no Node or private code.
    const source = await readFile(fileURLToPath(new URL("ui/app.mjs", import.meta.url)), "utf8");
    const specifiers = [...source.matchAll(/^import\s+(?:[^"']+from\s+)?["']([^"']+)["']/gm)].map(match => match[1]);
    check("admin imports only public tool entries and host files", specifiers.length > 0 && specifiers.every(specifier => publicImports.has(specifier)));
    const { files, metafile } = await buildArticleUi();
    const inputs = Object.keys(metafile.inputs);
    check("browser bundle has no Node built-ins", !inputs.some(input => input.startsWith("node:")) && !/\bfrom\s*["']node:|require\(["']node:/.test(files.get("/app.js")));
    check("browser bundle reaches the tool only through its emitted public entries", inputs.filter(input => /node_modules\/zudo-composer\//.test(input)).every(input => /node_modules\/zudo-composer\/server\/hosted-content\//.test(input)));

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${host.url}/`);
    const titleInput = page.getByRole("textbox", { name: "Title" });
    const phase = text => page.locator(".hosted-content-editor > p[role=status]").filter({ hasText: text }).waitFor();
    await page.locator('[data-entry-id="welcome"]').click();
    await titleInput.waitFor();
    check("host list reads presentation columns and editorial status", (await page.locator('[data-entry-id="welcome"] .article-status').textContent()) === "Published");
    check("custom title counter wraps the built-in control", (await page.getByRole("status", { name: "Title length" }).textContent()) === "22 / 80");

    // 1 and 8. Publish reviewed A, then save B: working reads B and published reads A.
    await titleInput.fill("Article A");
    await page.getByRole("status", { name: "Title length" }).filter({ hasText: "9 / 80" }).waitFor({ timeout: 5_000 });
    check("counter follows typing", true);
    await page.getByRole("button", { name: "Save", exact: true }).click(); await phase("Saved");
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await page.frameLocator("iframe.article-preview").locator("h2", { hasText: "Article A" }).waitFor();
    check("preview renders the saved snapshot", true);
    await page.getByRole("button", { name: "Submit", exact: true }).click();
    await page.locator('[data-stage="submission"]', { hasText: "integrated" }).waitFor();
    await page.getByRole("link", { name: "Open local artifact" }).waitFor();
    check("publication reports submission, activation, artifact and no deployment separately", (await page.locator('[data-stage="deployed"]').textContent()) === "No (local only)");
    const status = await api("/api/publication-status");
    const artifact = await (await fetch(`${host.url}/artifacts/${status.artifact}/`)).text();
    check("local artifact holds the reviewed A", artifact.includes("<h2>Article A</h2>"));
    // A clean editor adopts the newly activated baseline, as a host would after its own integration.
    await page.waitForFunction(() => window.articleCms.handle?.state.content?.integrationFence === 1);
    await titleInput.fill("Article B");
    await page.getByRole("button", { name: "Save", exact: true }).click(); await phase("Saved");
    await page.locator('[data-entry-id="welcome"] .article-status[data-status="changed"]').waitFor();
    check("working reads B", (await api(`/api/entry?q=${q({ perspective: "working", entry: welcome })}`)).values.title === "Article B");
    await page.getByRole("button", { name: "Published", exact: true }).click();
    await page.locator('[data-entry-id="welcome"] .article-title', { hasText: "Article A" }).waitFor();
    await page.locator('[data-entry-id="welcome"]').click();
    check("published view reads the activated A", (await page.locator('dd[data-field="title"]').textContent()) === "Article A");
    await page.getByRole("button", { name: "Working", exact: true }).click();
    await titleInput.waitFor();

    // 3. History returns exact revisions and useful field differences.
    const history = (await api(`/api/revisions?q=${q({ entry: welcome })}`)).revisions;
    const revisionA = history.find(revision => revision.values.title === "Article A");
    check("history lists initial, A and B newest first", history.map(revision => revision.values.title).join("|") === "Article B|Article A|Welcome to the journal");
    await page.getByRole("button", { name: `Compare revision ${revisionA.sequence} with working` }).click();
    const diffRow = page.locator('.article-diff tr[data-field="title"]');
    await diffRow.waitFor();
    check("diff names the changed field with both values", (await diffRow.textContent()) === "TitleArticle AArticle B");

    // 4. Restoring A from B creates C and keeps publication and history.
    await page.getByRole("button", { name: `Restore revision ${revisionA.sequence}` }).click();
    await page.locator(".article-notice", { hasText: "Restored revision" }).waitFor();
    await page.waitForFunction(() => document.querySelector('input[aria-label="Title"], [data-hosted-field="title"] input')?.value === "Article A");
    const restored = (await api(`/api/revisions?q=${q({ entry: welcome })}`)).revisions;
    check("restore appended C with restoredFrom and kept A and B", restored.length === history.length + 1 && restored[0].restoredFrom === revisionA.id && restored[0].operation.kind === "restore-revision");
    check("restore kept the published A and the activated baseline", (await api(`/api/entry?q=${q({ perspective: "published", entry: welcome })}`)).values.title === "Article A"
      && JSON.stringify((await api("/api/publication-status")).activated) === JSON.stringify(status.activated));

    // 5. A stale save fails without losing local work.
    await titleInput.fill("Local unsaved C");
    const remoteState = await api("/api/state");
    await api("/api/execute", { kind: "set-fields", operationKey: "remote-writer", expected: identities(remoteState), entry: welcome, values: { summary: "Changed by another editor." }, clear: [] });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await phase("Content changed");
    check("stale save is refused and the local value is retained", (await titleInput.inputValue()) === "Local unsaved C");
    await page.getByRole("button", { name: "Review current content" }).click();
    await page.getByRole("button", { name: "Reapply my changes" }).click();
    await page.getByRole("button", { name: "Save", exact: true }).click(); await phase("Saved");
    const reapplied = (await api(`/api/entry?q=${q({ perspective: "working", entry: welcome })}`)).values;
    check("explicit reapply saves the retained value over the newer record", reapplied.title === "Local unsaved C" && reapplied.summary === "Changed by another editor.");
    const staleRestore = await api("/api/execute", { kind: "restore-revision", operationKey: "stale-restore", expected: identities(remoteState), entry: welcome, revisionId: revisionA.id }).then(() => null, error => error);
    check("stale restore is refused over HTTP", staleRestore?.status === 409 && staleRestore.code === "revision-conflict");

    // 7. An incompatible historical value is reported as restore diagnostics.
    const notes = articleRef("release-notes");
    await api("/api/execute", { kind: "set-fields", operationKey: "shorten-notes", expected: identities(await api("/api/state")), entry: notes, values: { title: "Release notes" }, clear: [] });
    const original = (await api(`/api/revisions?q=${q({ entry: notes })}`)).revisions.at(-1);
    const beforeIncompatible = await api("/api/state");
    const incompatible = await api("/api/execute", { kind: "restore-revision", operationKey: "notes-restore", expected: identities(beforeIncompatible), entry: notes, revisionId: original.id }).then(() => null, error => error);
    check("incompatible restore answers diagnostics and writes nothing", incompatible?.status === 422 && incompatible.body.restoreDiagnostics?.[0]?.fieldId === "title"
      && incompatible.body.restoreDiagnostics[0].code === "invalid-value" && (await api("/api/state")).draftRevision === beforeIncompatible.draftRevision);

    // 9. The standard form edits the same records with the same command.
    await page.getByLabel("Standard form").check();
    await titleInput.waitFor();
    check("standard form has no host counter", await page.getByRole("status", { name: "Title length" }).count() === 0);
    await titleInput.fill("Standard edit");
    await page.getByRole("button", { name: "Save", exact: true }).click(); await phase("Saved");
    const latest = (await api(`/api/revisions?q=${q({ entry: welcome })}`)).revisions[0];
    check("standard and custom forms share records, commands and history", latest.values.title === "Standard edit" && latest.operation.kind === "set-fields" && latest.source === "article-admin");

    // 6. A retried request creates no duplicate revision.
    const retryState = await api("/api/state");
    const retry = { kind: "set-fields", operationKey: "retry-once", expected: identities(retryState), entry: welcome, values: { author: "Retry" }, clear: [] };
    const first = await api("/api/execute", retry), again = await api("/api/execute", retry);
    const afterRetry = (await api(`/api/revisions?q=${q({ entry: welcome })}`)).revisions;
    check("a retried request replays without a second revision", JSON.stringify(first) === JSON.stringify(again) && afterRetry.filter(revision => revision.operation.key === "retry-once").length === 1);

    // 2. A restart preserves working, published and history.
    const beforeRestart = await api(`/api/revisions?q=${q({ entry: welcome, limit: 100 })}`);
    await page.close(); await host.close();
    host = await startArticleCms({ directory: root });
    check("restart keeps history, working and published", JSON.stringify(await api(`/api/revisions?q=${q({ entry: welcome, limit: 100 })}`)) === JSON.stringify(beforeRestart)
      && (await api(`/api/entry?q=${q({ perspective: "working", entry: welcome })}`)).values.title === "Standard edit"
      && (await api(`/api/entry?q=${q({ perspective: "published", entry: welcome })}`)).values.title === "Article A");
    check("no page errors", errors.length === 0);
    evidence.revisions = beforeRestart.revisions.length;
    return evidence;
  } catch (error) {
    const page = browser?.contexts()[0]?.pages()[0];
    if (page) console.error(`page text:\n${await page.locator("body").innerText().catch(() => "")}`);
    throw error;
  } finally {
    await browser?.close();
    await host.close();
    if (!directory) await rm(root, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const evidence = await runArticleCmsProof({ directory: process.argv[2] });
  console.log(JSON.stringify({ proof: "article-cms", checks: evidence.checks.length, revisions: evidence.revisions, node: evidence.node }, null, 2));
  for (const name of evidence.checks) console.log(`PASS ${name}`);
}
