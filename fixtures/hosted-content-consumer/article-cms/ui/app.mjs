/* global document, window, crypto, setInterval */
// Host-owned Article admin. Navigation, list, perspectives, history and publication panel are host code;
// editing is the public restricted editor with one host field control. Public imports only.
import { HostedContentError } from "zudo-composer/hosted-content";
import { mountHostedContentEditor } from "zudo-composer/hosted-content/editor";
import "zudo-composer/hosted-content/editor.css";
import { renderArticlesHtml } from "../render.mjs";
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

async function main() {
  const policy = await request("/api/policy");
  const models = await transport.listModels();
  const article = models.find(item => item.model.id === modelId).model;
  const view = article.document.presentation?.views.find(item => item.id === "list");
  const fieldLabel = id => article.document.fields.find(field => field.id === id)?.label ?? id;
  const app = document.getElementById("app");
  const ui = { perspective: "working", mode: "custom", selected: null, handle: null, compare: null, notice: "" };

  const list = h("ul", { class: "article-list", "aria-label": "Articles" });
  const main = h("section", { class: "article-main", "aria-label": "Article" });
  const history = h("section", { class: "article-history", "aria-labelledby": "history-heading" });
  const publication = h("section", { class: "article-publication", "aria-labelledby": "publication-heading" });
  const preview = h("iframe", { title: "Article preview", sandbox: "", class: "article-preview" });
  const perspectiveButton = perspective => h("button", { type: "button", "aria-pressed": String(ui.perspective === perspective), onclick: () => { ui.perspective = perspective; void render(); } },
    perspective === "working" ? "Working" : "Published");
  const nav = h("nav", { class: "article-nav", "aria-label": "Article CMS" });
  app.replaceChildren(h("header", { class: "article-header" }, h("strong", {}, "Article CMS"), h("span", { class: "article-local" }, "Local only — nothing here is deployed."), nav),
    h("div", { class: "article-layout" }, h("aside", {}, h("h2", {}, "Articles"), list), main, h("aside", {}, history, publication, h("h2", {}, "Preview"), preview)));

  const editorPreview = { async render(snapshot) { preview.srcdoc = renderArticlesHtml(snapshot.renderData); } };
  function mountEditor(entry) {
    ui.handle?.dispose();
    const container = h("div");
    main.replaceChildren(h("h2", {}, ui.mode === "custom" ? "Edit article" : "Edit article (standard form)"), container);
    let key = 0;
    ui.handle = mountHostedContentEditor(container, { transport, policy, selection: { entry, fieldId: "title" }, routeId: "journal", preview: editorPreview,
      createOperationKey: () => `${crypto.randomUUID()}-${++key}`, fieldRenderers: ui.mode === "custom" ? [titleCounter] : [] });
    let last = "";
    ui.handle.subscribe(state => {
      const marker = `${state.phase}:${state.content?.draftRevision}`;
      if (marker !== last && ["saved", "clean"].includes(state.phase)) { last = marker; void refreshSide(); }
    });
    return ui.handle.ready;
  }
  async function showPublished(entry) {
    ui.handle?.dispose(); ui.handle = null;
    let view;
    try { view = await transport.readEntry({ perspective: "published", entry }); }
    catch (error) { main.replaceChildren(h("p", { role: "status" }, error.code === "not-found" ? "Not published yet." : error.message)); return; }
    const groups = article.document.presentation?.groups ?? [{ id: "all", label: "Fields", fieldIds: article.document.fields.map(field => field.id) }];
    main.replaceChildren(h("h2", {}, "Published version"), ...groups.map(group => h("section", { "data-group": group.id }, h("h3", {}, group.label),
      h("dl", {}, group.fieldIds.flatMap(id => [h("dt", {}, fieldLabel(id)), h("dd", { "data-field": id }, display(view.values[id]))])))));
  }
  async function renderList() {
    const page = await transport.listEntries({ perspective: ui.perspective, providerId: provider, modelId, limit: 50 });
    list.replaceChildren(...page.entries.map(item => h("li", {}, h("button", { type: "button", "data-entry-id": item.entry.recordId, "aria-current": String(ui.selected?.recordId === item.entry.recordId),
      onclick: () => { void select(item.entry); } }, h("span", { class: "article-title" }, display(item.values[view?.fieldIds[0] ?? "title"])), " ",
    h("span", { class: "article-status", "data-status": item.status }, statusLabel[item.status])))));
  }
  async function renderHistory() {
    if (!ui.selected) { history.replaceChildren(); return; }
    const page = await transport.listRevisions({ entry: ui.selected, limit: 20 });
    const rows = page.revisions.map(revision => h("li", { "data-revision": revision.id, "data-sequence": String(revision.sequence) },
      h("span", {}, `#${revision.sequence} ${revision.operation.kind}${revision.restoredFrom ? " (restored)" : ""} · ${revision.actor?.id ?? revision.source} · ${display(revision.values.title)}`),
      h("button", { type: "button", "aria-label": `Compare revision ${revision.sequence} with working`, onclick: async () => {
        ui.compare = await transport.compareRevisions({ entry: ui.selected, from: { revisionId: revision.id }, to: { perspective: "working" } }); await renderHistory();
      } }, "Compare"),
      ui.perspective === "working" ? h("button", { type: "button", "aria-label": `Restore revision ${revision.sequence}`, onclick: async () => {
        ui.notice = "";
        try { await ui.handle.restore(ui.selected, revision.id); ui.notice = `Restored revision ${revision.sequence} as a new working revision.`; }
        catch (error) { ui.notice = error.restoreDiagnostics ? `Not restored: ${error.restoreDiagnostics.map(item => `${fieldLabel(item.fieldId)} (${item.code})`).join(", ")}` : `Not restored: ${error.message}`; }
        await refreshSide();
      } }, "Restore") : null));
    const diff = ui.compare ? h("table", { class: "article-diff", "aria-label": "Field differences" }, h("tr", {}, h("th", {}, "Field"), h("th", {}, "Before"), h("th", {}, "After")),
      ui.compare.differences.length ? ui.compare.differences.map(item => h("tr", { "data-field": item.fieldId }, h("td", {}, item.label), h("td", {}, display(item.before)), h("td", {}, display(item.after))))
        : [h("tr", {}, h("td", { colspan: "3" }, "No differences"))]) : null;
    history.replaceChildren(...[h("h2", { id: "history-heading" }, "History"), h("ol", {}, rows), diff, ui.notice ? h("p", { role: "status", class: "article-notice" }, ui.notice) : null].filter(Boolean));
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
    ui.selected = entry; ui.compare = null; ui.notice = "";
    if (ui.perspective === "working") await mountEditor(entry); else await showPublished(entry);
    await refreshSide();
  }
  async function render() {
    nav.replaceChildren(perspectiveButton("working"), perspectiveButton("published"),
      h("label", {}, h("input", { type: "checkbox", checked: ui.mode === "standard", onchange: event => { ui.mode = event.currentTarget.checked ? "standard" : "custom"; void render(); } }), " Standard form"));
    await renderList();
    if (ui.selected) await select(ui.selected); else await refreshSide();
  }
  await render();
  setInterval(() => { void renderPublication().catch(() => undefined); }, 1000);
  Object.assign(window, { articleCms: { get handle() { return ui.handle; }, transport, select } });
}
void main().catch(error => { document.getElementById("app").textContent = error instanceof Error ? error.message : String(error); });
