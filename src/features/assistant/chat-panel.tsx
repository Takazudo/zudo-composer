import { useEffect, useRef, useState } from "preact/hooks";
import { isCompositionEnter } from "../native-editing/request";
import type { AssistantStatus, ChatMessage, ConversationSummary, MessageContext } from "./types";

export interface Attachment { id: string; label: string }
export interface LiveRun { runId: string; conversationId: string; text: string; phase: string; tools: string[]; status: "running" | "reconnecting" }
export interface ChatPanelProps {
  status: AssistantStatus | null; statusError: string | null; siteName: string;
  conversations: ConversationSummary[]; conversationId: string | null; messages: ChatMessage[]; live: LiveRun | null;
  input: string; attachments: Attachment[]; context: MessageContext; sharePage: boolean; busy: boolean; error: string | null;
  images: { id: string; name: string }[];
  onInput(value: string): void; onSend(): void; onStop(): void; onRetry(message: ChatMessage): void;
  onConversation(id: string): void; onNewConversation(): void; onSharePage(value: boolean): void; onClearSelection(): void;
  onAttach(payload: { kind: "text"; text: string } | { kind: "table"; columns: string[]; rows: string[][] } | { kind: "image"; assetId: string; alt: string }, label: string): Promise<void>;
  onRemoveAttachment(id: string): void; onOpenMemory(): void; onRename(name: string | null): void;
  onMemoryProposal(message: ChatMessage, proposalId: string, accept: boolean): void; onStageSuggestion(message: ChatMessage, suggestionId: string): void; onShowChanges(): void;
}

function memoryChip(message: ChatMessage) {
  const used = message.memory;
  if (!used) return null;
  const label = used.status === "used" ? `Used Memory r${used.revision}` : used.status === "empty" ? "Memory empty" : used.status === "off" ? "Memory off" : "Memory unavailable";
  return <span class="cms-assistant-chip" title="Memory revision read immediately before this reply">{label}</span>;
}

function AttachForm({ images, onAttach, onDone }: { images: ChatPanelProps["images"]; onAttach: ChatPanelProps["onAttach"]; onDone(): void }) {
  const [kind, setKind] = useState<"text" | "table" | "image">("text");
  const [text, setText] = useState(""), [assetId, setAssetId] = useState(""), [alt, setAlt] = useState(""), [emptyAlt, setEmptyAlt] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setError(null);
    try {
      if (kind === "text") { if (!text) throw new Error("Enter the exact text."); await onAttach({ kind, text }, `Exact text: ${text.slice(0, 24)}${text.length > 24 ? "…" : ""}`); }
      else if (kind === "table") {
        const value = JSON.parse(text) as { columns?: unknown; rows?: unknown };
        if (!Array.isArray(value.columns) || !Array.isArray(value.rows) || value.rows.some(row => !Array.isArray(row) || row.length !== (value.columns as unknown[]).length)) throw new Error("Use {\"columns\": [...], \"rows\": [[...]]} with one cell per column.");
        await onAttach({ kind, columns: value.columns.map(String), rows: (value.rows as unknown[][]).map(row => row.map(String)) }, `Table: ${value.columns.length}×${value.rows.length}`);
      } else { if (!assetId) throw new Error("Choose an image."); if (!emptyAlt && !alt) throw new Error("Describe the image, or mark the alternative text as intentionally empty."); await onAttach({ kind, assetId, alt: emptyAlt ? "" : alt }, `Image: ${images.find(image => image.id === assetId)?.name ?? assetId}`); }
      onDone();
    } catch (cause) { setError(cause instanceof SyntaxError ? "The table must be valid JSON." : cause instanceof Error ? cause.message : "Could not attach."); }
  };
  return <fieldset class="cms-assistant-attach">
    <legend>Attach exact material</legend>
    <p class="cms-assistant-hint">The Assistant must use attached material exactly as supplied.</p>
    <label>Kind <select value={kind} onChange={event => setKind(event.currentTarget.value as typeof kind)}><option value="text">Exact text</option><option value="table">Table</option><option value="image">Managed image</option></select></label>
    {kind === "image" ? <>
      <label>Image <select value={assetId} onChange={event => setAssetId(event.currentTarget.value)}><option value="">Choose an image</option>{images.map(image => <option key={image.id} value={image.id}>{image.name}</option>)}</select></label>
      <label>Alternative text <input value={alt} disabled={emptyAlt} onInput={event => setAlt(event.currentTarget.value)} /></label>
      <label><input type="checkbox" checked={emptyAlt} onChange={event => setEmptyAlt(event.currentTarget.checked)} /> Intentionally empty alternative text</label>
    </> : <label>{kind === "text" ? "Exact text" : "Table JSON"}<textarea rows={4} value={text} onKeyDown={event => { if (isCompositionEnter(event)) event.stopPropagation(); }} onInput={event => setText(event.currentTarget.value)} placeholder={kind === "table" ? "{\"columns\":[\"Item\",\"Value\"],\"rows\":[[\"Qty\",\"3\"]]}" : ""} /></label>}
    {error && <p role="alert" class="cms-assistant-error">{error}</p>}
    <div class="cms-assistant-row"><button type="button" class="cms-btn cms-btn--sm" onClick={() => void submit()}>Attach</button><button type="button" class="cms-btn cms-btn--ghost cms-btn--sm" onClick={onDone}>Cancel</button></div>
  </fieldset>;
}

/** Conversation and advice. Validated changes appear in the review panel, never as chat text. */
export function ChatPanel(props: ChatPanelProps) {
  const list = useRef<HTMLOListElement>(null);
  const [attaching, setAttaching] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const botName = props.status?.botName ?? "AI Assistant";
  const configured = props.status?.provider.ok === true;
  const running = !!props.live && props.live.conversationId === props.conversationId;
  useEffect(() => { list.current?.lastElementChild?.scrollIntoView({ block: "end" }); }, [props.messages.length, props.live?.text]);
  return <section class="cms-assistant-chat" aria-label={`${botName} conversation`}>
    <header class="cms-assistant-chat__header">
      {renaming === null
        ? <h1 class="cms-assistant-chat__title">{botName} <button type="button" class="cms-assistant-link" aria-label={`Rename ${botName}`} onClick={() => setRenaming(botName)}>Rename</button></h1>
        : <form class="cms-assistant-row" onSubmit={event => { event.preventDefault(); props.onRename(renaming.trim() ? renaming.trim() : null); setRenaming(null); }}>
          <label>Assistant name <input value={renaming} maxLength={40} onInput={event => setRenaming(event.currentTarget.value)} /></label>
          <button type="submit" class="cms-btn cms-btn--sm">Save</button><button type="button" class="cms-btn cms-btn--ghost cms-btn--sm" onClick={() => setRenaming(null)}>Cancel</button>
          <button type="button" class="cms-btn cms-btn--ghost cms-btn--sm" onClick={() => { props.onRename(null); setRenaming(null); }}>Use default</button>
        </form>}
      <div class="cms-assistant-row">
        <label class="cms-assistant-grow">Conversation <select value={props.conversationId ?? ""} onChange={event => props.onConversation(event.currentTarget.value)} disabled={props.busy}>
          {!props.conversations.length && <option value="">No conversations yet</option>}
          {props.conversations.map(conversation => <option key={conversation.id} value={conversation.id}>{conversation.title}</option>)}
        </select></label>
        <button type="button" class="cms-btn cms-btn--sm" disabled={props.busy} onClick={props.onNewConversation}>New</button>
        <button type="button" class="cms-btn cms-btn--ghost cms-btn--sm" onClick={props.onOpenMemory}>Memory{props.status ? ` · ${props.status.memory.mode === "read-only" ? "Read only" : props.status.memory.mode === "auto" ? "Auto" : "Off"}` : ""}</button>
      </div>
    </header>
    {props.statusError && <p role="alert" class="cms-assistant-error">{props.statusError}</p>}
    {props.status && !props.status.provider.ok && <div role="status" class="cms-assistant-warning"><p><strong>AI replies are unavailable.</strong> {props.status.provider.message}</p><p class="cms-assistant-hint">Composer, review, Memory and saved conversations keep working.</p></div>}
    <ol class="cms-assistant-messages" ref={list} aria-live="polite" aria-label="Messages">
      {!props.messages.length && !running && <li class="cms-assistant-empty">Ask about this page, or request a specific change. Changes wait for your review; nothing is saved until you choose Apply to Composer.</li>}
      {props.messages.map(message => <li key={message.id} class="cms-assistant-message" data-role={message.role}>
        <p class="cms-assistant-message__who">{message.role === "user" ? "You" : botName}{message.role === "assistant" && memoryChip(message)}{message.outcome && message.outcome !== "completed" && <span class="cms-assistant-chip" data-tone="warning">{message.outcome === "stopped" ? "Stopped" : message.outcome === "failed" ? "Failed" : "Interrupted"}</span>}</p>
        {message.text ? <div class="cms-assistant-message__text">{message.text}</div> : message.role === "assistant" && <p class="cms-assistant-hint">(No reply text.)</p>}
        {message.role === "user" && message.context && <p class="cms-assistant-hint">{message.context.page ? `On ${message.context.page.title ?? message.context.page.pageId}` : "No page shared"}{message.context.selection ? ` · selected ${message.context.selection.label ?? message.context.selection.nodeId}` : ""}{message.context.payloadIds.length ? ` · ${message.context.payloadIds.length} attachment(s)` : ""}</p>}
        {message.draft?.operationIds.length ? <p><button type="button" class="cms-assistant-link" onClick={props.onShowChanges}>{message.draft.operationIds.length} proposed change{message.draft.operationIds.length === 1 ? "" : "s"} · review in page</button></p> : null}
        {message.suggestions?.map(suggestion => <div key={suggestion.id} class="cms-assistant-card" data-kind="suggestion"><p class="cms-assistant-hint">Proposed wording (not in the draft)</p><p>{suggestion.text}</p>
          {suggestion.target && suggestion.status !== "staged" && <button type="button" class="cms-btn cms-btn--sm" onClick={() => props.onStageSuggestion(message, suggestion.id)}>Add to review</button>}
          {suggestion.status === "staged" && <span class="cms-assistant-chip">Added to review</span>}</div>)}
        {message.memoryProposals?.map(proposal => <div key={proposal.id} class="cms-assistant-card" data-kind="memory"><p class="cms-assistant-hint">Memory update proposal</p><p>{proposal.change.kind === "append" ? `Add: “${proposal.change.text}”` : `Replace “${proposal.change.find}” with “${proposal.change.text}”`}</p>
          {proposal.status === "pending" ? <div class="cms-assistant-row"><button type="button" class="cms-btn cms-btn--sm" onClick={() => props.onMemoryProposal(message, proposal.id, true)}>Save to Memory</button><button type="button" class="cms-btn cms-btn--ghost cms-btn--sm" onClick={() => props.onMemoryProposal(message, proposal.id, false)}>Dismiss</button></div> : <span class="cms-assistant-chip">{proposal.status === "accepted" ? `Saved as r${proposal.resolvedRevision}` : "Dismissed"}</span>}</div>)}
        {message.remembered?.map(entry => <span key={entry.revision} class="cms-assistant-chip">Remembered · Memory r{entry.revision}</span>)}
        {message.role === "assistant" && (message.outcome === "failed" || message.outcome === "interrupted" || message.outcome === "stopped") && configured && <button type="button" class="cms-assistant-link" disabled={props.busy || running} onClick={() => props.onRetry(message)}>Retry this turn</button>}
      </li>)}
      {running && <li class="cms-assistant-message" data-role="assistant" aria-busy="true"><p class="cms-assistant-message__who">{botName} <span class="cms-assistant-chip">{props.live!.status === "reconnecting" ? "Reconnecting…" : props.live!.phase}</span></p><div class="cms-assistant-message__text">{props.live!.text || "…"}</div></li>}
    </ol>
    <form class="cms-assistant-compose" onSubmit={event => { event.preventDefault(); props.onSend(); }}>
      <div class="cms-assistant-row cms-assistant-context" aria-label="Context for the next message">
        <label class="cms-assistant-chip"><input type="checkbox" checked={props.sharePage} onChange={event => props.onSharePage(event.currentTarget.checked)} /> {props.context.page || props.sharePage ? `Page: ${props.context.page?.title ?? props.context.page?.pageId ?? "current page"}` : "Share current page"}</label>
        {props.context.selection && <span class="cms-assistant-chip">Selected: {props.context.selection.label ?? props.context.selection.nodeId} <button type="button" class="cms-assistant-link" aria-label="Clear selection" onClick={props.onClearSelection}>×</button></span>}
        {props.attachments.map(attachment => <span key={attachment.id} class="cms-assistant-chip">{attachment.label} <button type="button" class="cms-assistant-link" aria-label={`Remove ${attachment.label}`} onClick={() => props.onRemoveAttachment(attachment.id)}>×</button></span>)}
        <button type="button" class="cms-assistant-link" aria-expanded={detailsOpen} onClick={() => setDetailsOpen(!detailsOpen)}>Context details</button>
      </div>
      {detailsOpen && <div class="cms-assistant-card" data-kind="context"><p class="cms-assistant-hint">Sent with your next message to {props.status?.destination.provider ?? "the configured provider"}{props.status ? ` (${props.status.destination.model})` : ""}:</p><ul>{(props.status?.destination.sends ?? []).map(item => <li key={item}>{item}</li>)}</ul><p class="cms-assistant-hint">Memory {props.status ? `revision ${props.status.memory.revision}, mode ${props.status.memory.mode}` : "status unknown"}. Credentials stay on the authoring server.</p></div>}
      {attaching && <AttachForm images={props.images} onAttach={props.onAttach} onDone={() => setAttaching(false)} />}
      <label class="cms-sr-only" for="assistant-input">Message {botName}</label>
      <textarea id="assistant-input" rows={3} value={props.input} disabled={!props.conversationId}
        placeholder={configured ? `Message ${botName}…` : "Configure the Assistant to send messages."}
        onInput={event => props.onInput(event.currentTarget.value)}
        onKeyDown={event => {
          if (isCompositionEnter(event)) { event.stopPropagation(); return; }
          if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); props.onSend(); }
        }} />
      {props.error && <p role="alert" class="cms-assistant-error">{props.error}</p>}
      <div class="cms-assistant-row">
        <button type="button" class="cms-btn cms-btn--ghost cms-btn--sm" onClick={() => setAttaching(!attaching)} aria-expanded={attaching}>Attach</button>
        <span class="cms-assistant-grow" />
        {running ? <button type="button" class="cms-btn cms-btn--danger cms-btn--sm" onClick={props.onStop}>Stop</button>
          : <button type="submit" class="cms-btn cms-btn--primary cms-btn--sm" disabled={!configured || !props.input.trim() || props.busy || !props.conversationId}>Send</button>}
      </div>
    </form>
  </section>;
}
