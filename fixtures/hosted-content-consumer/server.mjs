// Local conformance HTTP transport only. The production host owns authentication.
import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { createHostedContentService } from "zudo-composer/hosted-content";
import { createHostedContentConformanceSeed, createHostedContentConformancePolicy }
  from "zudo-composer/hosted-content/testing";
import { initializeSqliteDatabase, openSqliteHandle } from "./sqlite-storage.mjs";

export async function startHostedFixtureServer({ filename, port = 0, fixture = {} }) {
  const database = fixture.database ?? createHostedContentConformanceSeed();
  const policy = fixture.policy ?? createHostedContentConformancePolicy();
  await initializeSqliteDatabase(filename, database);
  let closing = false; let activeRequests = 0;
  const actor = { id: "allowed-editor" };
  const metadata = fixture.presentation ?? { selection: { entry: { providerId: "content", modelId: "lesson",
    recordId: "lesson-entry" }, fieldId: "title" }, routeId: "/", previewUrl: "/preview.html",
    renderer: "fixture:conformance", pack: "fixture:host" };
  const server = createServer(async (request, response) => {
    if (closing) { response.writeHead(503).end(); return; }
    activeRequests++;
    // Every request opens its own connection; HTTP concurrency cannot share a JS transaction lock.
    const handle = openSqliteHandle(filename);
    const service = createHostedContentService({ siteId: "hosted-fixture", definition: database.state.definition,
      policy, storage: handle.storage, authorize(who) {
        if (who.id !== actor.id) throw new Error("Unauthorized fixture actor");
      }, digest: async value => createHash("sha256").update(value).digest("hex"),
      createId: randomUUID, now: () => new Date().toISOString(),
      project: fixture.project ?? ((providers, assets) => structuredClone({ providers, assets })),
      validateSubmission: fixture.validateSubmission ?? (() => undefined),
      validateMarkdown: fixture.validateMarkdown });
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("cache-control", "no-store");
    try {
      const url = new URL(request.url, "http://localhost");
      let result;
      if (request.method === "GET" && url.pathname === "/api/state") result = await service.readState(actor);
      else if (request.method === "GET" && url.pathname === "/api/policy") result = policy;
      else if (request.method === "GET" && url.pathname === "/api/fixture") result = metadata;
      else if (request.method === "GET" && url.pathname === "/api/receipt") result = await service.readReceipt(actor, url.searchParams.get("key"));
      else if (request.method === "GET" && url.pathname === "/api/publication") result = await service.getPublication(actor, url.searchParams.get("id"));
      else if (request.method === "POST" && url.pathname === "/api/execute") {
        const chunks = []; let length = 0;
        for await (const chunk of request) {
          length += chunk.length;
          if (length > 1_000_000) throw new Error("Fixture request exceeds size limit");
          chunks.push(chunk);
        }
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        result = await service.execute(actor, body);
      } else if (request.method === "POST" && url.pathname === "/api/restart") {
        // No persistent connection remains between requests. The next request opens disk afresh.
        result = { reopened: true, database: filename };
      } else { response.writeHead(404).end(JSON.stringify({ error: "not-found" })); return; }
      response.writeHead(200).end(JSON.stringify(result));
    } catch (error) {
      const status = ["revision-conflict", "baseline-conflict", "definition-conflict", "operation-key-reuse", "publication-busy"].includes(error.code) ? 409 : 400;
      response.writeHead(status).end(JSON.stringify({ code: error.code ?? "fixture-error", message: error.message, diagnostics: error.diagnostics }));
    } finally { handle.close(); activeRequests--; }
  });
  await new Promise((ready, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", ready); });
  return { server, url: `http://127.0.0.1:${server.address().port}`, filename,
    async close() { closing = true; await new Promise((ready, reject) => server.close(error => error ? reject(error) : ready()));
      if (activeRequests) throw new Error("Fixture closed with active requests"); } };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const option = name => { const index = args.indexOf(name); return index === -1 ? undefined : args[index + 1]; };
  const filename = option("--database");
  if (!filename) throw new Error("Specify --database /absolute/path/to/file.sqlite");
  const modulePath = option("--fixture-module");
  const fixture = modulePath ? await import(pathToFileURL(resolve(modulePath)).href) : {};
  const running = await startHostedFixtureServer({ filename: resolve(filename), port: Number(option("--port") ?? 0), fixture });
  console.log(JSON.stringify({ url: running.url, database: running.filename }));
  const stop = async () => { await running.close(); process.exit(0); };
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
}
