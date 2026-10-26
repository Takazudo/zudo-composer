/* global document, window, localStorage, crypto, setInterval */
// Local host shell. It mounts the unchanged public restricted editor over the same browser transport a
// production host would supply; only the surrounding page names the local publication result.
import { HostedContentError } from "zudo-composer/hosted-content";
import { buildHostedPreviewLocation, createHostedPreviewController, mountHostedContentEditor } from "zudo-composer/hosted-content/editor";
import "zudo-composer/hosted-content/editor.css";

// Publication facts come from a local sink on this machine, so every label says "local" and none says live.
const statusLabels = {
  submitted: "Queued for a local artifact", building: "Generating local artifact", verified: "Local artifact generated",
  integrated: "Local artifact ready (local baseline updated)", deployed: "Deployed", failed: "Local artifact failed",
  conflict: "Local artifact conflict", unavailable: "Local publisher unavailable",
};
const labels = { ...statusLabels, submit: "Generate local artifact", refreshStatus: "Refresh local artifact status",
  statusUnavailable: "Local artifact status is unavailable. The saved draft is retained.",
  previewRequired: "Preview the current saved content before generating a local artifact." };
const terminal = new Set(["integrated", "deployed", "failed", "conflict"]);

async function request(path, payload) {
  const response = await fetch(path, payload === undefined ? { cache: "no-store" }
    : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const body = await response.json();
  if (!response.ok) {
    if (body.code) throw new HostedContentError(body.code, body.message ?? "Local request failed", body.diagnostics);
    throw new Error(body.message ?? `HTTP ${response.status}`);
  }
  return body;
}
const transport = {
  readState: () => request("/api/state"),
  execute: command => request("/api/execute", command),
  readReceipt: key => request(`/api/receipt?key=${encodeURIComponent(key)}`),
  getPublication: id => request(`/api/publication?id=${encodeURIComponent(id)}`),
};

function element(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  node.append(...children);
  return node;
}

function renderArtifacts(list, rows) {
  list.replaceChildren(...(rows.length ? rows.map(row => {
    const item = element("li", { "data-publication-id": row.publicationId, "data-status": row.status });
    item.append(element("strong", {}, statusLabels[row.status] ?? row.status), " ");
    if (row.artifact) item.append(element("a", { href: row.artifact.url, target: "_blank", rel: "noopener", "data-local-artifact": row.publicationId }, "Open local artifact"), " ");
    item.append(element("small", {}, `snapshot ${row.snapshotId.slice(0, 8)}${row.artifact ? ` · digest ${row.artifact.snapshotDigest.slice(0, 12)}` : ""}`));
    if (row.message && !terminal.has(row.status)) item.append(element("p", {}, row.message));
    if (row.error) item.append(element("p", { role: "alert" }, row.error));
    if (!terminal.has(row.status) && !row.running) {
      const retry = element("button", { type: "button" }, "Retry local artifact");
      retry.addEventListener("click", () => { void request("/api/local/publications/retry", { publicationId: row.publicationId }).catch(() => undefined); });
      item.append(retry);
    }
    return item;
  }) : [element("li", {}, "No local artifacts yet. Save, preview, then generate one.")]));
}

async function main() {
  const presentation = await request("/api/presentation");
  const policy = await request("/api/policy");
  document.getElementById("data-location").textContent = presentation.locations.database;
  document.getElementById("artifact-location").textContent = presentation.locations.artifacts;
  const frame = document.getElementById("preview");
  const previewStatus = document.getElementById("preview-identity");
  const list = document.getElementById("artifact-list");
  const preview = createHostedPreviewController({ frame, hostWindow: window,
    location: buildHostedPreviewLocation(presentation.previewUrl, window.location.origin), pack: presentation.pack, renderer: presentation.renderer });
  frame.src = presentation.previewUrl;
  // Scoped to this data directory instance, so a reset never replays an old checkpoint.
  const checkpointKey = `zudo-local-hosted-content:${presentation.instanceId}`;
  let recovery;
  try { const saved = localStorage.getItem(checkpointKey); recovery = saved ? JSON.parse(saved) : undefined; } catch { recovery = undefined; }
  const handle = mountHostedContentEditor(document.getElementById("editor"), {
    transport, policy, selection: presentation.selection, routeId: presentation.routeId, preview, labels, recovery,
    createOperationKey: () => crypto.randomUUID(),
    persistRecovery(checkpoint) { try { localStorage.setItem(checkpointKey, JSON.stringify(checkpoint)); } catch { /* best effort per browser */ } },
  });
  handle.subscribe(state => {
    const snapshot = state.reviewedSnapshot;
    previewStatus.textContent = snapshot ? `Showing saved snapshot ${snapshot.id} (digest ${snapshot.digest.slice(0, 12)}, draft revision ${snapshot.draftRevision})`
      : "No current preview. Save, then press Preview to render the exact saved snapshot.";
    previewStatus.dataset.snapshotId = snapshot?.id ?? "";
  });
  await handle.ready;
  const adopted = new Set();
  const refresh = async () => {
    const rows = await request("/api/local/publications");
    renderArtifacts(list, rows);
    const current = handle.state.publication;
    const row = current && rows.find(item => item.publicationId === current.id);
    if (row && row.statusVersion > current.statusVersion) await handle.refreshPublication().catch(() => undefined);
    // A clean editor adopts the local integration once; edits in progress keep the ordinary conflict review.
    if (row?.status === "integrated" && !adopted.has(row.publicationId) && ["clean", "saved"].includes(handle.state.phase) && !handle.state.pending) {
      adopted.add(row.publicationId);
      await handle.refresh().catch(() => adopted.delete(row.publicationId));
    }
  };
  await refresh();
  setInterval(() => { void refresh().catch(() => undefined); }, 1000);
  Object.assign(window, { localHosted: { handle, preview, transport, refresh } });
  window.addEventListener("pagehide", () => handle.dispose(), { once: true });
}
void main().catch(error => {
  const status = document.getElementById("local-status");
  if (status) { status.textContent = error instanceof Error ? error.message : String(error); status.dataset.phase = "failed"; }
});
