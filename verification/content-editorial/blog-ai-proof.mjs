/* global console, process */
// Browser proof: bounded Content-AI on a Blog Article, in the host's own
// Content editor, with the deterministic fake provider. Prepare writes
// nothing; Apply and Undo each append one revision; a refusal is shown as
// such; a human edit after Prepare makes the stale Apply refuse without writing.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, expect } from "@playwright/test";
import { startBlogHost } from "./blog-host.mjs";

const port = Number(process.env.BLOG_AI_PORT ?? 4179);
const checks = [];
const check = (name) => { checks.push(name); console.log(`ok ${checks.length} - ${name}`); };
const host = await startBlogHost({ port, assistant: { provider: "fake", permission: "apply" } });
const root = join(host.host, "cms/content/workspace-v1-initial");
const revisionsOnDisk = async () => {
  const pointer = JSON.parse(await readFile(join(root, "current.json"), "utf8"));
  const directory = join(root, "generations", String(pointer.generation));
  const files = await readdir(directory);
  const revisions = await Promise.all(files.filter((name) => name.startsWith("revision-")).map(async (name) => JSON.parse(await readFile(join(directory, name), "utf8"))));
  return { revisions: revisions.sort((a, b) => a.sequence - b.sequence), receipts: files.filter((name) => name.startsWith("receipt-")).length };
};
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } });
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));
  await page.goto(`${host.origin}/content`);
  const tree = page.getByRole("tree", { name: "Content" });
  await tree.waitFor({ timeout: 120_000 });
  await tree.getByRole("treeitem", { name: /^Articles/ }).click();
  await page.getByRole("treeitem", { name: /The quiet hour/ }).dblclick();
  const title = page.getByRole("textbox", { name: "Title", exact: true });
  await expect(title).toHaveValue("The quiet hour", { timeout: 30_000 });
  const panel = page.getByRole("region", { name: "AI proposal" });
  await expect(panel).toContainText("Edits only Title and Body", { timeout: 30_000 });
  const history = page.getByRole("region", { name: "History" });
  const items = history.getByRole("listitem");
  check("the Article editor offers AI help scoped to Title and Body");

  const instruction = panel.getByRole("textbox", { name: "Instruction" });
  await instruction.fill("A gentler opening");
  await panel.getByRole("button", { name: "Prepare proposal" }).click();
  await expect(panel.getByRole("status")).toContainText("Proposal ready — not applied.", { timeout: 30_000 });
  const changes = panel.getByRole("table", { name: "Proposed changes" });
  await expect(changes.getByRole("row", { name: /^Title/ })).toContainText("The quiet hour — A gentler opening");
  await expect(changes.getByRole("row", { name: /^Body/ })).toContainText("A gentler opening");
  await expect(panel.getByRole("group", { name: "Candidate preview" })).toContainText("The quiet hour — A gentler opening");
  await expect(title).toHaveValue("The quiet hour");
  await expect(history.getByRole("status")).toHaveText("No revisions yet. History begins with the first save.");
  if ((await revisionsOnDisk()).revisions.length !== 0) throw new Error("Prepare wrote a revision.");
  check("Prepare shows field differences and the exact candidate, and writes nothing");

  await panel.getByRole("button", { name: "Apply proposal" }).click();
  await expect(panel.getByRole("status")).toContainText("Applied as a new revision.", { timeout: 30_000 });
  await expect(title).toHaveValue("The quiet hour — A gentler opening");
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText("#2 · Edited · AI proposal");
  await expect(items.nth(1)).toContainText("#1 · Values before history began · Existing content");
  check("Apply appends one revision with AI provenance");

  await panel.getByRole("button", { name: "Undo AI change" }).click();
  await expect(panel.getByRole("status")).toContainText("Undone", { timeout: 30_000 });
  await expect(title).toHaveValue("The quiet hour");
  await expect(items).toHaveCount(3);
  await expect(items.nth(0)).toContainText("#3 · Restored · AI proposal");
  check("Undo restores the previous values as a new revision");

  await instruction.fill("Please refuse this one");
  await panel.getByRole("button", { name: "Prepare proposal" }).click();
  await expect(panel.getByRole("alert")).toContainText("Declined:", { timeout: 30_000 });
  await expect(items).toHaveCount(3);
  check("a provider refusal is shown as a refusal and writes nothing");

  await instruction.fill("Shorter");
  await panel.getByRole("button", { name: "Prepare proposal" }).click();
  await expect(panel.getByRole("status")).toContainText("Proposal ready — not applied.", { timeout: 30_000 });
  await title.fill("A human edit");
  await expect(items).toHaveCount(4, { timeout: 30_000 });
  await expect(items.nth(0)).toContainText("#4 · Saved · Content editor");
  await panel.getByRole("button", { name: "Apply proposal" }).click();
  await expect(panel.getByRole("alert")).toBeVisible({ timeout: 30_000 });
  await expect(title).toHaveValue("A human edit");
  await expect(items).toHaveCount(4);
  check("a human edit after Prepare makes the stale Apply refuse without writing");

  const { revisions, receipts } = await revisionsOnDisk();
  const shape = revisions.map((revision) => [revision.sequence, revision.operation.kind, revision.source, revision.actor?.id ?? null, revision.values["articles-title"]]);
  const expected = [
    [1, "initial", "existing-content", null, "The quiet hour"],
    [2, "set-fields", "content-ai", "local-owner", "The quiet hour — A gentler opening"],
    [3, "restore-revision", "content-ai", "local-owner", "The quiet hour"],
    [4, "save", "content-editor", "local-owner", "A human edit"],
  ];
  if (JSON.stringify(shape) !== JSON.stringify(expected)) throw new Error(`Unexpected history on disk: ${JSON.stringify(shape)}`);
  if (receipts !== 2) throw new Error(`Expected the Apply and Undo receipts, found ${receipts}.`);
  check("the host's own Content files hold exactly the four revisions and two AI receipts");
  if (failures.length) throw new Error(`Page errors: ${failures.join("; ")}`);
  check("no page errors");
  console.log(`Blog Content-AI proof: ${checks.length}/${checks.length} checks passed`);
} catch (error) {
  console.error(host.output().slice(-4000));
  throw error;
} finally {
  await browser.close();
  await host.stop();
}
