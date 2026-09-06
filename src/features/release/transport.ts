import config from "virtual:release-config";
import type { SiteProjectApiRequest, SiteProjectApiResponse } from "../../site-project/api/types";

export interface ReleaseTransport {
  readonly available: boolean;
  request(request: SiteProjectApiRequest, guard?: (payload: unknown) => Promise<unknown>): Promise<SiteProjectApiResponse>;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}
export function createReleaseTransport(): ReleaseTransport {
  const hot = import.meta.hot;
  const available = !!(import.meta.env.DEV && config && hot);
  const clientId = crypto.randomUUID();
  const listeners = new Set<() => void>();
  const requests = new Map<string, { operation: string; guard?: (payload: unknown) => Promise<unknown>; seen: Set<string> }>();
  let connected = false;
  const ready = new Set<(value: boolean) => void>();
  const bound = (message: { clientId: string }) => { if (message.clientId !== clientId) return; connected = true; for (const resolve of ready) resolve(true); ready.clear(); };
  const disconnected = () => { connected = false; for (const resolve of ready) resolve(false); ready.clear(); changed(); };
  const bind = () => { if (available) hot!.send("release:bind", { clientId, capability: config!.capability }); };
  const changed = () => { for (const listener of listeners) listener(); };
  const challenge = async (message: { requestId: string; challenge: string; operation: string; payload: unknown }) => {
    const request = requests.get(message.requestId);
    if (!request || request.operation !== message.operation || !/^[a-f0-9]{64}$/.test(message.challenge) || request.seen.has(message.challenge)) return;
    request.seen.add(message.challenge);
    let result: unknown = false;
    try { result = await request.guard?.(message.payload) ?? false; } catch { /* Fail closed. */ }
    if (requests.has(message.requestId)) hot!.send("release:answer", { challenge: message.challenge, requestId: message.requestId, result });
  };
  if (available) { hot!.on("release:bound", bound); hot!.on("vite:ws:disconnect", disconnected); bind(); hot!.on("vite:ws:connect", bind); hot!.on("release:challenge", challenge); hot!.on("release:changed", changed); }
  return {
    available,
    async request(request, guard) {
      if (!available) return { ok: false, error: { code: "unavailable", message: "Local release writes are unavailable in this static build." } };
      const online = connected || await new Promise<boolean>((resolve) => { const finish = (value: boolean) => { clearTimeout(timer); ready.delete(finish); resolve(value); }; const timer = setTimeout(() => finish(false), 5000); ready.add(finish); bind(); });
      if (!online) return { ok: false, error: { code: "unavailable", message: "Local release validation channel is disconnected or expired. No request was sent." } };
      const requestId = crypto.randomUUID(); requests.set(requestId, { operation: request.operation, guard, seen: new Set() });
      try {
        bind();
        const response = await fetch(config!.endpoint, { method: "POST", credentials: "same-origin", redirect: "error", headers: { "Content-Type": "application/json", "X-Zudo-Release-Capability": config!.capability }, body: JSON.stringify({ requestId, clientId, request }) });
        const result = await response.json();
        if (!response.ok || typeof result?.ok !== "boolean" || (result.ok ? !("result" in result) : typeof result.error?.code !== "string")) throw new Error("Invalid release response.");
        return result as SiteProjectApiResponse;
      } catch { return { ok: false, error: { code: ["apply", "build", "activate", "discard"].includes(request.operation) ? "commit-uncertain" : "unavailable", message: "Local release response was lost or capability expired. Inspect exact staged/active state before continuing." } }; }
      finally { requests.delete(requestId); }
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose() { disconnected(); requests.clear(); listeners.clear(); if (available) { hot!.send("release:unbind", { clientId }); hot!.off("release:bound", bound); hot!.off("vite:ws:disconnect", disconnected); hot!.off("vite:ws:connect", bind); hot!.off("release:challenge", challenge); hot!.off("release:changed", changed); } },
  };
}
