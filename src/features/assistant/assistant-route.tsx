import { batch, computed, getScope, Show, signal } from "@takazudo/zfb/zudo-react";
import type { RouteServicesProps } from "../../app/services";
import { formatIntent, notifyRouteSelection } from "../../app/route-intents";
import type { SitemapNode } from "../../sitemapper/model/types";
import { NativePageFrame } from "../native-editing/page-frame";
import { hostDocumentAvailable, assistantConfig, assistantEvents, assistantRequest, nativeEditRequest } from "../native-editing/session";
import type { NativeInspection } from "../native-editing/types";
import { LiveSelect, watch, when } from "../native-editing/live";
import type { ComposerPreviewSnapshot, ReviewAnnotatedMessage } from "../composer/preview/protocol";
import { subscribePersistenceChanges } from "../../shared/persistence-generation";
import { ChatPanel, type Attachment, type LiveRun } from "./chat-panel";
import { createDraftRefreshController } from "./draft-refresh";
import { ReviewPanel } from "./review-panel";
import { MemoryDialog } from "./memory-dialog";
import { annotationId, buildReviewAnnotations } from "./review-model";
import type { AssistantStatus, ChatMessage, Conversation, ConversationSummary, DraftChange, DraftView, MessageContext, PageRef, RunRecord } from "./types";
import { HostAssistantRoute } from "./host-assistant-route";
import "./assistant.css";

const keyOf = (page: PageRef) => `${page.sitemapId}/${page.pageId}`;
const read = <T,>(key: string, fallback: T): T => { try { const value = sessionStorage.getItem(key); return value ? JSON.parse(value) as T : fallback; } catch { return fallback; } };
const write = (key: string, value: unknown) => { try { if (value === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* storage is a convenience only */ } };
/** Handoff read once by Composer so returning keeps the same selected block. */
export const RETURN_SELECTION_KEY = "zudo-composer-return-selection";

export function AssistantRoute({ services }: RouteServicesProps) { return hostDocumentAvailable ? <HostAssistantRoute services={services} /> : <OrdinaryAssistantRoute services={services} />; }

function OrdinaryAssistantRoute({ services }: RouteServicesProps) {
  const scope = getScope();
  const alive = () => !scope.abortSignal.aborted;
  const integration = services.workspace.integration;
  const workspaceId = integration.workspace.id!;
  const prefix = `zudo-assistant:${workspaceId}`;
  const pages = signal<{ sitemapId: string; pageId: string; title: string }[]>([]);
  const pageKey = signal("");
  const page = computed(() => pages.value.find(value => keyOf(value) === pageKey.value));
  const status = signal<AssistantStatus | null>(null);
  const statusError = signal<string | null>(null);
  const inspection = signal<NativeInspection | null>(null);
  const pageError = signal<string | null>(null);
  const draft = signal<DraftView | null>(null);
  const view = signal<"current" | "draft">("draft");
  const selecting = signal(true);
  const selection = signal<MessageContext["selection"]>(null);
  const renderedSnapshot = signal<ComposerPreviewSnapshot | null>(null);
  const evidence = signal<ReadonlySet<string>>(new Set());
  const annotated = signal<{ key: string; results: ReviewAnnotatedMessage["results"] } | null>(null);
  const focus = signal<{ id: string; nonce: number } | null>(null);
  let pendingFocus: string | null = null;
  const conversations = signal<ConversationSummary[]>([]);
  const conversationId = signal<string | null>(read(`${prefix}:conversation`, null));
  const conversation = signal<Conversation | null>(null);
  const retainedInput = read<{ text: string; attachments: Attachment[]; turnId?: string }>(`${prefix}:input`, { text: "", attachments: [] });
  const inputText = signal(retainedInput.text);
  const attachments = signal<Attachment[]>(retainedInput.attachments);
  const turnId = signal<string | undefined>(retainedInput.turnId);
  const sharePage = signal(true);
  const live = signal<LiveRun | null>(null);
  const chatBusy = signal(false);
  const chatError = signal<string | null>(null);
  const reviewBusy = signal(false);
  const reviewError = signal<string | null>(null);
  const dependents = signal<{ change: DraftChange; items: { id: string; kind: string; reason: string | null }[] } | null>(null);
  const memoryOpen = signal(false);
  const images = signal<{ id: string; name: string }[]>([]);
  // Apply and Undo reload every authoring tab under a new write epoch; the narrow view must come back where it was.
  const tab = signal<"conversation" | "page">(read<unknown>(`${prefix}:tab`, null) === "page" ? "page" : "conversation");
  const setTab = (value: "conversation" | "page") => { tab.value = value; write(`${prefix}:tab`, value); };
  const siteName = computed(() => status.value?.siteName ?? "this site");
  // The retained input (text, attachments, turn id) survives reloads during a reply.
  scope.effect(() => { write(`${prefix}:input`, { text: inputText.value, attachments: attachments.value, ...(turnId.value ? { turnId: turnId.value } : {}) }); });

  // ── loading ───────────────────────────────────────────────────────────
  const refreshStatus = () => assistantRequest<AssistantStatus>("status", workspaceId).then(value => { if (alive()) batch(() => { status.value = value; statusError.value = null; }); }, cause => { if (alive()) statusError.value = cause.message; });
  const draftReads = createDraftRefreshController(value => { if (alive()) draft.value = value; }, cause => { if (alive()) reviewError.value = cause instanceof Error ? cause.message : "Draft could not be refreshed."; });
  scope.onCleanup(() => draftReads.dispose());
  const refreshDraft = () => draftReads.refresh(() => assistantRequest<DraftView>("draft", workspaceId));
  let inspectSequence = 0;
  const refreshInspection = () => {
    const current = page.value;
    if (!current) return;
    const sequence = ++inspectSequence;
    void nativeEditRequest<NativeInspection>("inspect", { workspaceId, sitemapId: current.sitemapId, page: current.pageId }).then(value => { if (alive() && inspectSequence === sequence) batch(() => { inspection.value = value; pageError.value = null; }); }, cause => { if (alive() && inspectSequence === sequence) pageError.value = cause.message; });
  };
  const refreshConversations = async () => {
    const list = await assistantRequest<ConversationSummary[]>("conversations", workspaceId);
    if (alive()) conversations.value = list;
    return list;
  };
  // Only selectConversation moves this; it never lags behind a switch the way captured state can.
  let conversationRef = conversationId.value;
  const loadConversation = async (id: string) => {
    const value = await assistantRequest<Conversation>("conversation", workspaceId, { conversationId: id });
    if (alive() && id === conversationRef) conversation.value = value;
  };
  const selectConversation = (id: string | null) => {
    conversationRef = id;
    batch(() => { conversationId.value = id; conversation.value = null; });
    write(`${prefix}:conversation`, id);
    if (id) void loadConversation(id).catch(cause => { if (alive()) chatError.value = cause.message; });
  };
  const choosePage = (key: string) => {
    pageKey.value = key;
    const [sitemapId, pageId] = key.split("/");
    history.replaceState(null, "", formatIntent({ route: "composer", mode: "assistant", sitemapId, pageId }));
    notifyRouteSelection("replace");
  };

  // ── runs ──────────────────────────────────────────────────────────────
  let streamAbort: AbortController | null = null;
  const follow = async (runId: string, runConversationId: string) => {
    streamAbort?.abort();
    const controller = new AbortController(); streamAbort = controller;
    write(`${prefix}:run`, { runId, conversationId: runConversationId });
    let last = 0, failures = 0, finished = false, proposalTimer: ReturnType<typeof setTimeout> | undefined;
    const updateLive = (next: (current: LiveRun) => LiveRun) => { const current = live.value; if (current && current.runId === runId) live.value = next(current); };
    live.value = { runId, conversationId: runConversationId, text: "", phase: "Thinking…", tools: [], status: "running" };
    while (!finished && !controller.signal.aborted) {
      try {
        await assistantEvents(workspaceId, runId, last, event => {
          last = Math.max(last, event.seq);
          if (event.type === "text") updateLive(current => ({ ...current, text: current.text + String(event.data.delta ?? ""), status: "running" }));
          // Provider progress is real activity (e.g. "Codex CLI started"); model calls show as Thinking.
          else if (event.type === "status") updateLive(current => ({ ...current, phase: event.data.phase === "provider" && typeof event.data.activity === "string" ? `${event.data.activity}…` : "Thinking…", status: "running" }));
          else if (event.type === "tool") updateLive(current => ({ ...current, phase: event.data.status === "running" ? toolPhase(String(event.data.name)) : current.phase, status: "running" }));
          if (event.type === "proposal" || event.type === "remembered") { clearTimeout(proposalTimer); proposalTimer = setTimeout(() => { if (!alive()) return; void refreshDraft(); void refreshStatus(); }, 100); }
          if (event.type === "done") finished = true;
        }, controller.signal);
        if (!finished) {
          // The stream closed: confirm the durable run status instead of assuming success.
          const record = await assistantRequest<RunRecord>("run", workspaceId, { runId });
          finished = record.status !== "running";
          if (!finished) throw new Error("stream closed early");
        }
      } catch {
        if (controller.signal.aborted) return;
        failures++;
        updateLive(current => ({ ...current, status: "reconnecting" }));
        if (failures > 6) { chatError.value = "The reply stream was lost. Reload to see the saved result."; break; }
        await new Promise(resolve => setTimeout(resolve, Math.min(4000, 500 * failures)));
      }
    }
    if (controller.signal.aborted) return;
    write(`${prefix}:run`, null);
    if (live.value?.runId === runId) live.value = null;
    void refreshConversations(); void refreshDraft(); void refreshStatus();
    if (conversationRef === runConversationId) void loadConversation(runConversationId);
  };
  scope.onActivate(() => {
    void integration.getCurrentSiteProject({ flushSessions: false }).then(result => {
      if (!alive()) return;
      if (result.status !== "ready") { pageError.value = result.error.message; return; }
      const flatten = (nodes: SitemapNode[]): SitemapNode[] => nodes.flatMap(node => [node, ...flatten(node.children)]);
      const values = result.project.providers.sitemaps.flatMap(provider => provider.records.flatMap(record => flatten(record.document.root).map(node => ({ sitemapId: record.id, pageId: node.id, title: node.title || node.id }))));
      const params = new URLSearchParams(window.location.search);
      const requested = `${params.get("sitemap")}/${params.get("page")}`;
      batch(() => { pages.value = values; pageKey.value = values.some(value => keyOf(value) === requested) ? requested : values[0] ? keyOf(values[0]) : ""; });
    }).catch(cause => { if (alive()) pageError.value = cause.message; });
    void integration.assetProvider?.store?.list().then(values => { if (alive()) images.value = values.filter(value => value.state === "active" && value.mimeType.startsWith("image/")).map(value => ({ id: value.id, name: value.fileName })); }).catch(() => {});
    void refreshStatus(); void refreshDraft();
    void refreshConversations().then(async list => {
      if (!alive()) return;
      let id = conversationRef && list.some(entry => entry.id === conversationRef) ? conversationRef : list[0]?.id ?? null;
      if (!id) { id = (await assistantRequest<Conversation>("createConversation", workspaceId)).id; if (!alive()) return; void refreshConversations(); }
      selectConversation(id);
    }).catch(cause => { if (alive()) chatError.value = cause.message; });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const invalidate = () => { clearTimeout(timer); timer = setTimeout(() => { refreshInspection(); void refreshDraft(); }, 150); };
    window.addEventListener("native-authoring-invalidated", invalidate);
    const unsubscribe = subscribePersistenceChanges(invalidate);
    // Reload or server-driven tab refresh during a reply: replay the run from sequence 0.
    const pending = read<{ runId: string; conversationId: string } | null>(`${prefix}:run`, null);
    if (pending) void follow(pending.runId, pending.conversationId);
    return () => { clearTimeout(timer); window.removeEventListener("native-authoring-invalidated", invalidate); unsubscribe(); streamAbort?.abort(); };
  });
  watch(scope, () => [pageKey.value] as const, ([key]) => {
    if (!key) return;
    batch(() => { inspection.value = null; annotated.value = null; selection.value = read(`${prefix}:selection:${key}`, null); });
    refreshInspection();
  });
  // Synchronous guard: a double click or repeated Enter cannot start two turns before state re-renders.
  let sending = false;
  const context = computed((): MessageContext => ({
    page: sharePage.value && page.value ? { sitemapId: page.value.sitemapId, pageId: page.value.pageId, title: page.value.title } : null,
    selection: sharePage.value ? selection.value : null,
    payloadIds: attachments.value.map(attachment => attachment.id),
  }));
  const send = async () => {
    // A shared page must be resolved before sending; never silently send "no page".
    // The plain variable is the authoritative selection; signal state can lag a conversation switch.
    const target = conversationRef, text = inputText.value;
    if (!target || !text.trim() || chatBusy.value || live.value || (sharePage.value && !page.value) || sending) return;
    sending = true;
    batch(() => { chatBusy.value = true; chatError.value = null; });
    // A retried submit after a lost response reuses its turn id; the server returns the original run.
    const turn = turnId.value ?? crypto.randomUUID();
    turnId.value = turn;
    try {
      const turnContext = context.value;
      const started = await assistantRequest<{ runId: string; conversationId: string }>("start", workspaceId, { conversationId: target, clientTurnId: turn, text, context: turnContext });
      if (!alive()) return;
      batch(() => { inputText.value = ""; attachments.value = []; turnId.value = undefined; });
      void loadConversation(target);
      void follow(started.runId, started.conversationId);
    } catch (cause) { if (alive()) chatError.value = cause instanceof Error ? cause.message : "The message was not sent. It is kept here."; }
    finally { sending = false; if (alive()) chatBusy.value = false; }
  };
  const retry = async (message: ChatMessage) => {
    const current = conversation.value;
    const user = current?.messages.find(candidate => candidate.role === "user" && candidate.turnId === message.turnId);
    const target = conversationRef;
    if (!user || !target || user.id && current?.id !== target) return;
    batch(() => { chatBusy.value = true; chatError.value = null; });
    try {
      const started = await assistantRequest<{ runId: string; conversationId: string }>("start", workspaceId, { conversationId: target, clientTurnId: user.turnId, text: user.text, context: user.context ?? { page: null, selection: null, payloadIds: [] }, retryOfRunId: message.runId });
      if (alive()) void follow(started.runId, started.conversationId);
    } catch (cause) { if (alive()) chatError.value = cause instanceof Error ? cause.message : "Retry failed."; }
    finally { if (alive()) chatBusy.value = false; }
  };

  // ── preview snapshot and review annotations ───────────────────────────
  const open = computed(() => draft.value?.draft?.status === "open" ? draft.value.draft : null);
  const draftPage = computed(() => open.value?.pages.find(entry => keyOf(entry.page) === pageKey.value && entry.changed));
  const pageChanges = computed(() => open.value?.changes.filter(change => keyOf(change.page) === pageKey.value) ?? []);
  const showDraft = computed(() => view.value === "draft" && !!draftPage.value);
  const fields = new Map(integration.componentProvider.manifest.components.flatMap(component => component.fields.map(field => [`${component.id}\0${field.prop}`, field] as const)));
  const isTextField = (componentId: string, prop: string) => {
    const field = fields.get(`${componentId}\0${prop}`);
    if (!field) return false;
    if (field.schema.type === "string") return field.editor.kind === "text" && !("format" in field.schema && field.schema.format === "url");
    return field.schema.type === "array";
  };
  const reviewKey = computed(() => `${open.value?.candidateDigest ?? open.value?.revision ?? "none"}|${pageKey.value}|${showDraft.value ? "draft" : "current"}`);
  const snapshot = computed((): ComposerPreviewSnapshot | null => {
    const current = inspection.value;
    if (!current) return null;
    const drafted = showDraft.value ? draftPage.value! : null;
    const record = drafted ? drafted.candidate : current.record;
    const linked = drafted ? drafted.linked : current.linked;
    const changes = pageChanges.value;
    return {
      document: record.document, localRecordId: record.id, ...(linked ? { linked } : {}),
      ...(changes.length ? { review: buildReviewAnnotations(changes, reviewKey.value, drafted ? "draft" : "current", isTextField) } : {}),
    };
  });
  const nativeReview = computed(() => { const value = open.value, drafted = draftPage.value; return showDraft.value && value?.candidateDigest && value.dependencyDigest && drafted ? { planId: `${value.id}:r${value.revision}`, digest: value.candidateDigest, identity: drafted.identity, dependencyDigest: value.dependencyDigest } : undefined; });
  watch(scope, () => [open.value?.candidateDigest] as const, ([digest]) => {
    const previous = evidence.value;
    if (!(digest && [...previous].every(entry => entry.startsWith(`${digest}|`)))) evidence.value = new Set();
  });
  const fallback = computed(() => { const value = annotated.value, key = reviewKey.value; return new Set(value?.key === key ? value.results.filter(result => result.words === "fallback" || !result.located).map(result => result.id) : []); });
  const onAnnotated = (message: ReviewAnnotatedMessage) => {
    annotated.value = { key: message.key, results: message.results };
    if (pendingFocus && message.results.some(result => result.id === pendingFocus)) { focus.value = { id: pendingFocus, nonce: Date.now() }; pendingFocus = null; }
  };
  const openChange = (change: DraftChange) => {
    const id = annotationId(change);
    setTab("page");
    // Keep the chosen version unless the change cannot exist there.
    const target = change.kind === "removed" ? "current" : change.kind === "added" ? "draft" : view.value;
    view.value = target;
    const marks = annotated.value;
    if (keyOf(change.page) !== pageKey.value) { pendingFocus = id; choosePage(keyOf(change.page)); }
    else if (marks?.results.some(result => result.id === id) && marks.key.endsWith(target)) focus.value = { id, nonce: Date.now() };
    else pendingFocus = id;
  };
  const allChanges = computed(() => open.value?.changes ?? []);
  const step = (direction: 1 | -1) => {
    const changes = allChanges.value;
    if (!changes.length) return;
    const groups = [...new Map(changes.map(change => [annotationId(change), change])).values()];
    const index = groups.findIndex(change => annotationId(change) === focus.value?.id);
    openChange(groups[(index + direction + groups.length) % groups.length]!);
  };

  // ── review actions ────────────────────────────────────────────────────
  const frameReady = computed(() => !!snapshot.value && renderedSnapshot.value === snapshot.value);
  const applyBlocker = computed(() => {
    const value = open.value;
    if (!value) return null;
    const unreviewed = value.pages.filter(entry => entry.changed).filter(entry => !value.candidateDigest || !evidence.value.has(`${value.candidateDigest}|${keyOf(entry.page)}`));
    return !frameReady.value ? "Wait for the displayed page to finish rendering." : draft.value?.permission !== "apply" ? "This host allows review but not Apply." : value.stale.length || !value.dependenciesCurrent ? "Revalidate before applying." : !value.changes.length ? "No changes remain." : live.value ? "Wait for the current reply to finish." : unreviewed.length ? `Open the Draft view of ${unreviewed.map(entry => entry.page.pageId).join(", ")} and let it finish rendering.` : null;
  });
  const canApply = computed(() => !!open.value?.candidateDigest && !applyBlocker.value && !reviewBusy.value);
  const act = async (action: () => Promise<unknown>, requiresFrame = false) => {
    if (requiresFrame && !frameReady.value) { reviewError.value = "Wait for the displayed page to finish rendering."; return; }
    batch(() => { reviewBusy.value = true; reviewError.value = null; });
    try { await action(); } catch (cause) { if (alive()) reviewError.value = cause instanceof Error ? cause.message : "The operation failed. Check the receipt before retrying."; }
    finally { if (alive()) { reviewBusy.value = false; void refreshDraft(); refreshInspection(); } }
  };
  const apply = () => act(async () => {
    const target = open.value!;
    // A retried click after a lost response first recovers the durable receipt.
    const recovered = await assistantRequest<{ status: string }>("receipt", workspaceId, { draftId: target.id });
    if (recovered.status === "applied") return;
    await assistantRequest("applyDraft", workspaceId, { draftId: target.id, revision: target.revision, approve: target.candidateDigest }, true);
  }, true);
  const withdraw = (change: DraftChange, cascade = false) => act(async () => {
    const target = open.value!;
    const result = await assistantRequest<DraftView | { requiresCascade: true; dependents: { id: string; kind: string; reason: string | null }[] }>("withdraw", workspaceId, { draftId: target.id, revision: target.revision, changeId: change.id, ...(cascade ? { cascade: true } : {}) });
    if (!alive()) return;
    if ("requiresCascade" in result) dependents.value = { change, items: result.dependents }; else { draftReads.accept(result); dependents.value = null; }
  });

  // ── layout ────────────────────────────────────────────────────────────
  const recordId = computed(() => inspection.value?.identity.recordId);
  const returnHref = computed(() => recordId.value ? formatIntent({ route: "composer", providerId: "files", compositionId: recordId.value }) : "/composer");
  if (!assistantConfig) return <main class="route-placeholder"><h1>AI Assistant unavailable</h1><p>Enable <code>assistant</code> and <code>nativeEditing</code> in this host's zudo-composer.config.ts and open the direct loopback authoring server. Hosted and static editors have no Assistant.</p><a href="/composer">Back to Composer</a></main>;
  const pageOptions = computed(() => pages.value.map(value => {
    const count = open.value?.changes.filter(change => keyOf(change.page) === keyOf(value)).length ?? 0;
    return { value: keyOf(value), label: `${value.title}${count ? ` (${count} change${count === 1 ? "" : "s"})` : ""}` };
  }));
  const changeCount = computed(() => open.value?.changes.length ?? 0);
  const messages = computed(() => conversation.value?.messages ?? []);
  return <main class="cms-assistant" data-mobile-tab={tab}>
    <header class="cms-assistant-top">
      <a class="cms-assistant-back" href={returnHref} on:click={() => { const id = recordId.value, chosen = selection.value; if (id && chosen) write(RETURN_SELECTION_KEY, { recordId: id, nodeId: chosen.nodeId }); }}>← Composer</a>
      <label>Page <LiveSelect aria-label="Page" options={pageOptions} value={pageKey} onChange={choosePage} /></label>
      <div class="cms-assistant-segment" role="group" aria-label="Page version">
        <button type="button" class="cms-btn cms-btn--sm" aria-pressed={computed(() => !showDraft.value)} on:click={() => { view.value = "current"; }}>Current</button>
        <button type="button" class="cms-btn cms-btn--sm" aria-pressed={showDraft} disabled={computed(() => !draftPage.value)} on:click={() => { view.value = "draft"; }}>{computed(() => `Draft${pageChanges.value.length ? ` · ${pageChanges.value.length}` : ""}`)}</button>
      </div>
      <button type="button" class="cms-btn cms-btn--sm" aria-pressed={selecting} disabled={showDraft} title={computed(() => showDraft.value ? "Switch to Current to select a block" : null)} on:click={() => { selecting.value = !selecting.value; }}>{computed(() => selecting.value ? "Select block" : "Browse page")}</button>
      <div class="cms-assistant-row" role="group" aria-label="Change navigation">
        <button type="button" class="cms-btn cms-btn--ghost cms-btn--sm" disabled={computed(() => !allChanges.value.length)} on:click={() => step(-1)}>Previous change</button>
        <button type="button" class="cms-btn cms-btn--ghost cms-btn--sm" disabled={computed(() => !allChanges.value.length)} on:click={() => step(1)}>Next change</button>
      </div>
    </header>
    <div class="cms-assistant-tabs" role="tablist" aria-label="Assistant view">
      <button type="button" role="tab" aria-selected={computed(() => tab.value === "conversation")} on:click={() => setTab("conversation")}>Conversation</button>
      <button type="button" role="tab" aria-selected={computed(() => tab.value === "page")} on:click={() => setTab("page")}>{computed(() => `Page${changeCount.value ? ` · ${changeCount.value}` : ""}`)}</button>
    </div>
    <aside class="cms-assistant-left">
      <ChatPanel status={status} statusError={statusError} conversations={conversations} conversationId={conversationId} messages={messages} live={live}
        input={inputText} attachments={attachments} context={context} sharePage={sharePage} busy={computed(() => chatBusy.value || (sharePage.value && !page.value))} error={chatError} images={images}
        onInput={() => { turnId.value = undefined; }} onSend={() => void send()} onStop={() => { const run = live.value; if (run) void assistantRequest("stop", workspaceId, { runId: run.runId }).catch(cause => { if (alive()) chatError.value = cause.message; }); }}
        onRetry={message => void retry(message)} onConversation={selectConversation}
        onNewConversation={() => {
          // Sending stays disabled until the new conversation is selected.
          chatBusy.value = true;
          void assistantRequest<Conversation>("createConversation", workspaceId).then(created => { if (!alive()) return; void refreshConversations(); selectConversation(created.id); }, cause => { if (alive()) chatError.value = cause.message; }).finally(() => { if (alive()) chatBusy.value = false; });
        }}
        onClearSelection={() => { selection.value = null; write(`${prefix}:selection:${pageKey.value}`, null); }}
        onAttach={async (payload, label) => { const record = await assistantRequest<{ id: string }>("putPayload", workspaceId, { payload }); if (!alive()) return; batch(() => { attachments.value = [...attachments.value, { id: record.id, label }]; turnId.value = undefined; }); }}
        onRemoveAttachment={id => batch(() => { attachments.value = attachments.value.filter(attachment => attachment.id !== id); turnId.value = undefined; })}
        onOpenMemory={() => { memoryOpen.value = true; }} onRename={name => void assistantRequest("rename", workspaceId, { botName: name }).then(() => refreshStatus(), cause => { if (alive()) chatError.value = cause.message; })}
        onMemoryProposal={(message, proposalId, accept) => void (async () => {
          const target = conversationRef!;
          // The revision the proposal was made against: if Memory moved since, the store refuses and asks for review.
          const baseRevision = message.memoryProposals?.find(proposal => proposal.id === proposalId)?.baseRevision ?? -1;
          await assistantRequest(accept ? "acceptMemoryProposal" : "rejectMemoryProposal", workspaceId, accept ? { conversationId: target, proposalId, expectedRevision: baseRevision } : { conversationId: target, proposalId });
          if (!alive()) return;
          void refreshStatus(); void loadConversation(target);
        })().catch(cause => { if (alive()) chatError.value = cause.message; })}
        onStageSuggestion={(_message, suggestionId) => { const target = conversationRef!; void assistantRequest("stageSuggestion", workspaceId, { conversationId: target, suggestionId, generation: draft.value?.generation ?? 0, draftId: open.value?.id ?? null }).then(() => { if (!alive()) return; void refreshDraft(); void loadConversation(target); }, cause => { if (alive()) chatError.value = cause.message; }); }}
        onShowChanges={() => { setTab("page"); view.value = "draft"; const first = allChanges.value[0]; if (first) openChange(first); }} />
    </aside>
    <section class="cms-assistant-right" aria-label="Page preview and review">
      <div class="cms-assistant-canvas">
        <Show when={when(() => pageError.value)}>{() => <p role="alert" class="cms-assistant-error">{computed(() => pageError.value ?? "")}</p>}</Show>
        <Show when={when(() => inspection.value?.writeBlockers.length)}>{() => <p role="status" class="cms-assistant-warning">{computed(() => `This page is read-only for the Assistant: ${inspection.value?.writeBlockers.join(" ") ?? ""}`)}</p>}</Show>
        <Show when={when(() => snapshot.value && inspection.value)} fallback={() => <Show when={when(() => !pageError.value)}>{() => <p role="status">Opening page…</p>}</Show>}>{() => <NativePageFrame title={computed(() => showDraft.value ? "Draft page preview" : "Current page preview")} provider={integration.componentProvider} snapshot={snapshot} review={nativeReview} selecting={computed(() => selecting.value && !showDraft.value)} identity={computed(() => inspection.value?.identity ?? null)} draftRevision={computed(() => inspection.value?.revision ?? "")}
          onRenderReady={value => { renderedSnapshot.value = value ? snapshot.value : null; }}
          onSelect={nodeId => {
            const current = inspection.value;
            const node = current?.allTargets.find(target => target.nodeId === nodeId);
            const value = { nodeId, ...(node ? { componentId: node.componentId, label: integration.componentProvider.manifest.components.find(component => component.id === node.componentId)?.title ?? node.componentId } : {}) };
            selection.value = value; write(`${prefix}:selection:${pageKey.value}`, value);
          }}
          onEvidence={value => { if (!value) return; const digest = open.value?.candidateDigest; if (digest && nativeReview.value) evidence.value = new Set([...evidence.value, `${digest}|${pageKey.value}`]); }}
          onError={message => { pageError.value = message; }} onReviewAnnotated={onAnnotated} focusAnnotation={focus} />}</Show>
      </div>
      <ReviewPanel view={draft} currentPage={pageKey} evidence={evidence} fallback={fallback} busy={reviewBusy} frameReady={frameReady} canApply={canApply} applyBlocker={applyBlocker} error={reviewError}
        onOpen={openChange} onPage={value => { view.value = "draft"; choosePage(keyOf(value)); }} onWithdraw={change => void withdraw(change)}
        onApply={() => void apply()} onDiscard={() => { const target = open.value; if (target && confirm("Discard all unstaged AI changes? Saved pages are not affected.")) void act(() => assistantRequest("discard", workspaceId, { draftId: target.id, revision: target.revision })); }}
        onRevalidate={() => { const target = open.value!; void act(() => assistantRequest("revalidate", workspaceId, { draftId: target.id, revision: target.revision })); }}
        onUndo={() => { const target = draft.value!.draft!; void act(() => assistantRequest("undoDraft", workspaceId, { draftId: target.id, approve: target.applied!.candidateDigest }, true), true); }}
        onRecover={() => void act(async () => { const target = draft.value?.draft; if (target) await assistantRequest("receipt", workspaceId, { draftId: target.id }); }, false)}
        dependents={dependents} onConfirmDependents={() => { const value = dependents.value; if (value) void withdraw(value.change, true); }} onCancelDependents={() => { dependents.value = null; }} />
    </section>
    <Show when={memoryOpen}>{() => <MemoryDialog workspaceId={workspaceId} siteName={siteName.value} onClose={() => { memoryOpen.value = false; }} onChanged={memory => { const current = status.value; if (current) status.value = { ...current, memory }; }} />}</Show>
  </main>;
}
const toolPhase = (name: string) => ({ inspect_page: "Reading the page…", list_pages: "Looking at pages…", list_components: "Checking components…", list_images: "Checking images…", read_material: "Reading your material…", propose_changes: "Preparing changes for review…", suggest_wording: "Drafting wording…", ask_clarification: "Asking a question…", remember: "Updating Memory…" } as Record<string, string>)[name] ?? "Working…";
