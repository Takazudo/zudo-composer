import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join, extname, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { startHostedFixtureServer } from "./server.mjs";
import { createFixtureSeed, createFixturePolicy, createFixtureService, fixtureEntry } from "./fixture-data.mjs";
import { openSqliteHandle } from "./sqlite-storage.mjs";
import { createFixtureExportSink, createFixturePublicationProvider } from "./publication-proof.mjs";
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
  const sink = await createFixtureExportSink({ directory: `${filename}.remote`, baseline: fixture.database.state.baseline, definition: fixture.database.state.definition });
  const providerWarnings = [];
  const withProvider = async work => {
    const handle = openSqliteHandle(filename);
    try {
      const service = createFixtureService(handle.storage, projectHostedContent);
      const provider = createFixturePublicationProvider({ service, storage: handle.storage, sink });
      return await work({ service, provider });
    } finally { handle.close(); }
  };
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      if (url.pathname.startsWith("/api/")) {
        if (url.pathname === "/api/restart" && request.method === "POST") {
          for await (const chunk of request) { void chunk; }
          await upstream.close();
          upstream = await startHostedFixtureServer({ filename, fixture });
          response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ reopened: true }));
          return;
        }
        const chunks = []; for await (const chunk of request) chunks.push(chunk);
        const payload = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
        if (request.method === "POST" && url.pathname.startsWith("/api/provider/")) {
          const publicationId = payload?.publicationId;
          if (typeof publicationId !== "string") throw Error("A bound local publication identity is required");
          const result = await withProvider(async ({ service, provider }) => {
            // These privileged controls belong only to this local acceptance harness.
            if (url.pathname === "/api/provider/integrate") {
              await sink.confirmIntegration(publicationId);
              if (!payload.crashBeforeReconcile) await provider.synchronize(publicationId);
              return service.getPublication({ id: "allowed-editor" }, publicationId);
            }
            if (url.pathname === "/api/provider/reconcile") return provider.synchronize(publicationId);
            throw Error("Unknown local provider control");
          });
          response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(result));
          return;
        }
        const result = await fetch(new URL(request.url, upstream.url), { method: request.method,
          headers: { "content-type": "application/json" }, body: chunks.length ? Buffer.concat(chunks) : undefined });
        const text = await result.text();
        if (result.ok && request.method === "POST" && url.pathname === "/api/execute" && payload?.kind === "begin-publication") {
          const publicationId = JSON.parse(text).publication.id;
          // The content transaction/receipt is already committed. Provider follow-up
          // must never turn that exact acknowledged/replayed operation into HTTP failure.
          try {
            await withProvider(async ({ provider }) => {
              let remote;
              try { remote = await sink.lookup(publicationId); }
              catch (error) { if (error.code !== "not-found") throw error; }
              if (remote?.status === "integrated") {
                // The provider validates exact stored snapshot/baseline evidence before CAS.
                await provider.synchronize(publicationId);
                return;
              }
              await provider.submit(publicationId, `local-export-${publicationId}`);
              await provider.verify(publicationId);
            });
          } catch (error) { providerWarnings.push({ publicationId, message: String(error) }); }
        }
        response.writeHead(result.status, { "content-type": "application/json", "cache-control": "no-store" }).end(text);
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
  return { url: `http://127.0.0.1:${server.address().port}`, providerWarnings,
    async close() { await new Promise((ready, reject) => server.close(error => error ? reject(error) : ready())); await upstream.close(); } };
}
export async function buildBrowserFixture({ requireBroadControls = true } = {}) {
  const built = await build({ entryPoints: [join(root, "browser-checkpoint.ts")], outfile: join(rendererRoot, "dist/browser-checkpoint.js"),
    bundle: true, format: "esm", platform: "browser", jsx: "automatic", jsxImportSource: "preact", target: "es2022", metafile: true });
  const inputs = Object.keys(built.metafile.inputs);
  const hostLeaks = inputs.filter(input => /@takazudo[+/](?:zfb|zudo-doc|zudo-sg)|@zudo-composer[+/]ui|marked(?:@|[/\\])|renderer[/\\](?:src|public)|node:|virtual:|zudo-composer[/\\]src[/\\]|[/\\]src[/\\]app[/\\]|(?:buffer|process|crypto-browserify|path-browserify|stream-browserify|node-polyfills)[/\\]/.test(input));
  assert.deepEqual(hostLeaks, [], "The editor graph must not include host runtime/CSS, Node/polyfills, private application sources or virtual providers");
  for (const detail of Object.values(built.metafile.outputs)) assert.deepEqual(detail.imports.filter(item => item.external), [], "A complete browser bundle cannot leave runtime imports external");
  assert(inputs.some(input => /preact[/\\]dist|preact\+|preact@/.test(input)), "Real public editor must emit its Preact runtime");
  assert(inputs.some(input => /hosted-content[/\\]editor\.mjs$/.test(input)), "Real public mount API must contribute the editor graph");
  const sourceMarkdown = inputs.some(input => /@codemirror[+/]lang-markdown|@codemirror[+/]view/.test(input));
  if (requireBroadControls) assert(sourceMarkdown, "Broad editor must emit actual source Markdown controls without ProseMd or a host pack");
  let html = await readFile(join(root, "browser-checkpoint.html"), "utf8");
  html = html.replace("</head>", '<link rel="stylesheet" href="/browser-checkpoint.css"></head>');
  await writeFile(join(rendererRoot, "dist/browser-checkpoint.html"), html);
  const hashes = {};
  for (const name of ["browser-checkpoint.js", "browser-checkpoint.css"]) hashes[name] = createHash("sha256").update(await readFile(join(rendererRoot, "dist", name))).digest("hex");
  await writeFile(join(rendererRoot, "dist/browser-checkpoint-metafile.json"), JSON.stringify(built.metafile, null, 2));
  const css = await readFile(join(rendererRoot, "dist/browser-checkpoint.css"), "utf8");
  assert(css.includes(".hosted-content-editor") && css.includes("--hosted-surface"), "Delivered editor CSS contains its actual chrome and own tokens");
  assert(inputs.some(input => /hosted-content[/\\]editor\.css$/.test(input)), "The explicit shipped public editor CSS must enter this host's browser asset graph");
  // The manager-owned host config uses DOM only and types:[], never implicit Node ambient types.
  await run("corepack", ["pnpm", "exec", "tsc", "--noEmit", "-p", "tsconfig.browser.json"], root);
  const evidence = { proof: "installed-editor-browser-assets-and-declarations", browserExecution: "NOT RUN", editorJavascriptBundle: "PASS", explicitPublicEditorCss: "PASS",
    emittedDependencyMetafile: "PASS", editorHostRendererNodeVirtualLeaks: hostLeaks, strictPublicBrowserHostDeclarations: "PASS", actualSourceMarkdownControls: sourceMarkdown ? "PASS" : "NOT REQUIRED: foundation probe", assetHashes: hashes };
  await writeFile(join(rendererRoot, "dist/browser-assets-evidence.json"), JSON.stringify(evidence, null, 2));
  return evidence;
}
export async function proveBrowserCheckpoint(filename) {
  await prepareRenderProof(filename);
  await buildRenderer();
  await buildBrowserFixture();
  const running = await startBrowserFixture(filename);
  try { await run(process.execPath, ["scripts/verify-browser.mjs", running.url]); }
  catch (error) { await running.close(); throw error; }
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { await running.close(); throw error; }
  try {
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
    const recoveredReceipt = await fetch(`${running.url}/api/receipt?key=${encodeURIComponent(command.operationKey)}`).then(response => response.json());
    assert.deepEqual(recoveredReceipt, receipt, "Backend restart must recover the identical committed save receipt");
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
