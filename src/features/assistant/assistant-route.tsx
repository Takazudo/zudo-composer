import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { useWorkspace } from "../../app/workspace-context";
import { formatIntent, notifyRouteSelection } from "../../app/route-intents";
import type { SitemapNode } from "../../sitemapper/model/types";
import { NativePageFrame } from "../native-editing/page-frame";
import { assistantConfig, assistantEvents, assistantRequest, nativeEditRequest } from "../native-editing/session";
import type { NativeInspection } from "../native-editing/types";
import type { ReviewAnnotatedMessage } from "../composer/preview/protocol";
import { subscribePersistenceChanges } from "../../shared/persistence-generation";
import { ChatPanel, type Attachment, type LiveRun } from "./chat-panel";
import { ReviewPanel } from "./review-panel";
import { MemoryDialog } from "./memory-dialog";
import { annotationId, buildReviewAnnotations } from "./review-model";
import type { AssistantStatus, ChatMessage, Conversation, ConversationSummary, DraftChange, DraftView, MessageContext, PageRef, RunRecord } from "./types";
import "./assistant.css";

const keyOf = (page: PageRef) => `${page.sitemapId}/${page.pageId}`;
const read = <T,>(key: string, fallback: T): T => { try { const value = sessionStorage.getItem(key); return value ? JSON.parse(value) as T : fallback; } catch { return fallback; } };
const write = (key: string, value: unknown) => { try { if (value === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* storage is a convenience only */ } };
/** Handoff read once by Composer so returning keeps the same selected block. */
export const RETURN_SELECTION_KEY = "zudo-composer-return-selection";

export function AssistantRoute() {
  const workspace = useWorkspace()!;
  const integration = workspace.integration;
  const workspaceId = integration.workspace.id!;
  const prefix = `zudo-assistant:${workspaceId}`;
  const [pages, setPages] = useState<{ sitemapId: string; pageId: string; title: string }[]>([]);
  const [pageKey, setPageKey] = useState("");
  const page = pages.find(value => keyOf(value) === pageKey);
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [inspection, setInspection] = useState<NativeInspection | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftView | null>(null);
  const [view, setView] = useState<"current" | "draft">("draft");
  const [selecting, setSelecting] = useState(true);
  const [selection, setSelection] = useState<MessageContext["selection"]>(null);
  const [evidence, setEvidence] = useState<ReadonlySet<string>>(new Set());
  const [annotated, setAnnotated] = useState<{ key: string; results: ReviewAnnotatedMessage["results"] } | null>(null);
  const [focus, setFocus] = useState<{ id: string; nonce: number } | null>(null);
  const pendingFocus = useRef<string | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(() => read(`${prefix}:conversation`, null));
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [input, setInput] = useState(() => read<{ text: string; attachments: Attachment[]; turnId?: string }>(`${prefix}:input`, { text: "", attachments: [] }));
  const [sharePage, setSharePage] = useState(true);
  const [live, setLive] = useState<LiveRun | null>(null);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [dependents, setDependents] = useState<{ change: DraftChange; items: { id: string; kind: string; reason: string | null }[] } | null>(null);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [images, setImages] = useState<{ id: string; name: string }[]>([]);
  const [tab, setTab] = useState<"conversation" | "page">("conversation");
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const siteName = status?.siteName ?? "this site";
  type InputState = typeof input;
  const saveInput = (value: InputState | ((current: InputState) => InputState)) => setInput(current => {
    const next = typeof value === "function" ? value(current) : value;
    write(`${prefix}:input`, next);
    return next;
  });

  // ── loading ───────────────────────────────────────────────────────────
  useEffect(() => {
    let current = true;
    void integration.getCurrentSiteProject({ flushSessions: false }).then(result => {
      if (!current) return;
      if (result.status !== "ready") { setPageError(result.error.message); return; }
      const flatten = (nodes: SitemapNode[]): SitemapNode[] => nodes.flatMap(node => [node, ...flatten(node.children)]);
      const values = result.project.providers.sitemaps.flatMap(provider => provider.records.flatMap(record => flatten(record.document.root).map(node => ({ sitemapId: record.id, pageId: node.id, title: node.title || node.id }))));
      setPages(values);
      const params = new URLSearchParams(window.location.search);
      const requested = `${params.get("sitemap")}/${params.get("page")}`;
      setPageKey(values.some(value => keyOf(value) === requested) ? requested : values[0] ? keyOf(values[0]) : "");
    }).catch(cause => { if (current) setPageError(cause.message); });
    void integration.assetProvider?.store?.list().then(values => { if (current) setImages(values.filter(value => value.state === "active" && value.mimeType.startsWith("image/")).map(value => ({ id: value.id, name: value.fileName }))); }).catch(() => {});
    return () => { current = false; };
  }, [integration]);
  const refreshStatus = useCallback(() => assistantRequest<AssistantStatus>("status", workspaceId).then(value => { if (mounted.current) { setStatus(value); setStatusError(null); } }, cause => { if (mounted.current) setStatusError(cause.message); }), [workspaceId]);
  const refreshDraft = useCallback(() => assistantRequest<DraftView>("draft", workspaceId).then(value => { if (mounted.current) setDraft(value); return value; }, cause => { if (mounted.current) setReviewError(cause.message); return null; }), [workspaceId]);
  const inspectSequence = useRef(0);
  const refreshInspection = useCallback(() => {
    if (!page) return;
    const sequence = ++inspectSequence.current;
    void nativeEditRequest<NativeInspection>("inspect", { workspaceId, sitemapId: page.sitemapId, page: page.pageId }).then(value => { if (mounted.current && inspectSequence.current === sequence) { setInspection(value); setPageError(null); } }, cause => { if (mounted.current && inspectSequence.current === sequence) setPageError(cause.message); });
  }, [page, workspaceId]);
  const refreshConversations = useCallback(async () => {
    const list = await assistantRequest<ConversationSummary[]>("conversations", workspaceId);
    if (!mounted.current) return list;
    setConversations(list);
    return list;
  }, [workspaceId]);
  const loadConversation = useCallback(async (id: string) => {
    const value = await assistantRequest<Conversation>("conversation", workspaceId, { conversationId: id });
    if (mounted.current && id === conversationRef.current) setConversation(value);
  }, [workspaceId]);
  // Only selectConversation moves this; it never lags behind a switch the way captured state can.
  const conversationRef = useRef(conversationId);
  useEffect(() => { void refreshStatus(); void refreshDraft(); }, [refreshStatus, refreshDraft]);
  useEffect(() => {
    void refreshConversations().then(async list => {
      let id = conversationRef.current && list.some(entry => entry.id === conversationRef.current) ? conversationRef.current : list[0]?.id ?? null;
      if (!id) { id = (await assistantRequest<Conversation>("createConversation", workspaceId)).id; void refreshConversations(); }
      selectConversation(id);
    }).catch(cause => setChatError(cause.message));
  }, [workspaceId]);
  useEffect(() => {
    if (!pageKey) return;
    setInspection(null); setAnnotated(null);
    setSelection(read(`${prefix}:selection:${pageKey}`, null));
    refreshInspection();
  }, [pageKey]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const invalidate = () => { clearTimeout(timer); timer = setTimeout(() => { refreshInspection(); void refreshDraft(); }, 150); };
    window.addEventListener("native-authoring-invalidated", invalidate);
    const unsubscribe = subscribePersistenceChanges(invalidate);
    return () => { clearTimeout(timer); window.removeEventListener("native-authoring-invalidated", invalidate); unsubscribe(); };
  }, [refreshInspection, refreshDraft]);
  const selectConversation = (id: string | null) => { setConversationId(id); conversationRef.current = id; write(`${prefix}:conversation`, id); setConversation(null); if (id) void loadConversation(id).catch(cause => setChatError(cause.message)); };
  const choosePage = (key: string) => {
    setPageKey(key);
    const [sitemapId, pageId] = key.split("/");
    history.replaceState(null, "", formatIntent({ route: "composer", mode: "assistant", sitemapId, pageId }));
    notifyRouteSelection("replace");
  };

  // ── runs ──────────────────────────────────────────────────────────────
  const streamAbort = useRef<AbortController | null>(null);
  const follow = useCallback(async (runId: string, runConversationId: string) => {
    streamAbort.current?.abort();
    const controller = new AbortController(); streamAbort.current = controller;
    write(`${prefix}:run`, { runId, conversationId: runConversationId });
    let last = 0, failures = 0, finished = false, proposalTimer: ReturnType<typeof setTimeout> | undefined;
    setLive({ runId, conversationId: runConversationId, text: "", phase: "Thinking…", tools: [], status: "running" });
    while (!finished && !controller.signal.aborted) {
      try {
        await assistantEvents(workspaceId, runId, last, event => {
          last = Math.max(last, event.seq);
          setLive(current => {
            if (!current || current.runId !== runId) return current;
            if (event.type === "text") return { ...current, text: current.text + String(event.data.delta ?? ""), status: "running" };
            if (event.type === "status") return { ...current, phase: "Thinking…", status: "running" };
            if (event.type === "tool") return { ...current, phase: event.data.status === "running" ? toolPhase(String(event.data.name)) : current.phase, status: "running" };
            return current;
          });
          if (event.type === "proposal" || event.type === "remembered") { clearTimeout(proposalTimer); proposalTimer = setTimeout(() => { void refreshDraft(); void refreshStatus(); }, 100); }
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
        setLive(current => current && current.runId === runId ? { ...current, status: "reconnecting" } : current);
        if (failures > 6) { setChatError("The reply stream was lost. Reload to see the saved result."); break; }
        await new Promise(resolve => setTimeout(resolve, Math.min(4000, 500 * failures)));
      }
    }
    if (controller.signal.aborted) return;
    write(`${prefix}:run`, null);
    setLive(current => current?.runId === runId ? null : current);
    void refreshConversations(); void refreshDraft(); void refreshStatus();
    if (conversationRef.current === runConversationId) void loadConversation(runConversationId);
  }, [workspaceId]);
  useEffect(() => {
    // Reload or server-driven tab refresh during a reply: replay the run from sequence 0.
    const pending = read<{ runId: string; conversationId: string } | null>(`${prefix}:run`, null);
    if (pending) void follow(pending.runId, pending.conversationId);
    return () => streamAbort.current?.abort();
  }, [follow]);
  const context = (): MessageContext => ({
    page: sharePage && page ? { sitemapId: page.sitemapId, pageId: page.pageId, title: page.title } : null,
    selection: sharePage ? selection : null,
    payloadIds: input.attachments.map(attachment => attachment.id),
  });
  const send = async () => {
    // A shared page must be resolved before sending; never silently send "no page".
    // The ref is the authoritative selection; render-captured state can lag a conversation switch.
    const target = conversationRef.current;
    if (!target || !input.text.trim() || chatBusy || live || (sharePage && !page)) return;
    setChatBusy(true); setChatError(null);
    // A retried submit after a lost response reuses its turn id; the server returns the original run.
    const turnId = input.turnId ?? crypto.randomUUID();
    saveInput({ ...input, turnId });
    try {
      const turnContext = context();
      const started = await assistantRequest<{ runId: string; conversationId: string }>("start", workspaceId, { conversationId: target, clientTurnId: turnId, text: input.text, context: turnContext });
      saveInput({ text: "", attachments: [] });
      void loadConversation(target);
      void follow(started.runId, started.conversationId);
    } catch (cause) { setChatError(cause instanceof Error ? cause.message : "The message was not sent. It is kept here."); }
    finally { setChatBusy(false); }
  };
  const retry = async (message: ChatMessage) => {
    const user = conversation?.messages.find(candidate => candidate.role === "user" && candidate.turnId === message.turnId);
    const target = conversationRef.current;
    if (!user || !target || user.id && conversation?.id !== target) return;
    setChatBusy(true); setChatError(null);
    try {
      const started = await assistantRequest<{ runId: string; conversationId: string }>("start", workspaceId, { conversationId: target, clientTurnId: user.turnId, text: user.text, context: user.context ?? { page: null, selection: null, payloadIds: [] }, retryOfRunId: message.runId });
      void follow(started.runId, started.conversationId);
    } catch (cause) { setChatError(cause instanceof Error ? cause.message : "Retry failed."); }
    finally { setChatBusy(false); }
  };

  // ── preview snapshot and review annotations ───────────────────────────
  const open = draft?.draft?.status === "open" ? draft.draft : null;
  const draftPage = open?.pages.find(entry => keyOf(entry.page) === pageKey && entry.changed);
  const pageChanges = useMemo(() => open?.changes.filter(change => keyOf(change.page) === pageKey) ?? [], [open, pageKey]);
  const showDraft = view === "draft" && !!draftPage;
  const isTextField = useMemo(() => {
    const fields = new Map(integration.componentProvider.manifest.components.flatMap(component => component.fields.map(field => [`${component.id}\0${field.prop}`, field] as const)));
    return (componentId: string, prop: string) => {
      const field = fields.get(`${componentId}\0${prop}`);
      if (!field) return false;
      if (field.schema.type === "string") return field.editor.kind === "text" && !("format" in field.schema && field.schema.format === "url");
      return field.schema.type === "array";
    };
  }, [integration]);
  const reviewKey = `${open?.candidateDigest ?? open?.revision ?? "none"}|${pageKey}|${showDraft ? "draft" : "current"}`;
  const snapshot = useMemo(() => {
    if (!inspection) return null;
    const record = showDraft ? draftPage!.candidate : inspection.record;
    const linked = showDraft ? draftPage!.linked : inspection.linked;
    return {
      document: record.document, localRecordId: record.id, ...(linked ? { linked } : {}),
      ...(pageChanges.length ? { review: buildReviewAnnotations(pageChanges, reviewKey, showDraft ? "draft" : "current", isTextField) } : {}),
    };
  }, [inspection, showDraft, draftPage, pageChanges, reviewKey, isTextField]);
  const nativeReview = useMemo(() => showDraft && open?.candidateDigest && open.dependencyDigest ? { planId: `${open.id}:r${open.revision}`, digest: open.candidateDigest, identity: draftPage!.identity, dependencyDigest: open.dependencyDigest } : undefined, [showDraft, open, draftPage]);
  useEffect(() => { setEvidence(previous => open?.candidateDigest && [...previous].every(entry => entry.startsWith(`${open.candidateDigest}|`)) ? previous : new Set()); }, [open?.candidateDigest]);
  const fallback = useMemo(() => new Set(annotated?.key === reviewKey ? annotated.results.filter(result => result.words === "fallback" || !result.located).map(result => result.id) : []), [annotated, reviewKey]);
  const onAnnotated = (message: ReviewAnnotatedMessage) => {
    setAnnotated({ key: message.key, results: message.results });
    if (pendingFocus.current && message.results.some(result => result.id === pendingFocus.current)) { setFocus({ id: pendingFocus.current, nonce: Date.now() }); pendingFocus.current = null; }
  };
  const openChange = (change: DraftChange) => {
    const id = annotationId(change);
    setTab("page");
    // Keep the chosen version unless the change cannot exist there.
    const target = change.kind === "removed" ? "current" : change.kind === "added" ? "draft" : view;
    setView(target);
    if (keyOf(change.page) !== pageKey) { pendingFocus.current = id; choosePage(keyOf(change.page)); }
    else if (annotated?.results.some(result => result.id === id) && annotated.key.endsWith(target)) setFocus({ id, nonce: Date.now() });
    else pendingFocus.current = id;
  };
  const allChanges = open?.changes ?? [];
  const step = (direction: 1 | -1) => {
    if (!allChanges.length) return;
    const groups = [...new Map(allChanges.map(change => [annotationId(change), change])).values()];
    const index = groups.findIndex(change => annotationId(change) === focus?.id);
    openChange(groups[(index + direction + groups.length) % groups.length]!);
  };

  // ── review actions ────────────────────────────────────────────────────
  const changedPages = open?.pages.filter(entry => entry.changed) ?? [];
  const unreviewed = changedPages.filter(entry => !open?.candidateDigest || !evidence.has(`${open.candidateDigest}|${keyOf(entry.page)}`));
  const applyBlocker = !open ? null : draft?.permission !== "apply" ? "This host allows review but not Apply." : open.stale.length || !open.dependenciesCurrent ? "Revalidate before applying." : !open.changes.length ? "No changes remain." : live ? "Wait for the current reply to finish." : unreviewed.length ? `Open the Draft view of ${unreviewed.map(entry => entry.page.pageId).join(", ")} and let it finish rendering.` : null;
  const canApply = !!open?.candidateDigest && !applyBlocker && !reviewBusy;
  const act = async (action: () => Promise<unknown>) => {
    setReviewBusy(true); setReviewError(null);
    try { await action(); } catch (cause) { setReviewError(cause instanceof Error ? cause.message : "The operation failed. Check the receipt before retrying."); }
    finally { setReviewBusy(false); void refreshDraft(); refreshInspection(); }
  };
  const apply = () => act(async () => {
    const target = open!;
    // A retried click after a lost response first recovers the durable receipt.
    const recovered = await assistantRequest<{ status: string }>("receipt", workspaceId, { draftId: target.id });
    if (recovered.status === "applied") return;
    await assistantRequest("applyDraft", workspaceId, { draftId: target.id, revision: target.revision, approve: target.candidateDigest }, true);
  });
  const withdraw = (change: DraftChange, cascade = false) => act(async () => {
    const result = await assistantRequest<DraftView | { requiresCascade: true; dependents: { id: string; kind: string; reason: string | null }[] }>("withdraw", workspaceId, { draftId: open!.id, revision: open!.revision, changeId: change.id, ...(cascade ? { cascade: true } : {}) });
    if ("requiresCascade" in result) setDependents({ change, items: result.dependents }); else setDependents(null);
  });

  // ── layout ────────────────────────────────────────────────────────────
  const recordId = inspection?.identity.recordId;
  const returnHref = recordId ? formatIntent({ route: "composer", providerId: "files", compositionId: recordId }) : "/composer";
  if (!assistantConfig) return <main class="route-placeholder"><h1>AI Assistant unavailable</h1><p>Enable <code>assistant</code> and <code>nativeEditing</code> in this host's zudo-composer.config.ts and open the direct loopback authoring server. Hosted and static editors have no Assistant.</p><a href="/composer">Back to Composer</a></main>;
  return <main class="cms-assistant" data-mobile-tab={tab}>
    <header class="cms-assistant-top">
      <a class="cms-assistant-back" href={returnHref} onClick={() => { if (recordId && selection) write(RETURN_SELECTION_KEY, { recordId, nodeId: selection.nodeId }); }}>← Composer</a>
      <label>Page <select aria-label="Page" value={pageKey} onChange={event => choosePage(event.currentTarget.value)}>{pages.map(value => {
        const count = open?.changes.filter(change => keyOf(change.page) === keyOf(value)).length ?? 0;
        return <option key={keyOf(value)} value={keyOf(value)}>{value.title}{count ? ` (${count} change${count === 1 ? "" : "s"})` : ""}</option>;
      })}</select></label>
      <div class="cms-assistant-segment" role="group" aria-label="Page version">
        <button type="button" class="cms-btn cms-btn--sm" aria-pressed={!showDraft} onClick={() => setView("current")}>Current</button>
        <button type="button" class="cms-btn cms-btn--sm" aria-pressed={showDraft} disabled={!draftPage} onClick={() => setView("draft")}>Draft{pageChanges.length ? ` · ${pageChanges.length}` : ""}</button>
      </div>
      <button type="button" class="cms-btn cms-btn--sm" aria-pressed={selecting} disabled={showDraft} title={showDraft ? "Switch to Current to select a block" : undefined} onClick={() => setSelecting(!selecting)}>{selecting ? "Select block" : "Browse page"}</button>
      <div class="cms-assistant-row" role="group" aria-label="Change navigation">
        <button type="button" class="cms-btn cms-btn--ghost cms-btn--sm" disabled={!allChanges.length} onClick={() => step(-1)}>Previous change</button>
        <button type="button" class="cms-btn cms-btn--ghost cms-btn--sm" disabled={!allChanges.length} onClick={() => step(1)}>Next change</button>
      </div>
    </header>
    <div class="cms-assistant-tabs" role="tablist" aria-label="Assistant view">
      <button type="button" role="tab" aria-selected={tab === "conversation"} onClick={() => setTab("conversation")}>Conversation</button>
      <button type="button" role="tab" aria-selected={tab === "page"} onClick={() => setTab("page")}>Page{open?.changes.length ? ` · ${open.changes.length}` : ""}</button>
    </div>
    <aside class="cms-assistant-left">
      <ChatPanel status={status} statusError={statusError} siteName={siteName} conversations={conversations} conversationId={conversationId} messages={conversation?.messages ?? []} live={live}
        input={input.text} attachments={input.attachments} context={context()} sharePage={sharePage} busy={chatBusy || (sharePage && !page)} error={chatError} images={images}
        onInput={text => saveInput(current => ({ ...current, text, turnId: undefined }))} onSend={() => void send()} onStop={() => { if (live) void assistantRequest("stop", workspaceId, { runId: live.runId }).catch(cause => setChatError(cause.message)); }}
        onRetry={message => void retry(message)} onConversation={selectConversation}
        onNewConversation={() => {
          // Sending stays disabled until the new conversation is selected.
          setChatBusy(true);
          void assistantRequest<Conversation>("createConversation", workspaceId).then(created => { void refreshConversations(); selectConversation(created.id); }, cause => setChatError(cause.message)).finally(() => setChatBusy(false));
        }}
        onSharePage={setSharePage} onClearSelection={() => { setSelection(null); write(`${prefix}:selection:${pageKey}`, null); }}
        onAttach={async (payload, label) => { const record = await assistantRequest<{ id: string }>("putPayload", workspaceId, { payload }); saveInput(current => ({ ...current, attachments: [...current.attachments, { id: record.id, label }], turnId: undefined })); }}
        onRemoveAttachment={id => saveInput(current => ({ ...current, attachments: current.attachments.filter(attachment => attachment.id !== id), turnId: undefined }))}
        onOpenMemory={() => setMemoryOpen(true)} onRename={name => void assistantRequest("rename", workspaceId, { botName: name }).then(() => refreshStatus(), cause => setChatError(cause.message))}
        onMemoryProposal={(_message, proposalId, accept) => void (async () => {
          const memory = await assistantRequest<{ revision: number }>("memory", workspaceId);
          const target = conversationRef.current!;
          await assistantRequest(accept ? "acceptMemoryProposal" : "rejectMemoryProposal", workspaceId, accept ? { conversationId: target, proposalId, expectedRevision: memory.revision } : { conversationId: target, proposalId });
          void refreshStatus(); void loadConversation(target);
        })().catch(cause => setChatError(cause.message))}
        onStageSuggestion={(_message, suggestionId) => { const target = conversationRef.current!; void assistantRequest("stageSuggestion", workspaceId, { conversationId: target, suggestionId, generation: draft?.generation ?? 0, draftId: open?.id ?? null }).then(() => { void refreshDraft(); void loadConversation(target); }, cause => setChatError(cause.message)); }}
        onShowChanges={() => { setTab("page"); setView("draft"); if (allChanges[0]) openChange(allChanges[0]); }} />
    </aside>
    <section class="cms-assistant-right" aria-label="Page preview and review">
      <div class="cms-assistant-canvas">
        {pageError && <p role="alert" class="cms-assistant-error">{pageError}</p>}
        {inspection?.writeBlockers.length ? <p role="status" class="cms-assistant-warning">This page is read-only for the Assistant: {inspection.writeBlockers.join(" ")}</p> : null}
        {snapshot && inspection ? <NativePageFrame title={showDraft ? "Draft page preview" : "Current page preview"} provider={integration.componentProvider} snapshot={snapshot} review={nativeReview} selecting={selecting && !showDraft} identity={inspection.identity} draftRevision={inspection.revision}
          onSelect={nodeId => {
            const node = inspection.allTargets.find(target => target.nodeId === nodeId);
            const value = { nodeId, ...(node ? { componentId: node.componentId, label: integration.componentProvider.manifest.components.find(component => component.id === node.componentId)?.title ?? node.componentId } : {}) };
            setSelection(value); write(`${prefix}:selection:${pageKey}`, value);
          }}
          onEvidence={value => { if (value && open?.candidateDigest && nativeReview) setEvidence(previous => new Set([...previous, `${open.candidateDigest}|${pageKey}`])); }}
          onError={message => setPageError(message)} onReviewAnnotated={onAnnotated} focusAnnotation={focus} /> : !pageError && <p role="status">Opening page…</p>}
      </div>
      <ReviewPanel view={draft} currentPage={pageKey} evidence={evidence} fallback={fallback} busy={reviewBusy} canApply={canApply} applyBlocker={applyBlocker} error={reviewError}
        onOpen={openChange} onPage={value => { setView("draft"); choosePage(keyOf(value)); }} onWithdraw={change => void withdraw(change)}
        onApply={() => void apply()} onDiscard={() => { if (confirm("Discard all unstaged AI changes? Saved pages are not affected.")) void act(() => assistantRequest("discard", workspaceId, { draftId: open!.id, revision: open!.revision })); }}
        onRevalidate={() => void act(() => assistantRequest("revalidate", workspaceId, { draftId: open!.id, revision: open!.revision }))}
        onUndo={() => void act(() => assistantRequest("undoDraft", workspaceId, { draftId: draft!.draft!.id, approve: draft!.draft!.applied!.candidateDigest }, true))}
        onRecover={() => void act(async () => { if (draft?.draft) await assistantRequest("receipt", workspaceId, { draftId: draft.draft.id }); })}
        dependents={dependents} onConfirmDependents={() => { if (dependents) void withdraw(dependents.change, true); }} onCancelDependents={() => setDependents(null)} />
    </section>
    {memoryOpen && <MemoryDialog workspaceId={workspaceId} siteName={siteName} onClose={() => setMemoryOpen(false)} onChanged={memory => setStatus(current => current ? { ...current, memory } : current)} />}
  </main>;
}
const toolPhase = (name: string) => ({ inspect_page: "Reading the page…", list_pages: "Looking at pages…", list_components: "Checking components…", list_images: "Checking images…", read_material: "Reading your material…", propose_changes: "Preparing changes for review…", suggest_wording: "Drafting wording…", ask_clarification: "Asking a question…", remember: "Updating Memory…" } as Record<string, string>)[name] ?? "Working…";
