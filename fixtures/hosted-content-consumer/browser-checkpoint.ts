/** Independent host fixture: all Composer imports use public package entries. */
import { HostedContentError } from "zudo-composer/hosted-content";
import type { HostedPolicy, HostedTransport } from "zudo-composer/hosted-content";
import { mountHostedContentEditor, createHostedPreviewController, buildHostedPreviewLocation } from "zudo-composer/hosted-content/editor";
import type { HostedEditorSelection, HostedRecoveryCheckpoint } from "zudo-composer/hosted-content/editor";
import "zudo-composer/hosted-content/editor.css";
interface Presentation {
  selection: HostedEditorSelection; routeId: string; previewUrl: string;
  pack: { packId: string; packVersion: string }; renderer: { rendererId: string; rendererVersion: string };
}
async function request<T>(path: string, payload?: unknown): Promise<T> {
  const response = await fetch(path, payload === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const body = await response.json();
  if (!response.ok) {
    if (body.code) throw new HostedContentError(body.code, body.message ?? "Hosted request failed", body.diagnostics);
    throw new Error(body.message ?? `HTTP ${response.status}`);
  }
  return body as T;
}
const transport: HostedTransport = {
  readState: () => request("/api/state"), execute: (command) => request("/api/execute", command),
  readReceipt: (key) => request(`/api/receipt?key=${encodeURIComponent(key)}`),
  getPublication: (id) => request(`/api/publication?id=${encodeURIComponent(id)}`),
};
const checkpointKey = "hosted-content-consumer-recovery-v1";
async function main() {
  const container = document.getElementById("editor");
  const frame = document.getElementById("preview") as HTMLIFrameElement | null;
  const status = document.getElementById("checkpoint-status");
  if (!container || !frame || !status) throw new Error("Missing fixture mount nodes");
  const [policy, presentation] = await Promise.all([request<HostedPolicy>("/api/policy"), request<Presentation>("/api/fixture")]);
  const preview = createHostedPreviewController({ frame, hostWindow: window, location: buildHostedPreviewLocation(presentation.previewUrl, location.origin), pack: presentation.pack, renderer: presentation.renderer });
  frame.src = presentation.previewUrl;
  const saved = localStorage.getItem(checkpointKey);
  const handle = mountHostedContentEditor(container, {
    transport, policy, selection: presentation.selection, routeId: presentation.routeId, preview,
    recovery: saved ? JSON.parse(saved) as HostedRecoveryCheckpoint : undefined,
    createOperationKey: () => crypto.randomUUID(),
    persistRecovery(checkpoint) { localStorage.setItem(checkpointKey, JSON.stringify(checkpoint)); },
    labels: { save: "保存", preview: "プレビュー", submit: "提出", dirty: "未保存の変更があります", saving: "保存中…", saved: "保存しました", clean: "保存済み", recovering: "保存結果を確認中…" },
  });
  handle.subscribe((state) => { status.textContent = `${state.phase}: ${state.content?.draftRevision ?? "loading"}`; status.dataset.phase = state.phase; status.dataset.draftRevision = state.content?.draftRevision ?? ""; });
  await handle.ready;
  // The browser acceptance runner invokes restart then disposes/reopens this
  // page in another context; the backend file is authoritative across sessions.
  Object.assign(window, { hostedCheckpoint: { handle, preview, transport, restartBackend: () => request("/api/restart", {}) } });
  window.addEventListener("pagehide", () => handle.dispose(), { once: true });
}
void main().catch((error) => { const status = document.getElementById("checkpoint-status"); if (status) { status.textContent = error instanceof Error ? error.message : String(error); status.dataset.phase = "failed"; } });
