import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join, extname, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { startHostedFixtureServer } from "./server.mjs";
import { createFixtureSeed, createFixturePolicy, fixtureEntry } from "./fixture-data.mjs";
import { projectHostedContent } from "./renderer/src/project.ts";
import { prepareRenderProof, buildRenderer, rendererRoot, run } from "./render-proof.mjs";
const root = dirname(fileURLToPath(import.meta.url));
const pack = { packId: "host-offer", packVersion: "1.0.0" };
const renderer = { rendererId: "host:zudo-react", rendererVersion: "1" };
const fixture = { database: createFixtureSeed(), policy: createFixturePolicy(), project: projectHostedContent,
  presentation: { selection: { entry: fixtureEntry, fieldId: "title" }, routeId: "home", previewUrl: "/preview.html", pack, renderer } };
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json" };
export async function startBrowserFixture(filename) {
  let upstream = await startHostedFixtureServer({ filename, fixture });
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      if (url.pathname.startsWith("/api/")) {
        if (url.pathname === "/api/restart" && request.method === "POST") {
          for await (const _ of request) { /* consume */ }
          await upstream.close();
          upstream = await startHostedFixtureServer({ filename, fixture });
          response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ reopened: true }));
          return;
        }
        const chunks = []; for await (const chunk of request) chunks.push(chunk);
        const result = await fetch(new URL(request.url, upstream.url), { method: request.method,
          headers: { "content-type": "application/json" }, body: chunks.length ? Buffer.concat(chunks) : undefined });
        response.writeHead(result.status, { "content-type": "application/json", "cache-control": "no-store" }).end(await result.text());
        return;
      }
      const pathname = decodeURIComponent(url.pathname);
      const relative = pathname.endsWith("/") ? `${pathname}index.html` : pathname;
      const path = resolve(rendererRoot, "dist", `.${relative}`);
      if (!path.startsWith(resolve(rendererRoot, "dist") + sep)) throw Error("Outside fixture root");
      const bytes = await readFile(path);
      response.writeHead(200, { "content-type": mime[extname(path)] ?? "application/octet-stream", "cache-control": "no-store" }).end(bytes);
    } catch (error) { response.writeHead(404).end(String(error)); }
  });
  await new Promise((ready, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", ready); });
  return { url: `http://127.0.0.1:${server.address().port}`,
    async close() { await new Promise((ready, reject) => server.close(error => error ? reject(error) : ready())); await upstream.close(); } };
}
export async function proveBrowserCheckpoint(filename) {
  await prepareRenderProof(filename);
  await buildRenderer();
  await build({ entryPoints: [join(root, "browser-checkpoint.ts")], outfile: join(rendererRoot, "dist/browser-checkpoint.js"),
    bundle: true, format: "esm", platform: "browser", jsx: "automatic", jsxImportSource: "preact", target: "es2022", metafile: true });
  let html = await readFile(join(root, "browser-checkpoint.html"), "utf8");
  html = html.replace("</head>", '<link rel="stylesheet" href="/browser-checkpoint.css"></head>');
  await writeFile(join(rendererRoot, "dist/browser-checkpoint.html"), html);
  const running = await startBrowserFixture(filename);
  const browser = await chromium.launch({ headless: true });
  try {
    await run(process.execPath, ["scripts/verify-browser.mjs", running.url]);
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${running.url}/browser-checkpoint.html`);
    const title = page.getByRole("textbox", { name: "講座名" });
    await title.waitFor();
    await title.fill("日本語の独立ブラウザー保存");
    const savedRequest = page.waitForRequest(request => request.method() === "POST" && request.url().endsWith("/api/execute") && request.postDataJSON().kind === "set-fields");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    const command = (await savedRequest).postDataJSON();
    await page.waitForFunction(() => window.hostedCheckpoint.handle.state.phase === "saved");
    const evidence = await page.evaluate(() => ({ revision: window.hostedCheckpoint.handle.state.content.draftRevision,
      recovery: JSON.parse(localStorage.getItem("hosted-content-consumer-recovery-v1")) }));
    const databaseState = await fetch(`${running.url}/api/state`).then(response => response.json());
    assert.equal(databaseState.draftRevision, evidence.revision);
    assert.equal(databaseState.providers[0].entries.find(entry => entry.id === "home").values.title, "日本語の独立ブラウザー保存");
    const receipt = await fetch(`${running.url}/api/receipt?key=${encodeURIComponent(command.operationKey)}`).then(response => response.json());
    assert.equal(receipt.operationKey, command.operationKey);
    assert.equal(receipt.result.state.draftRevision, evidence.revision);
    const receipts = evidence.recovery;
    assert(receipts, "The editor must persist its recovery checkpoint");
    await page.evaluate(() => window.hostedCheckpoint.restartBackend());
    await context.close();
    const secondContext = await browser.newContext();
    const reopened = await secondContext.newPage();
    reopened.on("pageerror", error => errors.push(error.message));
    await reopened.goto(`${running.url}/browser-checkpoint.html`);
    await reopened.getByRole("textbox", { name: "講座名" }).waitFor();
    assert.equal(await reopened.getByRole("textbox", { name: "講座名" }).inputValue(), "日本語の独立ブラウザー保存");
    await reopened.getByRole("button", { name: "プレビュー", exact: true }).click();
    await reopened.waitForFunction(() => !!window.hostedCheckpoint.handle.state.reviewedSnapshot);
    const reviewed = await reopened.evaluate(() => ({ snapshot: window.hostedCheckpoint.handle.state.reviewedSnapshot,
      preview: window.hostedCheckpoint.preview.state }));
    assert.equal(reviewed.preview.status, "rendered");
    assert.equal(reviewed.preview.result.snapshotId, reviewed.snapshot.id);
    assert.equal(reviewed.preview.result.snapshotDigest, reviewed.snapshot.digest);
    assert.equal(await reopened.frameLocator("#preview").locator("h1").textContent(), "日本語の独立ブラウザー保存");
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ checkpoint: "P4-durable-existing-field", revision: evidence.revision,
      snapshotId: reviewed.snapshot.id, digest: reviewed.snapshot.digest, independentBrowserContexts: 2, sqliteBackendRestarted: true }));
    return reviewed;
  } finally { await browser.close(); await running.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await proveBrowserCheckpoint(resolve(process.argv[2] ?? "work/browser-proof.sqlite"));
