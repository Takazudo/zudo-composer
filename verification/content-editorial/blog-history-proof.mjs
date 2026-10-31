/* global console, process */
// Browser proof: an ordinary Article workflow in the Blog host's own Content
// editor, against a disposable copy of the host served by `zudo-composer dev`.
// Edit, history, compare, restore, reload; then the bytes on disk.
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, expect } from "@playwright/test";
import { startBlogHost } from "./blog-host.mjs";

const port = Number(process.env.BLOG_HISTORY_PORT ?? 4179);
// When set, a failure leaves a screenshot, a Playwright trace and the dev-server log here.
const artifacts = process.env.BLOG_PROOF_ARTIFACTS;
if (artifacts) await mkdir(artifacts, { recursive: true });
const checks = [];
const check = (name) => { checks.push(name); console.log(`ok ${checks.length} - ${name}`); };
const host = await startBlogHost({ port });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
if (artifacts) await context.tracing.start({ screenshots: true, snapshots: true });
const page = await context.newPage();
let failed = false;
try {
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));
  await page.goto(`${host.origin}/content`);
  const tree = page.getByRole("tree", { name: "Content" });
  await tree.waitFor({ timeout: 120_000 });
  await tree.getByRole("treeitem", { name: /^Articles/ }).click();
  await page.getByRole("treeitem", { name: /The quiet hour/ }).dblclick();
  const title = page.getByRole("textbox", { name: "Title", exact: true });
  await expect(title).toHaveValue("The quiet hour", { timeout: 30_000 });
  const history = page.getByRole("region", { name: "History" });
  await expect(history.getByRole("status")).toHaveText("No revisions yet. History begins with the first save.");
  check("an existing Blog Article opens with no history and nothing rewritten");

  await title.fill("The quiet hour, revisited");
  const items = history.getByRole("listitem");
  await expect(items).toHaveCount(2, { timeout: 30_000 });
  await expect(items.nth(0)).toContainText("#2 · Saved · Content editor");
  await expect(items.nth(1)).toContainText("#1 · Values before history began · Existing content");
  check("the first save records the existing values, then the edit");

  await items.nth(1).getByRole("button", { name: "Compare #1 with current" }).click();
  const diff = items.nth(1).getByRole("table");
  await expect(diff.getByRole("row", { name: /Title/ })).toContainText("The quiet hourThe quiet hour, revisited");
  check("compare shows the field difference against the working values");

  await items.nth(1).getByRole("button", { name: "Restore #1" }).click();
  await expect(history.getByRole("status")).toHaveText("Restored revision 1 as a new revision.", { timeout: 30_000 });
  await expect(title).toHaveValue("The quiet hour");
  await expect(items).toHaveCount(3);
  await expect(items.nth(0)).toContainText("#3 · Restored · Content editor");
  await expect(items.nth(0).getByRole("button", { name: "Restore #3" })).toBeDisabled();
  check("restore appends a new revision and the editor shows the restored values");

  await page.reload();
  await page.getByRole("tree", { name: "Content" }).waitFor({ timeout: 120_000 });
  await page.getByRole("tree", { name: "Content" }).getByRole("treeitem", { name: /^Articles/ }).click();
  await page.getByRole("treeitem", { name: /The quiet hour/ }).dblclick();
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("The quiet hour", { timeout: 30_000 });
  await expect(page.getByRole("region", { name: "History" }).getByRole("listitem")).toHaveCount(3);
  check("values and history persist across a reload");

  const root = join(host.host, "cms/content/workspace-v1-initial");
  const pointer = JSON.parse(await readFile(join(root, "current.json"), "utf8"));
  const files = await readdir(join(root, "generations", String(pointer.generation)));
  const revisions = await Promise.all(files.filter((name) => name.startsWith("revision-")).map(async (name) => JSON.parse(await readFile(join(root, "generations", String(pointer.generation), name), "utf8"))));
  revisions.sort((a, b) => a.sequence - b.sequence);
  if (JSON.stringify(revisions.map((revision) => [revision.sequence, revision.operation.kind, revision.source, revision.actor?.id ?? null, revision.values["articles-title"]]))
    !== JSON.stringify([[1, "initial", "existing-content", null, "The quiet hour"], [2, "save", "content-editor", "local-owner", "The quiet hour, revisited"], [3, "restore-revision", "content-editor", "local-owner", "The quiet hour"]])) {
    throw new Error(`Unexpected history on disk: ${JSON.stringify(revisions)}`);
  }
  if (revisions[2].restoredFrom !== revisions[0].id) throw new Error("The restore does not name its source revision.");
  const receipts = files.filter((name) => name.startsWith("receipt-"));
  if (receipts.length !== 1) throw new Error(`Expected one receipt, found ${receipts.length}.`);
  check("the host's own Content files hold the three revisions and the restore receipt");
  if (failures.length) throw new Error(`Page errors: ${failures.join("; ")}`);
  check("no page errors");
  console.log(`Blog Content history proof: ${checks.length}/${checks.length} checks passed`);
} catch (error) {
  failed = true;
  console.error(host.output().slice(-4000));
  if (artifacts) {
    await page.screenshot({ path: join(artifacts, "content-history-failure.png"), fullPage: true }).catch(() => {});
    await writeFile(join(artifacts, "content-history-server.log"), host.output());
  }
  throw error;
} finally {
  if (artifacts) await context.tracing.stop(failed ? { path: join(artifacts, "content-history-trace.zip") } : {}).catch(() => {});
  await browser.close();
  await host.stop();
}
