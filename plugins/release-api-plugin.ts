import { randomBytes } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { isIP } from "node:net";
import type { IncomingMessage } from "node:http";
import type { Plugin, WebSocketClient } from "vite";

const moduleId = "virtual:release-config", resolved = `\0${moduleId}`;
const nonce = () => randomBytes(32).toString("hex");
export const RELEASE_LIMITS = { clients: 16, requests: 4, bodyBytes: 8 * 1024 * 1024, bodyMs: 5000, challengeMs: 10_000 } as const;
function loopback(peer: string | undefined): boolean {
  if (!peer) return false;
  if (isIP(peer) === 6) { const host = new URL(`http://[${peer}]`).hostname; if (host === "[::1]" || /^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}\]$/.test(host)) return true; }
  if (peer.startsWith("::ffff:")) peer = peer.slice(7);
  return isIP(peer) === 4 && peer.split(".")[0] === "127";
}
/** Direct socket and literal loopback authority only; proxy headers are never authority. */
export function trustedReleaseRequest(req: Pick<IncomingMessage, "headers" | "socket">, https: boolean): boolean {
  if (!loopback(req.socket.remoteAddress) || Object.keys(req.headers).some((key) => key === "forwarded" || key.startsWith("x-forwarded-"))) return false;
  const host = req.headers.host, origin = req.headers.origin;
  if (typeof host !== "string" || typeof origin !== "string" || !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::[1-9][0-9]{0,4})?$/.test(host)) return false;
  try { const url = new URL(`${https ? "https" : "http"}://${host}`); return url.host === host && origin === url.origin && Number(url.port || (https ? 443 : 80)) === req.socket.localPort; } catch { return false; }
}
/** Serve-only loopback operator capability; no secret is emitted in build mode. */
export default function releaseApiPlugin(): Plugin {
  let serving = false;
  const capability = nonce();
  return {
    name: "zudo-local-release-api",
    configResolved(config) { serving = config.command === "serve"; },
    resolveId(id) { if (id === moduleId) return resolved; },
    load(id) { if (id === resolved) return `export default ${JSON.stringify(serving ? { endpoint: "/__zudo-release", capability } : null)};`; },
    configureServer(server) {
      const trustedSockets = new WeakSet<object>();
      server.ws.on("connection", (socket, request) => { if (trustedReleaseRequest(request, !!server.config.server.https)) trustedSockets.add(socket); });
      const contexts = new AsyncLocalStorage<{ ask(payload: unknown): Promise<unknown> }>();
      let service: Promise<{ handle(request: unknown): Promise<unknown> }> | undefined;
      const api = () => service ??= server.ssrLoadModule("/server/site-project-local/service.ts").then((module) => module.createLocalSiteProjectApiService({
        isWorkingCurrent: async (project: unknown, precondition: unknown) => (await contexts.getStore()?.ask({ kind: "current", project, precondition })) === true,
      }));
      const clients = new Map<string, { client: WebSocketClient; close(): void }>();
      const active = new Map<string, { abort(): void }>();
      const pending = new Map<string, { client: WebSocketClient; clientId: string; requestId: string; finish(value: unknown): void }>();
      const challenges = new Set<string>();
      const remove = (id: string) => { const entry = clients.get(id); if (!entry) return; clients.delete(id); entry.client.socket.off("close", entry.close); active.get(id)?.abort(); };
      server.ws.on("release:bind", (data, client) => {
        if (!trustedSockets.has(client.socket) || data?.capability !== capability || !/^[a-f0-9-]{36}$/.test(data.clientId)) return;
        const prior = clients.get(data.clientId); if (prior && prior.client !== client) return;
        if (!prior) { if (clients.size >= RELEASE_LIMITS.clients || [...clients.values()].some((entry) => entry.client === client)) return; const close = () => remove(data.clientId); clients.set(data.clientId, { client, close }); client.socket.once("close", close); }
        client.send("release:bound", { clientId: data.clientId });
      });
      server.ws.on("release:unbind", (data, client) => { if (clients.get(data?.clientId)?.client === client) remove(data.clientId); });
      server.ws.on("release:answer", (data, client) => { const item = pending.get(data?.challenge); if (!trustedSockets.has(client.socket) || !item || item.client !== client || item.requestId !== data.requestId) return; item.finish(data.result); });
      server.middlewares.use(async (req, res, next) => {
        if (req.url !== "/__zudo-release") return next();
        const respond = (status: number, value: unknown) => { if (res.destroyed) return; res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store"); res.end(JSON.stringify(value)); };
        // Reject before reading or allocating the body, including when --host serves remote clients.
        if (!trustedReleaseRequest(req, !!server.config.server.https) || req.method !== "POST" || req.headers["x-zudo-release-capability"] !== capability || req.headers["content-type"] !== "application/json") return respond(403, { error: "Direct loopback operator channel required." });
        const clientId = req.headers["x-zudo-release-client"], requestId = req.headers["x-zudo-release-request"];
        const client = typeof clientId === "string" ? clients.get(clientId)?.client : undefined;
        if (!client || typeof clientId !== "string" || typeof requestId !== "string" || !/^[a-f0-9-]{36}$/.test(requestId)) return respond(403, { error: "Bound operator client required." });
        if (active.size >= RELEASE_LIMITS.requests || active.has(clientId)) return respond(429, { error: "Release request capacity exhausted; no request accepted." });
        const length = req.headers["content-length"];
        if (length !== undefined && (!/^[0-9]+$/.test(String(length)) || Number(length) > RELEASE_LIMITS.bodyBytes)) return respond(413, { error: "Release request body too large." });
        let closed = false, reading = true;
        const abort = () => { closed = true; if (reading) req.destroy(); for (const item of pending.values()) if (item.clientId === clientId) item.finish(false); };
        active.set(clientId, { abort }); res.once("close", abort);
        const timer = setTimeout(abort, RELEASE_LIMITS.bodyMs);
        try {
          const chunks: Buffer[] = []; let bytes = 0;
          for await (const chunk of req) { bytes += chunk.length; if (bytes > RELEASE_LIMITS.bodyBytes) throw new Error("Request too large."); chunks.push(Buffer.from(chunk)); }
          reading = false; clearTimeout(timer);
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8")); chunks.length = 0;
          if (closed || body.clientId !== clientId || body.requestId !== requestId) throw new Error("Invalid request channel.");
          const ask = (payload: unknown): Promise<unknown> => {
            if (closed || pending.size >= RELEASE_LIMITS.requests || challenges.has(clientId)) return Promise.resolve(false);
            return new Promise((resolve) => {
              const challenge = nonce();
              const finish = (value: unknown) => { if (!pending.delete(challenge)) return; challenges.delete(clientId); clearTimeout(expiry); resolve(value); };
              const expiry = setTimeout(() => finish(false), RELEASE_LIMITS.challengeMs);
              challenges.add(clientId); pending.set(challenge, { client, clientId, requestId, finish });
              if (closed || res.destroyed || client.socket.readyState !== 1) return finish(false);
              client.send("release:challenge", { challenge, requestId, operation: body.request?.operation, payload });
            });
          };
          const result = await contexts.run({ ask }, async () => (await api()).handle(body.request));
          if (["apply", "activate", "discard"].includes(body.request?.operation)) server.ws.send("release:changed", {});
          respond(200, result);
        } catch { respond(503, { ok: false, error: { code: "unavailable", message: "Local release channel unavailable; inspect exact state before retrying a mutation." } }); }
        finally { clearTimeout(timer); res.off("close", abort); abort(); active.delete(clientId); }
      });
    },
  };
}
