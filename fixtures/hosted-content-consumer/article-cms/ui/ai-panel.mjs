/* global localStorage */
// Host-owned Content-AI panel for one Article. The browser sends only an instruction or a proposal id; the
// host's Node process resolves the account, runs the provider and owns the proposal store. The candidate is
// rendered with the host's own renderer in memory and is never saved; only a completed render of the latest
// candidate can enable a fresh Apply, and that approval lives in this page only.
import { createRemoteContentAi } from "zudo-composer/hosted-content/editor";
import { renderArticlesHtml } from "../render.mjs";

const remote = createRemoteContentAi(async (operation, payload) => {
  const response = await fetch("/api/ai", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation, payload }) });
  return response.json();
});
const display = value => value === undefined ? "—" : typeof value === "string" ? value : JSON.stringify(value);
// A pointer to this browser's last proposal per Article, so a reload finds it. The proposal and its result are
// always read back from the host; `pending` only says an Apply or Undo was sent and its answer never arrived.
const pointerKey = entry => `article-cms:content-ai:${entry.providerId}/${entry.modelId}/${entry.recordId}`;
const readPointer = entry => { try { return JSON.parse(localStorage.getItem(pointerKey(entry)) ?? "null"); } catch { return null; } };
const writePointer = (entry, value) => { try { if (value) localStorage.setItem(pointerKey(entry), JSON.stringify(value)); else localStorage.removeItem(pointerKey(entry)); } catch { /* the page still works without it */ } };
const lostConnection = error => error instanceof TypeError;

/**
 * @param {HTMLElement} container
 * `frame` is the host's candidate preview frame (render/clear by identity); `handle` returns the Article editor.
 */
export function mountArticleAiPanel(container, { h, entry, handle, frame, fieldLabel, onCommitted }) {
  const ui = { status: null, proposal: null, applied: null, undone: null, recovered: null, uncertain: null, busy: null, error: "", notice: "", render: { state: "idle" }, stale: false, disposed: false };
  let generation = 0;
  const instruction = h("textarea", { rows: "2", id: `ai-instruction-${entry.recordId}`, "aria-label": "Instruction", maxlength: "2000" });
  instruction.addEventListener("input", () => draw());
  // The instruction field is created once and never moved, so redraws keep its text, caret and focus.
  const intro = h("div"), actions = h("div"), details = h("div");
  const root = h("section", { class: "article-ai", "aria-labelledby": "ai-heading", "data-ai-entry": entry.recordId },
    h("h3", { id: "ai-heading" }, "AI proposal"), intro, h("label", { for: instruction.id }, "Instruction"), instruction, actions, details);
  container.replaceChildren(root);

  const editorBusy = () => { const state = handle()?.state; return !state || state.dirty || !!state.pending; };
  function phase() {
    if (ui.busy) return ui.busy;
    if (!ui.proposal) return "none";
    if (ui.undone) return "undone";
    if (ui.applied) return "applied";
    if (Date.now() > Date.parse(ui.proposal.expiresAt)) return "expired";
    if (ui.stale) return "stale";
    return ui.render.state === "rendered" ? "ready" : ui.render.state === "failed" ? "render-failed" : "rendering";
  }
  const phaseText = {
    none: "", preparing: "Preparing a proposal…", rendering: "Rendering the candidate with this site's renderer — Apply is available once it has rendered.",
    ready: "Ready for review — not applied.", stale: "Stale — the content changed after this proposal was prepared. Prepare it again.",
    expired: "Expired — this proposal was never applied. Prepare it again.", "render-failed": "Render failed — Apply stays unavailable.",
    applying: "Applying…", undoing: "Undoing…", recovering: "The connection was lost. Checking what the host committed…",
    applied: "Applied as a new revision.", undone: "Undone; the previous values were restored as a new revision.",
  };
  const uncertainText = kind => `An earlier ${kind === "apply" ? "Apply" : "Undo"} was sent but its answer never arrived, and the host shows no committed result for it yet. It is never resent automatically; check again, or act again yourself — the same operation can only commit once.`;

  function draw() {
    if (ui.disposed) return;
    const current = phase(), inference = ui.status?.configured ? ui.status.inference : null;
    const blockedByEditor = editorBusy();
    // Prepare needs a known, usable provider; off, unavailable or a status that never loaded keeps it disabled.
    const canPrepare = !ui.busy && (inference?.state === "ready" || inference?.state === "unknown") && instruction.value.trim() && !blockedByEditor;
    intro.replaceChildren(...[h("p", { class: "article-ai-note" }, `Edits only the Title and Body. Nothing is written until you apply it, and publishing stays separate. Provider: ${ui.status?.configured ? ui.status.provider : "…"}.`),
      inference && inference.state !== "ready" ? h("p", { role: "status", class: "article-ai-inference", "data-ai-inference": inference.state === "unavailable" ? inference.code : inference.state }, `New proposals are unavailable: ${inference.message}`) : null,
      blockedByEditor ? h("p", { class: "article-ai-note", "data-ai-blocked": "editor" }, "Save your edits first; AI proposals work on saved content.") : null].filter(Boolean));
    actions.replaceChildren(h("div", { class: "article-ai-actions" }, h("button", { type: "button", disabled: !canPrepare, onclick: () => { void prepare(); } }, ui.proposal && ["stale", "expired"].includes(current) ? "Prepare again" : "Prepare proposal")));
    const children = [];
    if (ui.error) children.push(h("p", { role: "alert", class: "article-ai-error" }, ui.error));
    if (ui.notice) children.push(h("p", { role: "alert", class: "article-ai-error" }, ui.notice));
    if (ui.uncertain && ui.proposal) children.push(h("div", { class: "article-ai-uncertain", "data-ai-uncertain": ui.uncertain },
      h("p", { role: "status" }, uncertainText(ui.uncertain)),
      h("button", { type: "button", disabled: !!ui.busy, onclick: () => { void checkAgain(); } }, "Check again")));
    const proposal = ui.proposal;
    if (proposal) {
      const recovered = ui.recovered ? " (recovered the committed operation)" : "";
      children.push(h("div", { class: "article-ai-proposal", "data-proposal-id": proposal.id, "data-ai-phase": current },
        h("p", { role: "status", "aria-label": "AI proposal status" }, `${phaseText[current]}${["applied", "undone"].includes(current) ? recovered : ""} ${proposal.summary}`),
        h("table", { class: "article-diff", "aria-label": "Proposed changes" }, h("tr", {}, h("th", {}, "Field"), h("th", {}, "Current"), h("th", {}, "Proposed")),
          proposal.differences.map(item => h("tr", { "data-field": item.fieldId }, h("td", {}, fieldLabel(item.fieldId)), h("td", {}, display(item.before)), h("td", {}, display(item.after))))),
        h("div", { class: "article-ai-actions" },
          !ui.applied ? h("button", { type: "button", disabled: current !== "ready" || !ui.status?.canApply || blockedByEditor, onclick: () => { void run("apply"); } }, "Apply proposal")
            : !ui.undone ? h("button", { type: "button", disabled: !!ui.busy || !ui.status?.canApply || blockedByEditor, onclick: () => { void run("undo"); } }, "Undo AI change") : null),
        ui.status && !ui.status.canApply ? h("p", { class: "article-ai-note" }, "This account may prepare proposals but not apply or undo them.") : null));
    }
    details.replaceChildren(...children.filter(Boolean));
  }

  /** Renders the latest candidate; any newer proposal, Article change or dispose supersedes it. */
  async function renderCandidate() {
    const proposal = ui.proposal, current = ++generation;
    if (!proposal || ui.applied) { frame.clear(null, "No candidate."); return; }
    ui.render = { state: "pending" }; draw();
    try {
      const response = await fetch(`/api/ai/candidate?id=${encodeURIComponent(proposal.id)}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? "The candidate could not be prepared.");
      if (current !== generation || ui.proposal?.id !== proposal.id) return;
      if (data.proposalId !== proposal.id || data.candidateDigest !== proposal.candidateDigest) throw new Error("The host rendered another candidate.");
      ui.stale = data.stale;
      await frame.render(null, `candidate:${data.identity}`, renderArticlesHtml(data.renderData), `candidate ${proposal.id.slice(0, 8)} on /${data.route}`);
      if (current !== generation || ui.proposal?.id !== proposal.id) return;
      ui.render = { state: "rendered", identity: data.identity };
    } catch (error) {
      if (current !== generation) return;
      ui.render = { state: error?.code === "superseded" ? "pending" : "failed", message: error.message };
    }
    draw();
  }
  function adopt(operation) {
    ui.proposal = operation.proposal; ui.applied = operation.applied; ui.undone = operation.undone;
    ui.render = { state: "idle" }; ui.stale = false;
  }
  async function prepare() {
    ui.busy = "preparing"; ui.error = ""; ui.notice = ""; ui.recovered = null; ui.uncertain = null; generation++; draw();
    try {
      const result = await remote.prepare({ entry, instruction: instruction.value });
      if (ui.disposed) return;
      if (result.status === "refused") { ui.proposal = null; ui.notice = `Declined: ${result.message}`; writePointer(entry, null); }
      else { adopt({ proposal: result.proposal, applied: null, undone: null }); writePointer(entry, { proposalId: result.proposal.id, pending: null }); }
    } catch (error) { if (!ui.disposed) ui.error = error.message; }
    finally { ui.busy = null; }
    draw();
    if (ui.proposal && !ui.applied) await renderCandidate();
  }
  /** Reads what the host committed for this proposal; never a model call. */
  async function readBack(proposalId = ui.proposal.id) {
    const operation = await remote.read({ proposalId });
    adopt(operation);
    return operation;
  }
  async function run(kind) {
    const proposal = ui.proposal;
    ui.busy = kind === "apply" ? "applying" : "undoing"; ui.error = ""; ui.recovered = null; ui.uncertain = null; draw();
    writePointer(entry, { proposalId: proposal.id, pending: kind });
    let unreachable = false;
    try {
      const outcome = kind === "apply" ? await remote.apply({ proposalId: proposal.id, renderedCandidate: ui.render.identity }) : await remote.undo({ proposalId: proposal.id });
      ui.recovered = outcome.recovered ? kind : null;
      await readBack();
      writePointer(entry, { proposalId: proposal.id, pending: null });
      await onCommitted();
    } catch (error) {
      if (lostConnection(error)) {
        // The request may have committed. Keep the pointer and read the result back instead of resending blindly.
        ui.busy = "recovering"; draw();
        try { await reconcile(proposal.id, kind); }
        catch { unreachable = true; ui.error = "The host is unreachable. Reload when it is back; the operation will be recovered, not repeated."; }
      } else { ui.error = `Not ${kind === "apply" ? "applied" : "undone"}: ${error.message}`; writePointer(entry, { proposalId: proposal.id, pending: null }); }
    } finally { ui.busy = null; }
    draw();
    if (!ui.applied && !unreachable) await renderCandidate();
  }
  /**
   * Reads what the host committed for a pending Apply or Undo. Only a committed receipt settles it; a read
   * without one leaves the pointer pending, because the lost request could still commit. Never resends.
   */
  async function reconcile(proposalId, kind) {
    await readBack(proposalId);
    if (kind === "apply" ? ui.applied : ui.undone) {
      ui.recovered = kind; ui.uncertain = null;
      writePointer(entry, { proposalId, pending: null });
      await onCommitted();
    } else { ui.uncertain = kind; writePointer(entry, { proposalId, pending: kind }); }
  }
  async function checkAgain() {
    const kind = ui.uncertain, proposalId = ui.proposal?.id;
    if (!kind || !proposalId) return;
    ui.busy = "recovering"; ui.error = ""; draw();
    try { await reconcile(proposalId, kind); }
    catch (error) { ui.error = lostConnection(error) ? "The host is unreachable; nothing was resent." : `The saved proposal could not be read: ${error.message}`; }
    finally { ui.busy = null; }
    draw();
    if (ui.proposal && !ui.applied) await renderCandidate();
  }
  /** After a reload: read the proposal back and settle an Apply or Undo whose answer was lost, read-only. */
  async function restore() {
    const pointer = readPointer(entry);
    if (!pointer) return;
    try {
      if (pointer.pending) await reconcile(pointer.proposalId, pointer.pending);
      else await readBack(pointer.proposalId);
    } catch (error) {
      // Only a definite "no such proposal for this account" forgets the pointer; any other failure keeps it.
      if (error?.code === "not-found") { ui.proposal = null; writePointer(entry, null); }
      else { ui.proposal = null; ui.error = `The saved proposal could not be read: ${error.message}`; }
    }
  }

  const ready = (async () => {
    try { ui.status = await remote.status(); } catch (error) { ui.status = null; ui.error = `Content-AI is unavailable: ${error.message}`; }
    draw();
    if (!ui.status?.configured) return;
    await restore();
    draw();
    if (ui.proposal && !ui.applied) await renderCandidate();
  })();
  return {
    ready,
    /** The Article's saved content changed: re-check the candidate against it and drop the old approval. */
    contentChanged() { if (ui.proposal && !ui.applied && !ui.busy) void renderCandidate(); else draw(); },
    editorChanged() { draw(); },
    dispose() { ui.disposed = true; generation++; frame.clear(null, "No candidate."); container.replaceChildren(); },
    get state() { return { phase: phase(), proposalId: ui.proposal?.id ?? null, render: ui.render, stale: ui.stale }; },
  };
}
