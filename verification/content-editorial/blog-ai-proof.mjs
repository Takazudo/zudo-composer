/* global console, process, Buffer */
// Browser proof: bounded Content-AI on a Blog Article, in the host's own
// Content editor, with the deterministic fake provider. A proposal's candidate
// is rendered by the Blog's own components, Mapping and styles before Apply is
// available; no render other than the current candidate's can approve it.
// Apply and Undo each append one revision, and a lost acknowledgement followed
// by a dev-server restart is recovered from the stored receipts without a
// duplicate. Fake replies are not model evidence.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, expect } from "@playwright/test";
import { startBlogHost } from "./blog-host.mjs";

const port = Number(process.env.BLOG_AI_PORT ?? 4179);
const artifacts = process.env.BLOG_PROOF_ARTIFACTS;
const checks = [];
const check = (name) => { checks.push(name); console.log(`ok ${checks.length} - ${name}`); };
const host = await startBlogHost({ port, assistant: { provider: "fake", permission: "apply" } });
const root = join(host.host, "cms/content/workspace-v1-initial");
const revisionsOnDisk = async () => {
  const pointer = JSON.parse(await readFile(join(root, "current.json"), "utf8"));
  const directory = join(root, "generations", String(pointer.generation));
  const files = await readdir(directory);
  const revisions = await Promise.all(files.filter((name) => name.startsWith("revision-")).map(async (name) => JSON.parse(await readFile(join(directory, name), "utf8"))));
  const entry = JSON.parse(await readFile(join(directory, "entry-article-the-quiet-hour.json"), "utf8"));
  return { revisions: revisions.sort((a, b) => a.sequence - b.sequence), receipts: files.filter((name) => name.startsWith("receipt-")).length, entry };
};
const proposalsOnDisk = async () => (await readdir(join(host.host, "cms/content-ai")).catch(() => [])).filter((name) => name.startsWith("proposal-")).length;

// A 1×1 PNG served for the candidate figure, released only when the proof says so.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
let release = () => {};
let gate = Promise.resolve();
const hold = () => { gate = new Promise((done) => { release = done; }); };

// The request reaches the server and commits; only its response is lost on the way back.
const commitThenDrop = async (route) => {
  const response = await route.fetch({ headers: { ...await route.request().allHeaders(), origin: host.origin, "sec-fetch-site": "same-origin" } });
  const body = await response.json();
  if (!body.ok) throw new Error(`The dropped request did not commit: ${JSON.stringify(body)}`);
  await route.abort("connectionreset");
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1400, height: 1600 } });
// The dev server's live-reload socket is relayed, but its closing is not: restarting the server does not reload the page by itself.
await context.routeWebSocket(/.*/, (socket) => { socket.connectToServer().onClose(() => {}); });
await context.route("**/zc-slow-figure.png", async (route) => { await gate; await route.fulfill({ status: 200, contentType: "image/png", body: PNG }); });
await context.route("**/zc-missing-figure.png", (route) => route.fulfill({ status: 404, body: "" }));
if (artifacts) await context.tracing.start({ screenshots: true, snapshots: true });
const page = await context.newPage();
const failures = [];
// Errors from loads cut off by the simulated crash, or while the restarted server settles its
// dependency graph, are not part of the journey; every other page error fails the proof.
let settling = false;
page.on("pageerror", (error) => { if (!settling) failures.push(`after check ${checks.length}: ${error.message}`); });
try {
  const open = async (name) => {
    const tree = page.getByRole("tree", { name: "Content" });
    await tree.waitFor({ timeout: 120_000 });
    const article = page.getByRole("treeitem", { name });
    if (!(await article.isVisible())) await tree.getByRole("treeitem", { name: /^Articles/ }).click();
    await article.dblclick();
  };
  // A freshly started dev server may still be discovering the preview frame's dependencies; let it settle first.
  const restart = async () => { settling = true; await host.restart(); };
  const visit = async () => {
    settling = true;
    await page.goto(`${host.origin}/composer/preview`, { waitUntil: "networkidle" });
    settling = false;
    await page.goto(`${host.origin}/content`, { waitUntil: "networkidle" });
  };
  await visit();
  await open(/The quiet hour/);
  const title = page.getByRole("textbox", { name: "Title", exact: true });
  await expect(title).toHaveValue("The quiet hour", { timeout: 30_000 });
  const panel = page.getByRole("region", { name: "AI proposal" });
  await expect(panel).toContainText("Edits only Title and Body", { timeout: 30_000 });
  const history = page.getByRole("region", { name: "History" });
  const items = history.getByRole("listitem");
  const status = panel.getByRole("status");
  const apply = panel.getByRole("button", { name: "Apply proposal" });
  const instruction = panel.getByRole("textbox", { name: "Instruction" });
  const rendered = panel.getByRole("group", { name: "Rendered candidate" }).frameLocator("iframe");
  const prepare = async (text, expected = /Ready for review|Rendering the candidate/) => {
    await instruction.fill(text);
    await panel.getByRole("button", { name: /Prepare (proposal|again)/ }).click();
    await expect(status).toContainText(expected, { timeout: 30_000 });
    return panel.locator("[data-proposal-id]").getAttribute("data-proposal-id");
  };
  const stillDisabled = async (pattern) => {
    // Held for longer than any render takes: the gate, not timing, decides.
    for (let i = 0; i < 6; i++) { await expect(apply).toBeDisabled(); await expect(status).toContainText(pattern); await page.waitForTimeout(250); }
  };
  check("the Article editor offers AI help scoped to Title and Body");

  await title.fill("The quiet hour, saved");
  await expect(items).toHaveCount(2, { timeout: 30_000 });
  await expect(items.nth(0)).toContainText("#2 · Saved · Content editor");
  check("A is the published Article and B is a saved human revision");

  const first = await prepare("Plain first", /Ready for review/);
  hold();
  const second = await prepare("![Slow figure](/zc-slow-figure.png)", /Rendering the candidate/);
  if (!first || !second || first === second) throw new Error("Expected two distinct proposals.");
  await stillDisabled(/Rendering the candidate/);
  check("an earlier proposal's completed render cannot approve a new proposal while it renders");
  release();
  await expect(status).toContainText("Ready for review", { timeout: 30_000 });
  await expect(apply).toBeEnabled();
  await expect(rendered.getByRole("img", { name: "Slow figure" })).toBeVisible();
  check("Apply stays disabled during a delayed render and becomes available only once that candidate has rendered");

  await prepare("![Broken figure](/zc-missing-figure.png)", /Render failed|Rendering the candidate/);
  await expect(status).toContainText("Render failed", { timeout: 30_000 });
  await expect(apply).toBeDisabled();
  check("a failed render leaves Apply unavailable");

  hold();
  await prepare("![Slow figure](/zc-slow-figure.png)", /Rendering the candidate/);
  await open(/Reading slowly on purpose/);
  await expect(title).toHaveValue("Reading slowly on purpose", { timeout: 30_000 });
  await open(/The quiet hour/);
  await expect(title).toHaveValue("The quiet hour, saved", { timeout: 30_000 });
  await stillDisabled(/Rendering the candidate/);
  release();
  await expect(status).toContainText("Ready for review", { timeout: 30_000 });
  check("changing the selection during a render discards it; the candidate renders again before Apply");

  hold();
  await prepare("![Slow figure](/zc-slow-figure.png)", /Rendering the candidate/);
  await title.fill("The quiet hour, edited during render");
  await expect(status).toContainText("Stale", { timeout: 30_000 });
  release();
  await stillDisabled(/Stale/);
  await expect(panel.getByRole("button", { name: "Prepare again" })).toBeVisible();
  await expect(items).toHaveCount(3, { timeout: 30_000 });
  check("a local edit during a render makes the proposal stale; the late render approves nothing and re-prepare is offered");

  const before = await revisionsOnDisk();
  const proposalId = await prepare("A gentler opening", /Ready for review/);
  await expect(rendered.getByRole("heading", { name: "Revision note" })).toBeVisible();
  await expect(rendered.getByText("The quiet hour, edited during render — A gentler opening").first()).toBeVisible();
  const changes = panel.getByRole("table", { name: "Proposed changes" });
  await expect(changes.getByRole("row", { name: /^Title/ })).toContainText("The quiet hour, edited during render — A gentler opening");
  const reviewedBody = await panel.locator("[data-candidate-field] pre").nth(1).textContent();
  if (!reviewedBody?.includes("## Revision note")) throw new Error("The raw candidate text is not shown.");
  const after = await revisionsOnDisk();
  if (after.revisions.length !== before.revisions.length || JSON.stringify(after.entry.values) !== JSON.stringify(before.entry.values)) throw new Error("Preparing or rendering wrote Content.");
  await expect(title).toHaveValue("The quiet hour, edited during render");
  check("C's Markdown renders as a visible heading through the Blog's own components, beside the diff and raw text, and nothing is written");
  if (artifacts) await page.screenshot({ path: join(artifacts, "content-ai-ready.png"), fullPage: true });

  // Step 5–7: the Apply commits but its acknowledgement is lost, then the server restarts.
  await page.route("**/__zudo_composer_content_provider", async (route) => {
    if (route.request().headers()["x-zudo-composer-operation"] !== "content-ai-apply") return route.fallback();
    await commitThenDrop(route);
  });
  await apply.click();
  await expect(panel.getByRole("alert")).toBeVisible({ timeout: 30_000 });
  await page.unroute("**/__zudo_composer_content_provider");
  const committed = await revisionsOnDisk();
  if (committed.revisions.length !== before.revisions.length + 1) throw new Error("The lost-acknowledgement Apply did not commit exactly once.");
  await restart();
  check("an Apply whose acknowledgement was lost committed once before the restart");

  await visit();
  await open(/The quiet hour/);
  await expect(title).toHaveValue("The quiet hour, edited during render — A gentler opening", { timeout: 60_000 });
  await expect(status).toContainText("recovered the committed Apply", { timeout: 30_000 });
  if (await panel.locator("[data-proposal-id]").getAttribute("data-proposal-id") !== proposalId) throw new Error("The reload restored another proposal.");
  const recovered = await revisionsOnDisk();
  if (recovered.revisions.length !== committed.revisions.length) throw new Error("Recovery wrote another revision.");
  const head = recovered.revisions.at(-1);
  if (head.source !== "content-ai" || head.values["articles-body"] !== reviewedBody) throw new Error("The applied values differ from the reviewed candidate.");
  await expect(items.nth(0)).toContainText("· Edited · AI proposal");
  check("after restart and reload the browser shows the committed Apply, applied values equal the reviewed values, and no revision was added");

  // Step 9–10: Undo, lose its acknowledgement, retry, then restart. A restarted dev server issues a new
  // request capability, so an open page reloads before it can reach it (Vite reloads it by itself).
  await page.route("**/__zudo_composer_content_provider", async (route) => {
    if (route.request().headers()["x-zudo-composer-operation"] !== "content-ai-undo") return route.fallback();
    await commitThenDrop(route);
  });
  await panel.getByRole("button", { name: "Undo AI change" }).click();
  await expect(panel.getByRole("alert")).toBeVisible({ timeout: 30_000 });
  await page.unroute("**/__zudo_composer_content_provider");
  const undone = await revisionsOnDisk();
  if (undone.revisions.length !== recovered.revisions.length + 1) throw new Error("The lost-acknowledgement Undo did not commit exactly once.");
  await panel.getByRole("button", { name: "Undo AI change" }).click();
  await expect(status).toContainText("recovered the committed Undo", { timeout: 60_000 });
  await expect(title).toHaveValue("The quiet hour, edited during render", { timeout: 30_000 });
  if ((await revisionsOnDisk()).revisions.length !== undone.revisions.length) throw new Error("The retried Undo wrote another revision.");
  check("an Undo whose acknowledgement was lost is recovered by the retry under the same key, without a duplicate");

  await restart();
  await visit();
  await open(/The quiet hour/);
  await expect(status).toContainText("recovered the committed Undo", { timeout: 60_000 });
  await expect(title).toHaveValue("The quiet hour, edited during render", { timeout: 30_000 });
  if ((await revisionsOnDisk()).revisions.length !== undone.revisions.length) throw new Error("Reading the Undo after a restart wrote a revision.");
  check("after a restart and reload the undone proposal is read back from the receipts, with no model call and no write");

  hold();
  await prepare("![Slow figure](/zc-slow-figure.png)", /Rendering the candidate/);
  release();
  await expect(status).toContainText("Ready for review", { timeout: 30_000 });
  hold();
  await page.reload();
  await open(/The quiet hour/);
  await expect(status).toContainText("Rendering the candidate", { timeout: 60_000 });
  await stillDisabled(/Rendering the candidate/);
  release();
  await expect(status).toContainText("Ready for review", { timeout: 30_000 });
  await panel.getByRole("button", { name: "Discard" }).click();
  check("after a reload an unapplied proposal needs a fresh render before Apply");

  await prepare("Please refuse this one", /./).catch(() => {});
  await expect(panel.getByRole("alert")).toContainText("Declined:", { timeout: 30_000 });
  check("a provider refusal is shown as a refusal and writes nothing");

  const { revisions, receipts } = await revisionsOnDisk();
  const shape = revisions.map((revision) => [revision.operation.kind, revision.source]);
  const expected = [["initial", "existing-content"], ["save", "content-editor"], ["save", "content-editor"], ["set-fields", "content-ai"], ["restore-revision", "content-ai"]];
  if (JSON.stringify(shape) !== JSON.stringify(expected)) throw new Error(`Unexpected history on disk: ${JSON.stringify(shape)}`);
  if (receipts !== 2) throw new Error(`Expected the Apply and Undo receipts, found ${receipts}.`);
  if (await proposalsOnDisk() < 7) throw new Error("Prepared proposals were not stored durably.");
  check("the host's own Content files hold exactly the expected revisions, two AI receipts, and every prepared proposal");
  if (failures.length) throw new Error(`Page errors: ${failures.join("; ")}`);
  check("no page errors");
  console.log(`Blog Content-AI proof: ${checks.length}/${checks.length} checks passed`);
} catch (error) {
  console.error(host.output().slice(-4000));
  if (artifacts) await page.screenshot({ path: join(artifacts, "content-ai-failure.png"), fullPage: true }).catch(() => {});
  throw error;
} finally {
  if (artifacts) await context.tracing.stop({ path: join(artifacts, "content-ai-trace.zip") }).catch(() => {});
  await browser.close();
  await host.stop();
}
