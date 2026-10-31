/* global document, window, crypto, setInterval, URLSearchParams */
// Host-owned Article admin. Navigation, list, perspectives, history and publication panel are host code;
// editing is the public restricted editor with one host field control. Public imports only.
import { HostedContentError } from "zudo-composer/hosted-content";
import { mountHostedContentEditor } from "zudo-composer/hosted-content/editor";
import "zudo-composer/hosted-content/editor.css";
import { renderArticlesHtml } from "../render.mjs";
import { mountArticleAiPanel } from "./ai-panel.mjs";
import "./app.css";

const provider = "articles", modelId = "article";
async function request(path, payload) {
  const response = await fetch(path, payload === undefined ? { cache: "no-store" } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const body = await response.json();
  if (!response.ok) throw body.code ? new HostedContentError(body.code, body.message ?? "Request failed", body.diagnostics, body.restoreDiagnostics) : new Error(body.message ?? `HTTP ${response.status}`);
  return body;
}
const q = value => encodeURIComponent(JSON.stringify(value));
const transport = {
  readState: () => request("/api/state"), execute: command => request("/api/execute", command),
  readReceipt: key => request(`/api/receipt?key=${encodeURIComponent(key)}`), getPublication: id => request(`/api/publication?id=${encodeURIComponent(id)}`),
  listModels: () => request("/api/models"), listEntries: query => request(`/api/entries?q=${q(query)}`), readEntry: query => request(`/api/entry?q=${q(query)}`),
  listRevisions: query => request(`/api/revisions?q=${q(query)}`), readRevision: id => request(`/api/revision?id=${encodeURIComponent(id)}`),
  compareRevisions: query => request(`/api/compare?q=${q(query)}`), readPublicationStatus: () => request("/api/publication-status"),
};

function h(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (name.startsWith("on")) node.addEventListener(name.slice(2), value);
    else if (value !== false && value !== undefined) node.setAttribute(name, value === true ? "" : value);
  }
  node.append(...children.flat().filter(child => child !== null && child !== undefined));
  return node;
}
const display = value => value === undefined ? "—" : typeof value === "string" ? value : JSON.stringify(value);
const statusLabel = { new: "New", published: "Published", changed: "Changed" };

/** The host's one custom control: the built-in text input plus a live length counter against the policy limit. */
const titleCounter = {
  matches: (field, entry) => entry.modelId === modelId && field.key === "title",
  mount(element, context) {
    const control = h("div"), counter = h("output", { "aria-label": "Title length", class: "article-counter" });
    element.append(h("div", { class: "article-title-control" }, control, counter));
    const builtIn = context.renderDefault(control);
    const show = next => {
      const length = typeof next.value === "string" ? [...next.value].length : 0, limit = next.permission.maxLength;
      counter.textContent = limit ? `${length} / ${limit}` : String(length);
      counter.dataset.over = String(!!limit && length > limit);
    };
    show(context);
    return { update(next) { builtIn.update(next); show(next); }, destroy() { builtIn.destroy(); element.replaceChildren(); } };
  },
};

/**
 * One preview frame shared by both perspectives. Every render names an exact identity, waits for the frame to load
 * that identity, and loses to any newer render or invalidation; nothing older can be shown as current.
 */
function createPreviewFrame(iframe, status) {
  let generation = 0, owner = null;
  const show = (state, label, identity = "") => {
    iframe.dataset.previewState = state; iframe.dataset.previewIdentity = identity;
    status.dataset.previewState = state; status.textContent = label;
  };
  const loaded = () => new Promise(done => iframe.addEventListener("load", done, { once: true }));
  const frame = {
    /** Proof hook: holds every render back this long, as a slow renderer would. */
    delayMs: 0,
    async render(token, identity, html, label) {
      const current = ++generation; owner = token;
      show("pending", `Rendering ${label}…`, identity);
      if (frame.delayMs) await new Promise(done => setTimeout(done, frame.delayMs));
      if (current !== generation) throw Object.assign(new Error("A newer preview replaced this render"), { code: "superseded" });
      const ready = loaded();
      iframe.srcdoc = html.replace("<head>", `<head><meta name="article-preview-identity" content="${identity.replace(/"/g, "&quot;")}">`);
      await ready;
      const shown = iframe.contentDocument?.querySelector('meta[name="article-preview-identity"]')?.getAttribute("content");
      if (current !== generation) throw Object.assign(new Error("A newer preview replaced this render"), { code: "superseded" });
      if (shown !== identity) throw Object.assign(new Error("The frame rendered another snapshot"), { code: "identity-mismatch" });
      show("rendered", label, identity);
    },
    /** Only the current owner may clear the frame; an old working session cannot wipe a published preview. */
    clear(token, label) {
      if (token !== null && token !== owner) return;
      generation++; owner = null; iframe.srcdoc = ""; show("empty", label);
    },
  };
  return frame;
}
/** The working editor's preview adapter: its state is what the session checks before Submit. */
function workingPreview(frame) {
  const listeners = new Set(), token = {};
  let state = { status: "idle" };
  const set = next => { state = next; for (const listener of listeners) listener(); };
  return {
    get state() { return state; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async render(snapshot, routeId) {
      set({ status: "pending" });
      try { await frame.render(token, `working:${snapshot.id}:${snapshot.digest}`, renderArticlesHtml(snapshot.renderData), `working snapshot ${snapshot.id.slice(0, 8)}`); }
      catch (error) { set({ status: "error" }); throw error; }
      set({ status: "rendered", result: { snapshotId: snapshot.id, snapshotDigest: snapshot.digest, draftRevision: snapshot.draftRevision, baseline: snapshot.baseline, definition: snapshot.definition, routeId } });
    },
    invalidate() { frame.clear(token, "Preview out of date. Preview the saved content again."); set({ status: "stale" }); },
    dispose() { frame.clear(token, "Not previewed."); set({ status: "disposed" }); },
  };
}

async function main() {
  const policy = await request("/api/policy");
  const models = await transport.listModels();
  const article = models.find(item => item.model.id === modelId).model;
  const view = article.document.presentation?.views.find(item => item.id === "list");
  const fieldLabel = id => article.document.fields.find(field => field.id === id)?.label ?? id;
  const pageSize = Math.min(100, Math.max(1, Number(new URLSearchParams(window.location.search).get("pageSize")) || 20));
  const app = document.getElementById("app");
  const ui = { perspective: "working", mode: "custom", selected: null, handle: null, ai: null, preview: null, compare: null, notice: "", entries: [], entriesCursor: null, revisions: [], revisionsCursor: null };
  const sameEntry = (left, right) => !!left && !!right && left.providerId === right.providerId && left.modelId === right.modelId && left.recordId === right.recordId;

  const list = h("ul", { class: "article-list", "aria-label": "Articles" });
  const moreEntries = h("div");
  const main = h("section", { class: "article-main", "aria-label": "Article" });
  const history = h("section", { class: "article-history", "aria-labelledby": "history-heading" });
  const publication = h("section", { class: "article-publication", "aria-labelledby": "publication-heading" });
  const preview = h("iframe", { title: "Article preview", sandbox: "allow-same-origin", class: "article-preview" });
  const previewStatus = h("p", { role: "status", class: "article-preview-status", "aria-label": "Preview status" });
  const frame = createPreviewFrame(preview, previewStatus);
  frame.clear(null, "Not previewed.");
  // The AI candidate gets its own frame, so reviewing it never replaces the saved-content preview.
  const candidatePreview = h("iframe", { title: "AI candidate preview", sandbox: "allow-same-origin", class: "article-candidate-preview" });
  const candidateStatus = h("p", { role: "status", class: "article-preview-status", "aria-label": "Candidate preview status" });
  const candidateFrame = createPreviewFrame(candidatePreview, candidateStatus);
  candidateFrame.clear(null, "No candidate.");
  const aiContainer = h("div", { class: "article-ai-container" });
  const perspectiveButton = perspective => h("button", { type: "button", "aria-pressed": String(ui.perspective === perspective), onclick: () => { ui.perspective = perspective; void render(); } },
    perspective === "working" ? "Working" : "Published");
  const nav = h("nav", { class: "article-nav", "aria-label": "Article CMS" });
  app.replaceChildren(h("header", { class: "article-header" }, h("strong", {}, "Article CMS"), h("span", { class: "article-local" }, "Local only — nothing here is deployed."), nav),
    h("div", { class: "article-layout" }, h("aside", {}, h("h2", {}, "Articles"), list, moreEntries), main, h("aside", {}, history, publication, h("h2", {}, "Preview"), previewStatus, preview,
      h("h2", {}, "AI candidate"), candidateStatus, candidatePreview)));

  /** The one place the selected Article changes: list clicks and the editor's own navigation both land here. */
  async function adoptSelection(entry) {
    ui.selected = entry; ui.compare = null; ui.notice = ""; ui.revisions = []; ui.revisionsCursor = null;
    // The previewed snapshot was reviewed for another selection; review it again for this one.
    ui.preview?.invalidate();
  }
  function mountEditor(entry) {
    ui.handle?.dispose(); ui.ai?.dispose(); ui.ai = null;
    const container = h("div");
    main.replaceChildren(h("h2", {}, ui.mode === "custom" ? "Edit article" : "Edit article (standard form)"), container, aiContainer);
    let key = 0;
    ui.preview = workingPreview(frame);
    // Whatever the frame showed belongs to another view; the working draft is not previewed until asked.
    frame.clear(null, "Not previewed.");
    ui.handle = mountHostedContentEditor(container, { transport, policy, selection: { entry, fieldId: "title" }, routeId: "journal", preview: ui.preview,
      createOperationKey: () => `${crypto.randomUUID()}-${++key}`, fieldRenderers: ui.mode === "custom" ? [titleCounter] : [],
      onNavigate: async next => { await adoptSelection(next.entry); await Promise.all([renderList(), renderHistory()]); } });
    let last = "";
    ui.handle.subscribe(state => {
      const marker = `${state.phase}:${state.content?.draftRevision}`;
      if (marker !== last && ["saved", "clean"].includes(state.phase)) { last = marker; void refreshSide(); ui.ai?.contentChanged(); }
      else ui.ai?.editorChanged();
    });
    // Content-AI edits the same Entry through the same Content owner and history; the editor reloads after each commit.
    const handle = ui.handle;
    ui.ai = mountArticleAiPanel(aiContainer, { h, entry, handle: () => ui.handle, frame: candidateFrame, fieldLabel,
      onCommitted: async () => { if (ui.handle === handle) await handle.refresh(); await refreshSide(); } });
    return Promise.all([ui.handle.ready, ui.ai.ready]);
  }
  async function showPublished(entry) {
    ui.handle?.dispose(); ui.handle = null; ui.preview = null; ui.ai?.dispose(); ui.ai = null;
    const site = await request("/api/published-site");
    void frame.render(null, `published:${site.baseline.gitSha}:${site.baseline.contentDigest}:${site.integrationFence}`, renderArticlesHtml(site.renderData),
      `published content ${site.baseline.gitSha.slice(0, 8)}`).catch(() => undefined);
    if (!entry) { main.replaceChildren(h("p", {}, "Select an article.")); return; }
    let view;
    try { view = await transport.readEntry({ perspective: "published", entry }); }
    catch (error) { main.replaceChildren(h("p", { role: "status" }, error.code === "not-found" ? "Not published yet." : error.message)); return; }
    const groups = article.document.presentation?.groups ?? [{ id: "all", label: "Fields", fieldIds: article.document.fields.map(field => field.id) }];
    main.replaceChildren(h("h2", {}, "Published version"), ...groups.map(group => h("section", { "data-group": group.id }, h("h3", {}, group.label),
      h("dl", {}, group.fieldIds.flatMap(id => [h("dt", {}, fieldLabel(id)), h("dd", { "data-field": id }, display(view.values[id]))])))));
  }
  async function renderList({ more = false } = {}) {
    const page = await transport.listEntries({ perspective: ui.perspective, providerId: provider, modelId, limit: pageSize, ...(more && ui.entriesCursor ? { cursor: ui.entriesCursor } : {}) });
    // A refresh reloads as many entries as were already shown, so paging does not collapse on every save.
    if (more) ui.entries = [...ui.entries, ...page.entries];
    else {
      let entries = page.entries, cursor = page.nextCursor;
      while (cursor && entries.length < ui.entries.length) {
        const next = await transport.listEntries({ perspective: ui.perspective, providerId: provider, modelId, limit: pageSize, cursor });
        entries = [...entries, ...next.entries]; cursor = next.nextCursor;
      }
      ui.entries = entries; page.nextCursor = cursor;
    }
    ui.entriesCursor = page.nextCursor;
    list.replaceChildren(...ui.entries.map(item => h("li", {}, h("button", { type: "button", "data-entry-id": item.entry.recordId, "aria-current": String(sameEntry(ui.selected, item.entry)),
      onclick: () => { void select(item.entry); } }, h("span", { class: "article-title" }, display(item.values[view?.fieldIds[0] ?? "title"])), " ",
    h("span", { class: "article-status", "data-status": item.status }, statusLabel[item.status])))));
    moreEntries.replaceChildren(...(ui.entriesCursor ? [h("button", { type: "button", onclick: () => { void renderList({ more: true }); } }, "Load more articles")] : []));
  }
  async function renderHistory({ more = false } = {}) {
    const target = ui.selected;
    if (!target) { history.replaceChildren(); return; }
    const page = await transport.listRevisions({ entry: target, limit: pageSize, ...(more && ui.revisionsCursor ? { cursor: ui.revisionsCursor } : {}) });
    if (!sameEntry(target, ui.selected)) return;
    if (more) ui.revisions = [...ui.revisions, ...page.revisions];
    else {
      let revisions = page.revisions, cursor = page.nextCursor;
      while (cursor && revisions.length < ui.revisions.length) {
        const next = await transport.listRevisions({ entry: target, limit: pageSize, cursor });
        revisions = [...revisions, ...next.revisions]; cursor = next.nextCursor;
      }
      if (!sameEntry(target, ui.selected)) return;
      ui.revisions = revisions; page.nextCursor = cursor;
    }
    ui.revisionsCursor = page.nextCursor;
    const rows = ui.revisions.map(revision => h("li", { "data-revision": revision.id, "data-sequence": String(revision.sequence) },
      h("span", {}, `#${revision.sequence} ${revision.operation.kind}${revision.restoredFrom ? " (restored)" : ""} · ${revision.actor?.id ?? revision.source} · ${display(revision.values.title)}`),
      h("button", { type: "button", "aria-label": `Compare revision ${revision.sequence} with working`, onclick: async () => {
        const compare = await transport.compareRevisions({ entry: target, from: { revisionId: revision.id }, to: { perspective: "working" } });
        if (sameEntry(target, ui.selected)) { ui.compare = { entry: target, ...compare }; await renderHistory(); }
      } }, "Compare"),
      ui.perspective === "working" ? h("button", { type: "button", "aria-label": `Restore revision ${revision.sequence}`, onclick: async () => {
        ui.notice = "";
        // The handle restores exactly the Entry this history belongs to, never a selection that changed since.
        try { await ui.handle.restore(target, revision.id); ui.notice = `Restored revision ${revision.sequence} as a new working revision.`; }
        catch (error) { ui.notice = error.restoreDiagnostics ? `Not restored: ${error.restoreDiagnostics.map(item => `${fieldLabel(item.fieldId)} (${item.code})`).join(", ")}` : `Not restored: ${error.message}`; }
        await refreshSide();
      } }, "Restore") : null));
    const compare = ui.compare && sameEntry(ui.compare.entry, target) ? ui.compare : null;
    const diff = compare ? h("table", { class: "article-diff", "aria-label": "Field differences", "data-history-entry": target.recordId }, h("tr", {}, h("th", {}, "Field"), h("th", {}, "Before"), h("th", {}, "After")),
      compare.differences.length ? compare.differences.map(item => h("tr", { "data-field": item.fieldId }, h("td", {}, item.label), h("td", {}, display(item.before)), h("td", {}, display(item.after))))
        : [h("tr", {}, h("td", { colspan: "3" }, "No differences"))]) : null;
    history.replaceChildren(...[h("h2", { id: "history-heading" }, "History"), h("ol", { "data-history-entry": target.recordId }, rows),
      ui.revisionsCursor ? h("button", { type: "button", onclick: () => { void renderHistory({ more: true }); } }, "Load older revisions") : null,
      diff, ui.notice ? h("p", { role: "status", class: "article-notice" }, ui.notice) : null].filter(Boolean));
  }
  let activatedFence = null;
  async function renderPublication() {
    const status = await transport.readPublicationStatus();
    // A clean editor adopts a newly activated baseline once; retained edits keep the ordinary conflict review.
    const fence = status.activated.integrationFence, state = ui.handle?.state;
    if (state?.publication && status.submission?.publicationId === state.publication.id && status.submission.statusVersion > state.publication.statusVersion) await ui.handle.refreshPublication().catch(() => undefined);
    if (activatedFence !== null && fence !== activatedFence && state && ["clean", "saved"].includes(state.phase) && !state.pending && !state.dirty) {
      const previous = activatedFence;
      activatedFence = fence;
      await ui.handle.refresh().catch(() => { activatedFence = previous; });
      void renderList();
    } else if (activatedFence === null) activatedFence = fence;
    publication.replaceChildren(h("h2", { id: "publication-heading" }, "Publication"), h("dl", {},
      h("dt", {}, "Submission"), h("dd", { "data-stage": "submission" }, status.submission ? status.submission.status : "None"),
      h("dt", {}, "Activated content"), h("dd", { "data-stage": "activated" }, `${status.activated.baseline.gitSha.slice(0, 8)} (fence ${status.activated.integrationFence})`),
      h("dt", {}, "Local artifact"), h("dd", { "data-stage": "artifact" }, status.artifact ? h("a", { href: `/artifacts/${status.artifact}/`, target: "_blank", rel: "noopener" }, "Open local artifact") : "None"),
      h("dt", {}, "Deployed"), h("dd", { "data-stage": "deployed" }, status.deployed ? "Yes" : "No (local only)")));
  }
  async function refreshSide() { await Promise.all([renderList(), renderHistory(), renderPublication()]); }
  async function select(entry) {
    if (ui.handle) await ui.handle.flush();
    await adoptSelection(entry);
    if (ui.perspective === "working") await mountEditor(entry); else await showPublished(entry);
    await refreshSide();
  }
  async function render() {
    nav.replaceChildren(perspectiveButton("working"), perspectiveButton("published"),
      h("label", {}, h("input", { type: "checkbox", checked: ui.mode === "standard", onchange: event => { ui.mode = event.currentTarget.checked ? "standard" : "custom"; void render(); } }), " Standard form"));
    ui.entries = []; ui.entriesCursor = null;
    await renderList();
    if (ui.selected) await select(ui.selected);
    else { if (ui.perspective === "published") await showPublished(null); await refreshSide(); }
  }
  await render();
  setInterval(() => { void renderPublication().catch(() => undefined); }, 1000);
  Object.assign(window, { articleCms: { get handle() { return ui.handle; }, get selected() { return ui.selected; }, get ai() { return ui.ai; }, frame, candidateFrame, transport, select } });
}
void main().catch(error => { document.getElementById("app").textContent = error instanceof Error ? error.message : String(error); });
