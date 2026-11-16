import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { useWorkspace } from "../../app/workspace-context";
import { formatIntent } from "../../app/route-intents";
import { assistantConfig, assistantEvents, assistantRequest, nativeEditRequest } from "../native-editing/session";
import { takeHostSelection } from "./host-selection";
import { pendingHostReviewIds } from "./host-review-recovery";
import { HostReviewCard } from "./host-review-card";
import type { AssistantStatus, Conversation, ConversationSummary, RunRecord } from "./types";
import type { HostSelection } from "./host-review-types";

/** Host-specific authoring uses real documents; the ordinary Preact Assistant remains separate. */
export function HostAssistantRoute() {
  const workspaceId = useWorkspace()!.integration.workspace.id ?? "";
  return <ScopedHostAssistantRoute key={workspaceId} />;
}
function ScopedHostAssistantRoute() {
  const integration = useWorkspace()!.integration, workspaceId = integration.workspace.id ?? "";
  const prefix = `zudo-host-assistant:${workspaceId}`;
  const handoff = useMemo(() => { try { return { selection: takeHostSelection(sessionStorage, workspaceId), error: null }; } catch (cause) { return { selection: null, error: cause instanceof Error ? cause.message : "Selection unavailable." }; } }, [workspaceId]);
  const [selection] = useState<HostSelection | null>(handoff.selection);
  const [retainedReviews] = useState(() => { try { return pendingHostReviewIds(localStorage, workspaceId); } catch { return []; } });
  const [status, setStatus] = useState<AssistantStatus | null>(null), [error, setError] = useState<string | null>(handoff.error);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]), [conversation, setConversation] = useState<Conversation | null>(null);
  const [text, setText] = useState(""), [busy, setBusy] = useState(false), [runId, setRunId] = useState<string | null>(null), [reply, setReply] = useState("");
  const [documentUrl, setDocumentUrl] = useState<string | null>(null);
  const turn = useRef<string | null>(null), ticket = useRef(0), stream = useRef<AbortController | null>(null), sending = useRef(false);
  const read = async (id?: string) => {
    const epoch = ticket.current;
    const [list, current] = await Promise.all([assistantRequest<ConversationSummary[]>("conversations", workspaceId, {}), id ? assistantRequest<Conversation>("conversation", workspaceId, { conversationId: id }) : Promise.resolve(null)]);
    if (epoch !== ticket.current) return;
    setConversations(list); if (current) { setConversation(current); sessionStorage.setItem(`${prefix}:conversation`, current.id); }
  };
  const follow = async (id: string, conversationId: string) => {
    stream.current?.abort(); const controller = new AbortController(); stream.current = controller;
    const epoch = ticket.current; setRunId(id); setReply("");
    sessionStorage.setItem(`${prefix}:run`, JSON.stringify({ id, conversationId }));
    try {
      await assistantEvents(workspaceId, id, 0, event => { if (epoch !== ticket.current || controller.signal.aborted) return; if (event.type === "text" && typeof event.data.delta === "string") setReply(value => value + event.data.delta); }, controller.signal);
      if (epoch !== ticket.current || controller.signal.aborted) return;
      const run = await assistantRequest<RunRecord>("run", workspaceId, { runId: id });
      if (epoch !== ticket.current || controller.signal.aborted) return;
      if (run.status === "running") throw new Error("Reply stream ended early. Recover the running reply.");
      sessionStorage.removeItem(`${prefix}:run`); setRunId(null); await read(conversationId);
      if (run.error) setError(run.error.message);
    } catch (cause) { if (!controller.signal.aborted && epoch === ticket.current) setError(cause instanceof Error ? cause.message : "Reply unavailable. Recover the saved run."); }
  };
  useEffect(() => {
    ticket.current++; const epoch = ticket.current;
    void assistantRequest<AssistantStatus>("status", workspaceId, {}).then(value => { if (epoch === ticket.current) setStatus(value); }, cause => { if (epoch === ticket.current) setError(cause.message); });
    try {
      const id = sessionStorage.getItem(`${prefix}:conversation`);
      void read(id ?? undefined).catch(cause => { if (epoch === ticket.current) setError(cause.message); });
      const pending = sessionStorage.getItem(`${prefix}:run`);
      if (pending) { const value = JSON.parse(pending); if (typeof value.id === "string" && typeof value.conversationId === "string") void follow(value.id, value.conversationId); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Recovery unavailable."); }
    if (selection) void nativeEditRequest<{ documentUrl: string }>("document-preview", { workspaceId, pathname: selection.pathname }).then(value => { if (epoch === ticket.current) setDocumentUrl(value.documentUrl); }, cause => { if (epoch === ticket.current) setError(cause.message); });
    return () => { ticket.current++; stream.current?.abort(); };
  }, [workspaceId]);
  const send = async () => {
    if (!conversation || !selection || !text.trim() || busy || runId || sending.current) return;
    sending.current = true; setBusy(true); setError(null); const epoch = ticket.current;
    try {
      turn.current ??= crypto.randomUUID();
      const result = await assistantRequest<{ runId: string; conversationId: string }>("start", workspaceId, { conversationId: conversation.id, clientTurnId: turn.current, text, context: { page: null, selection: null, payloadIds: [], hostSelection: selection } });
      if (epoch !== ticket.current) return;
      turn.current = null; setText(""); void follow(result.runId, result.conversationId);
    } catch (cause) { if (epoch === ticket.current) setError(cause instanceof Error ? cause.message : "Message retained; retry uses the same turn identity."); }
    finally { if (epoch === ticket.current) setBusy(false); sending.current = false; }
  };
  const createConversation = async () => {
    if (sending.current || busy || runId) return;
    const epoch = ticket.current; sending.current = true; setBusy(true);
    try { const value = await assistantRequest<Conversation>("createConversation", workspaceId, {}); if (epoch === ticket.current) await read(value.id); }
    catch (cause) { if (epoch === ticket.current) setError(cause instanceof Error ? cause.message : "Conversation unavailable."); }
    finally { if (epoch === ticket.current) setBusy(false); sending.current = false; }
  };
  const reviews = [...new Set([...retainedReviews, ...(conversation?.messages ?? []).flatMap(message => message.hostReviews ?? []).map(review => review.reviewId)])];
  if (!assistantConfig) return <main><h1>Host Assistant unavailable</h1><p>Configure the supported local Assistant provider to start new proposals. Existing review recovery requires the original authorized host.</p></main>;
  return <main class="cms-host-assistant"><header><h1>{status?.botName ?? "Assistant"}</h1><a href={formatIntent({ route: "composer", mode: "page", ...(selection ? { visitorUrl: selection.pathname } : {}) })}>Select a saved page component</a><p>{status ? `${status.destination.provider} · ${status.destination.model}` : "Loading provider status…"}</p>{status && !status.provider.ok && <p role="status">{status.provider.message} Existing reviews remain recoverable.</p>}</header>
    {error && <p role="alert">{error}</p>}
    {selection ? <p>Selected owner: {selection.target.providerId}/{selection.target.recordId}/{selection.target.nodeId}{selection.prop ? ` · ${selection.prop}` : " · arrangement"}. The server re-resolves this exact saved revision before proposing.</p> : <p>Select a component/property in Page authoring and choose Ask Assistant. A previous conversation never supplies implicit edit authority.</p>}
    <label>Conversation <select disabled={busy || !!runId} value={conversation?.id ?? ""} onChange={event => void read(event.currentTarget.value).catch(cause => setError(cause.message))}><option value="">Choose conversation</option>{conversations.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
    <button class="cms-btn" disabled={busy || !!runId} onClick={() => void createConversation()}>New conversation</button>
    <section aria-label="Conversation messages">{conversation?.messages.map(message => <article key={message.id}><strong>{message.role}</strong><p style={{ whiteSpace: "pre-wrap" }}>{message.text}</p></article>)}{runId && <p role="status">{reply || "Reply running…"}</p>}</section>
    <label>Request <textarea value={text} disabled={busy || !!runId} onInput={event => { setText(event.currentTarget.value); turn.current = null; }} /></label><button class="cms-btn" disabled={!selection || !conversation || !text.trim() || busy || !!runId || !status?.provider.ok} onClick={() => void send()}>Send</button>
    {runId && <><button class="cms-btn" onClick={() => void assistantRequest("stop", workspaceId, { runId }).then(() => conversation && follow(runId, conversation.id), cause => setError(cause.message))}>Stop reply</button><button class="cms-btn" onClick={() => { const value = JSON.parse(sessionStorage.getItem(`${prefix}:run`) ?? "null"); if (value) void follow(value.id, value.conversationId); }}>Recover reply</button></>}
    <p>Composition and Content changes are reviewed separately. Nothing is saved before each human Apply. Shared values are never copied into local component properties.</p>
    {reviews.map(review => <HostReviewCard key={review} reviewId={review} workspaceId={workspaceId} integration={integration} blocked={!!runId || busy} />)}
    {documentUrl && <details><summary>Saved current host page (not a candidate acknowledgement)</summary><iframe title="Saved host page" sandbox="allow-scripts allow-same-origin" src={documentUrl} /></details>}
  </main>;
}
