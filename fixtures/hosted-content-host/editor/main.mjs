// @ts-check
/* global document, window, fetch */
// The host's private admin page: the restricted editor over the host's own
// transport. Only the Worker decides; this page merely presents its policy.
import { CONTENT_EDITOR_LABELS_JA, mountContentEditor } from "zudo-composer/content-editor";
import { BASELINE_REVISION, policy, project } from "../site.mjs";

/** @param {string} path @param {unknown} [body] */
async function call(path, body) {
  const response = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return response.json();
}

/** @type {import("zudo-composer/content-editor").MountContentEditorOptions["storage"]} */
const storage = {
  read: () => call("/api/draft"),
  apply: (input) => call("/api/apply", input),
  readReceipt: (operationId) => call(`/api/receipts/${encodeURIComponent(operationId)}`),
  snapshot: (input) => call("/api/snapshot", input),
};

const root = document.querySelector("#editor");
if (!root) throw new Error("Missing #editor");
const handle = mountContentEditor(root, { project: { id: project.id, label: "コース" }, revision: BASELINE_REVISION, policy, storage, labels: CONTENT_EDITOR_LABELS_JA });
// Exposed for the browser proof only.
Object.assign(window, { __contentEditor: handle });
