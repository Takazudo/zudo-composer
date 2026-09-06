import { randomBytes } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Plugin, WebSocketClient } from "vite";

const moduleId = "virtual:release-config", resolved = `\0${moduleId}`;
const nonce = () => randomBytes(32).toString("hex");
/** Serve-only capability; no filesystem API or secret is emitted in build mode. */
export default function releaseApiPlugin(): Plugin {
  let serving = false;
  const capability = nonce();
  return {
    name: "zudo-local-release-api",
    configResolved(config) { serving = config.command === "serve"; },
    resolveId(id) { if (id === moduleId) return resolved; },
    load(id) { if (id === resolved) return `export default ${JSON.stringify(serving ? { endpoint: "/__zudo-release", capability } : null)};`; },
    configureServer(server) {
      // Keep the local adapter's exact-state recovery tickets alive across HTTP
      // retries while callbacks remain isolated to their originating request.
      const contexts = new AsyncLocalStorage<{ ask(payload: unknown): Promise<unknown> }>();
      let service: Promise<{ handle(request: unknown): Promise<unknown> }> | undefined;
      const api = () => service ??= server.ssrLoadModule("/server/site-project-local/service.ts").then((module) => module.createLocalSiteProjectApiService({
        isWorkingCurrent: async (project: unknown, precondition: unknown) => (await contexts.getStore()?.ask({ kind: "current", project, precondition })) === true,
        reconcilePublication: async (active: unknown, changes: unknown) => (await contexts.getStore()?.ask({ kind: "reconcile", active, changes })) === "applied" ? "applied" : "changed",
      }));
      const clients = new Map<string, WebSocketClient>();
      const closers = new Map<string, () => void>();
      const pending = new Map<string, { client: WebSocketClient; clientId: string; requestId: string; finish(value: unknown): void }>();
      const inFlight = new Set<string>();
      server.ws.on("release:bind", (data, client) => {
        if (data?.capability !== capability || !/^[a-f0-9-]{36}$/.test(data.clientId)) return;
        const prior = clients.get(data.clientId); if (prior && prior !== client) return;
        if (prior === client) { client.send("release:bound", { clientId: data.clientId }); return; }
        clients.set(data.clientId, client);
        client.send("release:bound", { clientId: data.clientId });
        const close = () => { if (clients.get(data.clientId) === client) clients.delete(data.clientId); closers.delete(data.clientId); for (const item of pending.values()) if (item.client === client) item.finish(false); };
        closers.set(data.clientId, close); client.socket.once("close", close);
      });
      server.ws.on("release:unbind", (data, client) => { if (clients.get(data?.clientId) !== client) return; const close = closers.get(data.clientId); if (close) client.socket.off("close", close); clients.delete(data.clientId); closers.delete(data.clientId); for (const item of pending.values()) if (item.clientId === data.clientId) item.finish(false); });
      server.ws.on("release:answer", (data, client) => {
        const item = pending.get(data?.challenge);
        if (!item || item.client !== client || item.requestId !== data.requestId) return;
        item.finish(data.result);
      });
      server.middlewares.use(async (req, res, next) => {
        if (req.url !== "/__zudo-release") return next();
        const respond = (status: number, value: unknown) => { if (res.destroyed) return; res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store"); res.end(JSON.stringify(value)); };
        const origin = req.headers.origin;
        if (req.method !== "POST" || !origin || origin !== `${server.config.server.https ? "https" : "http"}://${req.headers.host}` || req.headers["x-zudo-release-capability"] !== capability || req.headers["content-type"] !== "application/json") return respond(403, { error: "Local release capability/origin required." });
        let requestId = "", ownsRequest = false;
        try {
          const chunks: Buffer[] = []; let bytes = 0;
          for await (const chunk of req) { bytes += chunk.length; if (bytes > 8 * 1024 * 1024) throw new Error("Request too large."); chunks.push(Buffer.from(chunk)); }
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          const client = clients.get(body.clientId);
          requestId = body.requestId;
          if (!client || !/^[a-f0-9-]{36}$/.test(requestId) || inFlight.has(requestId)) throw new Error("Unavailable or duplicate request channel.");
          inFlight.add(requestId);
          ownsRequest = true;
          const ask = (payload: unknown): Promise<unknown> => new Promise((resolve) => {
            const challenge = nonce();
            const finish = (value: unknown) => { if (!pending.delete(challenge)) return; clearTimeout(timer); res.off("close", closed); resolve(value); };
            const closed = () => finish(false);
            const timer = setTimeout(closed, 10_000);
            pending.set(challenge, { client, clientId: body.clientId, requestId, finish }); res.once("close", closed);
            if (res.destroyed || client.socket.readyState !== 1) return closed();
            client.send("release:challenge", { challenge, requestId, operation: body.request?.operation, payload });
          });
          const result = await contexts.run({ ask }, async () => (await api()).handle(body.request));
          if (["apply", "activate", "discard"].includes(body.request?.operation)) server.ws.send("release:changed", {});
          respond(200, result);
        } catch { respond(503, { ok: false, error: { code: "unavailable", message: "Local release channel unavailable; inspect exact state before retrying a mutation." } }); }
        finally { if (ownsRequest) inFlight.delete(requestId); }
      });
    },
  };
}
