import { fileProviderConfig } from "virtual:composer-file-provider-config";

const config = fileProviderConfig?.nativeEditing;
const hot = import.meta.hot;
const coordinated = !!(import.meta.env.DEV && config && hot && typeof window !== "undefined");
export const nativeEditingAvailable = coordinated && ["/", "/composer", "/content", "/mapping", "/sitemapper", "/assets", "/review"].includes(window.location.pathname) && ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
const clientId = coordinated ? "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (value) =>
  (Number(value) ^ (crypto.getRandomValues(new Uint8Array(1))[0]! & (15 >> (Number(value) / 4)))).toString(16)) : "";
let epoch = -1, connected = false, frozen = false, enrolled = false;
let isPending = () => true;
let flushPending = async () => false;
const waiting = new Set<(ready: boolean) => void>();
const settle = (ready: boolean) => { for (const finish of waiting) finish(ready); waiting.clear(); };
const freeze = (value: boolean) => {
  frozen = value;
  const route = document.getElementById("app");
  if (route) route.inert = value;
  window.dispatchEvent(new CustomEvent("native-authoring-freeze", { detail: value }));
};
const bind = () => { if (enrolled) hot?.send("native:bind", { clientId, capability: config!.capability, epoch: epoch < 0 ? null : epoch }); };
if (coordinated) {
  hot!.on("native:bound", (message: { clientId: string; epoch: number }) => {
    if (message.clientId !== clientId || !Number.isSafeInteger(message.epoch)) return;
    if (epoch >= 0 && epoch !== message.epoch) { connected = false; settle(false); window.dispatchEvent(new CustomEvent("native-authoring-stale")); return; }
    epoch = message.epoch; connected = true; settle(true);
  });
  hot!.on("native:unavailable", (message: { clientId: string; reason?: string }) => {
    if (message.clientId !== clientId) return;
    settle(false);
    if (message.reason === "stale-browser") {
      connected = false; freeze(false);
      if (!isPending()) window.location.reload();
      else window.dispatchEvent(new CustomEvent("native-authoring-stale"));
    } else setTimeout(bind, 1000);
  });
  hot!.on("native:challenge", async (message: { challenge: string; epoch: number; phase: "prepare" | "freeze" }) => {
    if (!connected || message.epoch !== epoch || !/^[a-f0-9-]{36}$/.test(message.challenge)) return;
    let clean = false;
    if (message.phase === "prepare") { try { clean = await flushPending() && !isPending(); } catch { clean = false; } }
    else if (message.phase === "freeze") { freeze(true); clean = !isPending(); }
    if (connected && epoch === message.epoch) hot!.send("native:answer", { clientId, challenge: message.challenge, epoch, clean });
  });
  hot!.on("native:resume", (message: { epoch: number }) => {
    if (!Number.isSafeInteger(message.epoch) || message.epoch < epoch) return;
    if (message.epoch !== epoch) {
      connected = false;
      // The server invalidates old write epochs. Reopen actual records, never
      // stamp a stale structural draft with a fresh epoch. Pending native input
      // and server plan references are retained separately in sessionStorage.
      if (!isPending()) window.location.reload();
      else { freeze(false); window.dispatchEvent(new CustomEvent("native-authoring-stale")); }
    } else freeze(false);
  });
  hot!.on("vite:ws:disconnect", () => { connected = false; settle(false); if (frozen) freeze(false); });
  hot!.on("native:invalidated", () => window.dispatchEvent(new CustomEvent("native-authoring-invalidated")));
  hot!.on("vite:ws:connect", bind);
}
export function attachNativeAuthoringState(pending: () => boolean, flush: () => Promise<boolean>): () => void {
  isPending = pending; flushPending = flush; enrolled = true; if (coordinated) bind();
  return () => { if (isPending === pending) isPending = () => true; };
}
async function ready() {
  if (!coordinated) return;
  enrolled = true;
  if (frozen) throw new Error("Authoring is reconciling. Input is retained.");
  const online = connected || await new Promise<boolean>(resolve => {
    const finish = (value: boolean) => { clearTimeout(timer); waiting.delete(finish); resolve(value); };
    const timer = setTimeout(() => finish(false), 5000); waiting.add(finish); bind();
  });
  if (!online) throw new Error("Authoring coordination is disconnected. No write was sent.");
}
export const authoringFetch: typeof fetch = async (input, init) => {
  if (!coordinated) return globalThis.fetch(input, init);
  await ready();
  const headers = new Headers(init?.headers);
  headers.set("x-zudo-native-client", clientId); headers.set("x-zudo-native-epoch", String(epoch));
  return globalThis.fetch(input, { ...init, headers });
};
export async function nativeEditRequest<T>(operation: string, input: unknown, approved = false, expected?: unknown): Promise<T> {
  if (!nativeEditingAvailable) throw new Error("Native editing is unavailable in static or hosted editors.");
  await ready();
  const response = await globalThis.fetch(config!.endpoint, { method: "POST", credentials: "same-origin", redirect: "error", headers: { "content-type": "application/json", "x-zudo-native-client": clientId, "x-zudo-native-capability": config!.capability, ...(approved ? { "x-zudo-native-approval": config!.approvalCapability } : {}) }, body: JSON.stringify({ operation, input, ...(expected ? { expected } : {}) }) });
  const body = await response.json();
  if (!response.ok || body?.ok !== true) throw Object.assign(new Error(body?.error?.message ?? "Native operation response unavailable. Recover the retained receipt before retrying."), { code: body?.error?.code ?? "commit-uncertain" });
  return body.result as T;
}
