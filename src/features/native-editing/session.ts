import { waitForAuthoringSessionReady } from "./session-readiness";
import { AUTHORING_READ_HEADER, retryAuthoringRead } from "../../shared/authoring-read-retry";
import { fileProviderConfig } from "virtual:composer-file-provider-config";
import { createFrameInputGuard } from "./frame-input-guard";
import { installAuthoringFetch } from "../../shared/authoring-fetch";
import { nativeBrowserOwner, type NativeBrowserOwner } from "./session-owner";

const config = fileProviderConfig?.nativeEditing;
const hot = import.meta.hot;
const coordinated = !!(import.meta.env.DEV && config && hot && typeof window !== "undefined");
export const nativeEditingAvailable = coordinated && ["/", "/composer", "/content", "/mapping", "/sitemapper", "/assets", "/review"].includes(window.location.pathname) && ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
const ownership = coordinated ? nativeBrowserOwner(globalThis as typeof globalThis & { [key: symbol]: NativeBrowserOwner | undefined }, config!.capability, () => "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (value) =>
  (Number(value) ^ (crypto.getRandomValues(new Uint8Array(1))[0]! & (15 >> (Number(value) / 4)))).toString(16))) : null;
const clientId = ownership?.owner.clientId ?? "";
let epoch = ownership?.owner.epoch ?? -1, connected = false, frozen = false, inputLocked = false, enrolled = false;
let isPending = () => true;
let flushPending = async () => false;
const waiting = new Set<(ready: boolean) => void>();
const frameInput = coordinated ? createFrameInputGuard(() => document.getElementById("app"), window, config!.pack) : null;
const settle = (ready: boolean) => { for (const finish of waiting) finish(ready); waiting.clear(); };
const freeze = (value: boolean, blockRequests = value) => {
  inputLocked = value;
  frozen = blockRequests;
  const route = document.getElementById("app");
  if (route) route.inert = value;
  frameInput?.lock(value);
  window.dispatchEvent(new CustomEvent("native-authoring-freeze", { detail: value }));
};
const bind = () => {
  if (!enrolled) return;
  if (ownership?.changedServer) {
    connected = false; settle(false);
    window.dispatchEvent(new CustomEvent("native-authoring-stale"));
    return;
  }
  hot?.send("native:bind", { clientId, capability: config!.capability, epoch: epoch < 0 ? null : epoch });
};
if (coordinated) {
  hot!.on("native:bound", (message: { clientId: string; epoch: number }) => {
    if (ownership?.changedServer || message.clientId !== clientId || !Number.isSafeInteger(message.epoch)) return;
    if (epoch >= 0 && epoch !== message.epoch) { connected = false; settle(false); window.dispatchEvent(new CustomEvent("native-authoring-stale")); return; }
    epoch = message.epoch; ownership!.owner.epoch = epoch; connected = true; settle(true);
  });
  hot!.on("native:unavailable", (message: { clientId: string; reason?: string }) => {
    if (message.clientId !== clientId) return;
    settle(false);
    if (message.reason === "stale-browser") {
      connected = false; freeze(false);
      window.dispatchEvent(new CustomEvent("native-authoring-stale"));
    } else setTimeout(bind, 1000);
  });
  hot!.on("native:challenge", async (message: { challenge: string; epoch: number; phase: "prepare" | "freeze" }) => {
    if (!connected || message.epoch !== epoch || !/^[a-f0-9-]{36}$/.test(message.challenge)) return;
    let clean = false;
    if (message.phase === "prepare") {
      // Stop new keystrokes before flushing debounced props. Provider admission
      // stays open until every tab has flushed; the server then drains/freezes it.
      // Do not blur an explicit-save inline editor or discard its DOM draft.
      if (!frameInput?.busy()) {
        freeze(true, false);
        try { clean = await frameInput!.settled() && await flushPending() && !isPending(); } catch { clean = false; }
      }
    }
    else if (message.phase === "freeze") { freeze(true); clean = await frameInput!.settled() && !isPending(); }
    if (connected && epoch === message.epoch) hot!.send("native:answer", { clientId, challenge: message.challenge, epoch, clean });
  });
  hot!.on("native:resume", (message: { epoch: number }) => {
    if (!Number.isSafeInteger(message.epoch) || message.epoch < epoch) return;
    if (message.epoch !== epoch) {
      connected = false;
      // The server invalidates old write epochs. Reopen actual records, never
      // stamp a stale structural draft with a fresh epoch. Pending native input
      // and server plan references are retained separately in sessionStorage.
      // Only a continuously locked tab can prove no new DOM/debounced input
      // appeared after preparation. Disconnects unlock input and lose that proof.
      if (inputLocked && !isPending() && !frameInput?.busy()) window.location.reload();
      else { freeze(false); window.dispatchEvent(new CustomEvent("native-authoring-stale")); }
    } else { freeze(false); window.dispatchEvent(new CustomEvent("native-authoring-resumed")); }
  });
  hot!.on("vite:ws:disconnect", () => { connected = false; settle(false); freeze(false); window.dispatchEvent(new CustomEvent("native-authoring-disconnected")); });
  hot!.on("native:invalidated", () => window.dispatchEvent(new CustomEvent("native-authoring-invalidated")));
  hot!.on("vite:ws:connect", bind);
}
export function attachNativeAuthoringState(pending: () => boolean, flush: () => Promise<boolean>): () => void {
  isPending = pending; flushPending = flush; enrolled = true; if (coordinated) bind();
  return () => { if (isPending === pending) isPending = () => true; };
}
async function ready(signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (!coordinated) return;
  enrolled = true;
  if (frozen) throw Object.assign(new Error("Authoring is reconciling. Input is retained."), { code: "authoring-busy" });
  const online = connected || await new Promise<boolean>(resolve => {
    const abort = () => finish(false);
    const finish = (value: boolean) => { clearTimeout(timer); signal?.removeEventListener("abort", abort); waiting.delete(finish); resolve(value); };
    const timer = setTimeout(() => finish(false), 5000); waiting.add(finish); signal?.addEventListener("abort", abort, { once: true }); if (signal?.aborted) abort(); else bind();
  });
  if (!online) throw new Error("Authoring coordination is disconnected. No write was sent.");
}
/** Wait for this exact browser epoch to resume; never sends or replays an operation. */
export async function waitForNativeAuthoringReady(signal?: AbortSignal): Promise<void> {
  await waitForAuthoringSessionReady(() => ({ coordinated, connected, epoch }), ready, signal);
}
const authoringFetch: typeof fetch = async (input, init) => {
  if (!coordinated) return globalThis.fetch(input, init);
  const readOnly = new Headers(init?.headers).get(AUTHORING_READ_HEADER) === "1";
  let requestEpoch = epoch;
  return retryAuthoringRead(input, init, async signal => {
    if (readOnly && requestEpoch >= 0 && (!connected || epoch !== requestEpoch)) throw Object.assign(new Error("Authoring session changed. Reopen current records."), { code: "stale-browser" });
    await ready(signal);
    if (requestEpoch < 0) requestEpoch = epoch;
    if (readOnly && epoch !== requestEpoch) throw Object.assign(new Error("Authoring revision changed."), { code: "stale-browser" });
    const headers = new Headers(init?.headers);
    headers.set("x-zudo-native-client", clientId); headers.set("x-zudo-native-epoch", String(epoch));
    return globalThis.fetch(input, { ...init, headers, signal });
  });
};
if (coordinated) {
  const reset = installAuthoringFetch(authoringFetch);
  hot!.dispose(() => { hot!.send("native:unbind", { clientId, capability: config!.capability }); connected = false; settle(false); reset(); freeze(false); window.dispatchEvent(new CustomEvent("native-authoring-disconnected")); frameInput?.dispose(); });
}
export async function nativeEditRequest<T>(operation: string, input: unknown, approved = false, expected?: unknown): Promise<T> {
  if (!nativeEditingAvailable) throw new Error("Native editing is unavailable in static or hosted editors.");
  await ready();
  const response = await globalThis.fetch(config!.endpoint, { method: "POST", credentials: "same-origin", redirect: "error", headers: { "content-type": "application/json", "x-zudo-native-client": clientId, "x-zudo-native-capability": config!.capability, ...(approved ? { "x-zudo-native-approval": config!.approvalCapability } : {}) }, body: JSON.stringify({ operation, input, ...(expected ? { expected } : {}) }) });
  const body = await response.json();
  if (!response.ok || body?.ok !== true) throw Object.assign(new Error(body?.error?.message ?? "Native operation response unavailable. Recover the retained receipt before retrying."), { code: body?.error?.code ?? "commit-uncertain" });
  return body.result as T;
}

/** The AI Assistant shares this coordinated loopback session; it has no other browser channel. */
export const assistantConfig: { endpoint: string; name: string } | null = nativeEditingAvailable ? config?.assistant ?? null : null;
const assistantHeaders = (approved: boolean) => ({ "content-type": "application/json", "x-zudo-native-client": clientId, "x-zudo-native-capability": config!.capability, ...(approved ? { "x-zudo-native-approval": config!.approvalCapability } : {}) });
export async function assistantRequest<T>(operation: string, workspaceId: string, input: Record<string, unknown> = {}, approved = false): Promise<T> {
  if (!assistantConfig) throw Object.assign(new Error("The AI Assistant is not configured for this host."), { code: "not-configured" });
  await ready();
  let response: Response;
  try { response = await globalThis.fetch(assistantConfig.endpoint, { method: "POST", credentials: "same-origin", redirect: "error", headers: assistantHeaders(approved), body: JSON.stringify({ operation, workspaceId, input }) }); }
  catch { throw Object.assign(new Error("The authoring server could not be reached. Your input is retained."), { code: "unavailable" }); }
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.ok !== true) throw Object.assign(new Error(body?.error?.message ?? "The Assistant response was lost. Reload to recover the current state."), { code: body?.error?.code ?? "unavailable" });
  return body.result as T;
}
/** Sequence-based event stream for one run; resolves when the server closes it. */
export async function assistantEvents(workspaceId: string, runId: string, afterSeq: number, onEvent: (event: { seq: number; type: string; data: Record<string, unknown> }) => void, signal: AbortSignal): Promise<void> {
  if (!assistantConfig) return;
  await ready();
  const response = await globalThis.fetch(assistantConfig.endpoint, { method: "POST", credentials: "same-origin", redirect: "error", signal, headers: assistantHeaders(false), body: JSON.stringify({ operation: "events", workspaceId, input: { runId, afterSeq } }) });
  if (!response.ok || !response.body) throw Object.assign(new Error("The reply stream is unavailable."), { code: "unavailable" });
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      if (line.trim()) onEvent(JSON.parse(line));
    }
  }
}

export const hostDocumentAvailable = nativeEditingAvailable && config?.hostDocument === true;

/** Saved-only host Content reads never challenge/flush browser drafts. */
export async function nativeContentRead<T>(operation: "content-preview-context" | "content-document-preview", input: unknown): Promise<T> {
  if (!hostDocumentAvailable) throw new Error("Saved host Content preview is unavailable.");
  await ready();
  const requestEpoch = epoch;
  const init = { method: "POST", credentials: "same-origin" as const, redirect: "error" as const, headers: { "content-type": "application/json", "x-zudo-native-client": clientId, "x-zudo-native-capability": config!.capability, "x-zudo-native-epoch": String(requestEpoch), [AUTHORING_READ_HEADER]: "1" }, body: JSON.stringify({ operation, input }) };
  const response = await retryAuthoringRead(config!.endpoint, init, async signal => {
    await ready(signal);
    if (!connected || epoch !== requestEpoch) throw Object.assign(new Error("Authoring session changed. Refresh saved Content context."), { code: "stale-browser" });
    return globalThis.fetch(config!.endpoint, { ...init, signal });
  });
  const body = await response.json();
  if (!response.ok || body?.ok !== true) throw Object.assign(new Error(body?.error?.message ?? "Saved Content preview could not be read."), { code: body?.error?.code ?? "read-failed" });
  if (!connected || epoch !== requestEpoch) throw Object.assign(new Error("Authoring session changed. Refresh saved Content context."), { code: "stale-browser" });
  return body.result as T;
}
