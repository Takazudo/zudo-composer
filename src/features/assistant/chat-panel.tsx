import { computed, For, getScope, Show, signal, type ReadonlySignal, type Ref, type Signal } from "@takazudo/zfb/zudo-react";
import { Rebuild } from "../../components/rebuild";
import { isCompositionEnter } from "../native-editing/request";
import { LiveSelect, when } from "../native-editing/live";
import type { AssistantStatus, ChatMessage, ConversationSummary, MessageContext } from "./types";

export interface Attachment { id: string; label: string }
export interface LiveRun { runId: string; conversationId: string; text: string; phase: string; tools: string[]; status: "running" | "reconnecting" }
type AttachPayload = { kind: "text"; text: string } | { kind: "table"; columns: string[]; rows: string[][] } | { kind: "image"; assetId: string; alt: string };
/** State arrives as signals; `input` is the message box model. Callbacks are read once. */
export interface ChatPanelProps {
  status: ReadonlySignal<AssistantStatus | null>; statusError: ReadonlySignal<string | null>;
  conversations: ReadonlySignal<ConversationSummary[]>; conversationId: ReadonlySignal<string | null>; messages: ReadonlySignal<ChatMessage[]>; live: ReadonlySignal<LiveRun | null>;
  input: Signal<string>; attachments: ReadonlySignal<Attachment[]>; context: ReadonlySignal<MessageContext>; sharePage: Signal<boolean>; busy: ReadonlySignal<boolean>; error: ReadonlySignal<string | null>;
  images: ReadonlySignal<{ id: string; name: string }[]>;
  onInput(value: string): void; onSend(): void; onStop(): void; onRetry(message: ChatMessage): void;
  onConversation(id: string): void; onNewConversation(): void; onClearSelection(): void;
  onAttach(payload: AttachPayload, label: string): Promise<void>;
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
  const kind = signal<string>("text");
  const text = signal(""), assetId = signal(""), alt = signal(""), emptyAlt = signal(false);
  const error = signal<string | null>(null);
  const submit = async () => {
    error.value = null;
    try {
      const value = text.value;
      if (kind.value === "text") { if (!value) throw new Error("Enter the exact text."); await onAttach({ kind: "text", text: value }, `Exact text: ${value.slice(0, 24)}${value.length > 24 ? "…" : ""}`); }
      else if (kind.value === "table") {
        const table = JSON.parse(value) as { columns?: unknown; rows?: unknown };
        if (!Array.isArray(table.columns) || !Array.isArray(table.rows) || table.rows.some(row => !Array.isArray(row) || row.length !== (table.columns as unknown[]).length)) throw new Error("Use {\"columns\": [...], \"rows\": [[...]]} with one cell per column.");
        await onAttach({ kind: "table", columns: table.columns.map(String), rows: (table.rows as unknown[][]).map(row => row.map(String)) }, `Table: ${table.columns.length}×${table.rows.length}`);
      } else { const id = assetId.value; if (!id) throw new Error("Choose an image."); if (!emptyAlt.value && !alt.value) throw new Error("Describe the image, or mark the alternative text as intentionally empty."); await onAttach({ kind: "image", assetId: id, alt: emptyAlt.value ? "" : alt.value }, `Image: ${images.value.find(image => image.id === id)?.name ?? id}`); }
      onDone();
    } catch (cause) { error.value = cause instanceof SyntaxError ? "The table must be valid JSON." : cause instanceof Error ? cause.message : "Could not attach."; }
  };
  const imageOptions = computed(() => [{ value: "", label: "Choose an image" }, ...images.value.map(image => ({ value: image.id, label: image.name }))]);
  return <fieldset class="cms-assistant-attach">
    <legend>Attach exact material</legend>
    <p class="cms-assistant-hint">The Assistant must use attached material exactly as supplied.</p>
    <label>Kind <select modelValue={kind}><option value="text">Exact text</option><option value="table">Table</option><option value="image">Managed image</option></select></label>
    <Show when={when(() => kind.value === "image")} fallback={() => <label>{computed(() => kind.value === "text" ? "Exact text" : "Table JSON")}<textarea rows={4} modelValue={text} on:keydown={event => { if (isCompositionEnter(event)) event.stopPropagation(); }} placeholder={computed(() => kind.value === "table" ? "{\"columns\":[\"Item\",\"Value\"],\"rows\":[[\"Qty\",\"3\"]]}" : "")} /></label>}>{() => <>
      <label>Image <LiveSelect options={imageOptions} value={assetId} onChange={value => { assetId.value = value; }} /></label>
      <label>Alternative text <input modelValue={alt} disabled={emptyAlt} /></label>
      <label><input type="checkbox" modelChecked={emptyAlt} /> Intentionally empty alternative text</label>
    </>}</Show>
    <Show when={when(() => error.value)}>{() => <p role="alert" class="cms-assistant-error">{computed(() => error.value ?? "")}</p>}</Show>
    <div class="cms-assistant-row"><button type="button" class="cms-btn cms-btn--sm" on:click={() => void submit()}>Attach</button><button type="button" class="cms-btn cms-btn--ghost cms-btn--sm" on:click={() => onDone()}>Cancel</button></div>
  </fieldset>;
}

function MessageItem({ message, botName, configured, retryDisabled, props }: { message: ChatMessage; botName: ReadonlySignal<string>; configured: ReadonlySignal<boolean>; retryDisabled: ReadonlySignal<boolean>; props: ChatPanelProps }) {
  const retryable = message.role === "assistant" && (message.outcome === "failed" || message.outcome === "interrupted" || message.outcome === "stopped");
  return <li class="cms-assistant-message" data-role={message.role}>
    <p class="cms-assistant-message__who">{message.role === "user" ? "You" : botName}{message.role === "assistant" && memoryChip(message)}{message.outcome && message.outcome !== "completed" && <span class="cms-assistant-chip" data-tone="warning">{message.outcome === "stopped" ? "Stopped" : message.outcome === "failed" ? "Failed" : "Interrupted"}</span>}</p>
    {message.text ? <div class="cms-assistant-message__text">{message.text}</div> : message.role === "assistant" && <p class="cms-assistant-hint">(No reply text.)</p>}
    {message.role === "user" && message.context && <p class="cms-assistant-hint">{message.context.page ? `On ${message.context.page.title ?? message.context.page.pageId}` : "No page shared"}{message.context.selection ? ` · selected ${message.context.selection.label ?? message.context.selection.nodeId}` : ""}{message.context.payloadIds.length ? ` · ${message.context.payloadIds.length} attachment(s)` : ""}</p>}
    {message.draft?.operationIds.length ? <p><button type="button" class="cms-assistant-link" on:click={() => props.onShowChanges()}>{message.draft.operationIds.length} proposed change{message.draft.operationIds.length === 1 ? "" : "s"} · review in page</button></p> : null}
    {message.suggestions?.map(suggestion => <div class="cms-assistant-card" data-kind="suggestion"><p class="cms-assistant-hint">Proposed wording (not in the draft)</p><p>{suggestion.text}</p>
      {suggestion.target && suggestion.status !== "staged" && <button type="button" class="cms-btn cms-btn--sm" on:click={() => props.onStageSuggestion(message, suggestion.id)}>Add to review</button>}
      {suggestion.status === "staged" && <span class="cms-assistant-chip">Added to review</span>}</div>)}
    {message.memoryProposals?.map(proposal => <div class="cms-assistant-card" data-kind="memory"><p class="cms-assistant-hint">Memory update proposal</p><p>{proposal.change.kind === "append" ? `Add: “${proposal.change.text}”` : `Replace “${proposal.change.find}” with “${proposal.change.text}”`}</p>
      {proposal.status === "pending" ? <div class="cms-assistant-row"><button type="button" class="cms-btn cms-btn--sm" on:click={() => props.onMemoryProposal(message, proposal.id, true)}>Save to Memory</button><button type="button" class="cms-btn cms-btn--ghost cms-btn--sm" on:click={() => props.onMemoryProposal(message, proposal.id, false)}>Dismiss</button></div> : <span class="cms-assistant-chip">{proposal.status === "accepted" ? `Saved as r${proposal.resolvedRevision}` : "Dismissed"}</span>}</div>)}
    {message.remembered?.map(entry => <span class="cms-assistant-chip">Remembered · Memory r{entry.revision}</span>)}
    {retryable && <Show when={configured}>{() => <button type="button" class="cms-assistant-link" disabled={retryDisabled} on:click={() => props.onRetry(message)}>Retry this turn</button>}</Show>}
  </li>;
}

/** Conversation and advice. Validated changes appear in the review panel, never as chat text. */
export function ChatPanel(props: ChatPanelProps) {
  const scope = getScope();
  const list: Ref<HTMLOListElement> = { current: null };
  const attaching = signal(false);
  const renaming = signal<string | null>(null);
  const renameValue = signal("");
  const detailsOpen = signal(false);
  const botName = computed(() => props.status.value?.botName ?? "AI Assistant");
  const configured = computed(() => props.status.value?.provider.ok === true);
  const running = computed(() => !!props.live.value && props.live.value.conversationId === props.conversationId.value);
  const retryDisabled = computed(() => props.busy.value || running.value);
  scope.effect(() => { void props.messages.value.length; void props.live.value?.text; list.current?.lastElementChild?.scrollIntoView?.({ block: "end" }); });
  const startRename = () => { renameValue.value = botName.value; renaming.value = botName.value; };
  const conversationOptions = computed(() => props.conversations.value.length ? props.conversations.value.map(conversation => ({ value: conversation.id, label: conversation.title })) : [{ value: "", label: "No conversations yet" }]);
  const status = props.status;
  const sends = computed(() => status.value?.destination.sends ?? []);
  return <section class="cms-assistant-chat" aria-label={computed(() => `${botName.value} conversation`)}>
    <header class="cms-assistant-chat__header">
      <Show when={when(() => renaming.value === null)} fallback={() => <form class="cms-assistant-row" on:submit={event => { event.preventDefault(); const name = renameValue.value.trim(); props.onRename(name ? name : null); renaming.value = null; }}>
        <label>Assistant name <input modelValue={renameValue} maxlength={40} /></label>
        <button type="submit" class="cms-btn cms-btn--sm">Save</button><button type="button" class="cms-btn cms-btn--ghost cms-btn--sm" on:click={() => { renaming.value = null; }}>Cancel</button>
        <button type="button" class="cms-btn cms-btn--ghost cms-btn--sm" on:click={() => { props.onRename(null); renaming.value = null; }}>Use default</button>
      </form>}>{() => <h1 class="cms-assistant-chat__title"><span class="cms-assistant-chat__name">{botName}</span> <button type="button" class="cms-assistant-link" aria-label={computed(() => `Rename ${botName.value}`)} on:click={startRename}>Rename</button></h1>}</Show>
      <div class="cms-assistant-row">
        <label class="cms-assistant-grow">Conversation <LiveSelect options={conversationOptions} value={computed(() => props.conversationId.value ?? "")} disabled={props.busy} onChange={value => props.onConversation(value)} /></label>
        <button type="button" class="cms-btn cms-btn--sm" disabled={props.busy} on:click={() => props.onNewConversation()}>New</button>
        <button type="button" class="cms-btn cms-btn--ghost cms-btn--sm" on:click={() => props.onOpenMemory()}>{computed(() => `Memory${status.value ? ` · ${status.value.memory.mode === "read-only" ? "Read only" : status.value.memory.mode === "auto" ? "Auto" : "Off"}` : ""}`)}</button>
      </div>
    </header>
    <Show when={when(() => props.statusError.value)}>{() => <p role="alert" class="cms-assistant-error">{computed(() => props.statusError.value ?? "")}</p>}</Show>
    <Rebuild value={computed(() => status.value && !status.value.provider.ok ? status.value.provider.message : null)}>{message => message === null ? null : <div role="status" class="cms-assistant-warning"><p><strong>AI replies are unavailable.</strong> {message}</p><p class="cms-assistant-hint">Composer, review, Memory and saved conversations keep working.</p></div>}</Rebuild>
    <ol class="cms-assistant-messages" ref={list} aria-live="polite" aria-label="Messages">
      <Show when={when(() => !props.messages.value.length && !running.value)}>{() => <li class="cms-assistant-empty">Ask about this page, or request a specific change. Changes wait for your review; nothing is saved until you choose Apply to Composer.</li>}</Show>
      <For each={props.messages} by={message => `${message.id}\0${JSON.stringify(message)}`}>{message => <MessageItem message={message.value} botName={botName} configured={configured} retryDisabled={retryDisabled} props={props} />}</For>
      <Show when={running}>{() => <li class="cms-assistant-message" data-role="assistant" aria-busy="true"><p class="cms-assistant-message__who">{botName} <span class="cms-assistant-chip">{computed(() => props.live.value?.status === "reconnecting" ? "Reconnecting…" : props.live.value?.phase ?? "")}</span></p><div class="cms-assistant-message__text">{computed(() => props.live.value?.text || "…")}</div></li>}</Show>
    </ol>
    <form class="cms-assistant-compose" on:submit={event => { event.preventDefault(); props.onSend(); }}>
      <div class="cms-assistant-row cms-assistant-context" aria-label="Context for the next message">
        <label class="cms-assistant-chip"><input type="checkbox" modelChecked={props.sharePage} /> {computed(() => { const page = props.context.value.page; return page || props.sharePage.value ? `Page: ${page?.title ?? page?.pageId ?? "current page"}` : "Share current page"; })}</label>
        <Rebuild value={computed(() => props.context.value.selection ? props.context.value.selection.label ?? props.context.value.selection.nodeId : null)}>{label => label === null ? null : <span class="cms-assistant-chip">Selected: {label} <button type="button" class="cms-assistant-link" aria-label="Clear selection" on:click={() => props.onClearSelection()}>×</button></span>}</Rebuild>
        <For each={props.attachments} by={attachment => attachment.id}>{attachment => <span class="cms-assistant-chip">{attachment.value.label} <button type="button" class="cms-assistant-link" aria-label={`Remove ${attachment.value.label}`} on:click={() => props.onRemoveAttachment(attachment.value.id)}>×</button></span>}</For>
        <button type="button" class="cms-assistant-link" aria-expanded={detailsOpen} on:click={() => { detailsOpen.value = !detailsOpen.value; }}>Context details</button>
      </div>
      <Show when={detailsOpen}>{() => <div class="cms-assistant-card" data-kind="context"><p class="cms-assistant-hint">{computed(() => `Sent with your next message to ${status.value?.destination.provider ?? "the configured provider"}${status.value ? ` (${status.value.destination.model}${status.value.provider.version ? `, ${status.value.provider.version}` : ""})` : ""}:`)}</p><ul><For each={sends} by={item => item}>{item => <li>{item}</li>}</For></ul><p class="cms-assistant-hint">{computed(() => `Memory ${status.value ? `revision ${status.value.memory.revision}, mode ${status.value.memory.mode}` : "status unknown"}. Composer never reads or sends credentials; a CLI provider uses its own sign-in.`)}</p></div>}</Show>
      <Show when={attaching}>{() => <AttachForm images={props.images} onAttach={props.onAttach} onDone={() => { attaching.value = false; }} />}</Show>
      <label class="cms-sr-only" for="assistant-input">{computed(() => `Message ${botName.value}`)}</label>
      <textarea id="assistant-input" rows={3} modelValue={props.input} disabled={computed(() => !props.conversationId.value)}
        placeholder={computed(() => configured.value ? `Message ${botName.value}…` : "Configure the Assistant to send messages.")}
        on:input={event => props.onInput(event.currentTarget.value)}
        on:keydown={event => {
          // A composition-confirming Enter (isComposing, or WebKit's post-commit keyCode 229) never sends.
          if (isCompositionEnter(event)) { event.stopPropagation(); return; }
          if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); props.onSend(); }
        }} />
      <Show when={when(() => props.error.value)}>{() => <p role="alert" class="cms-assistant-error">{computed(() => props.error.value ?? "")}</p>}</Show>
      <div class="cms-assistant-row">
        <button type="button" class="cms-btn cms-btn--ghost cms-btn--sm" on:click={() => { attaching.value = !attaching.value; }} aria-expanded={attaching}>Attach</button>
        <span class="cms-assistant-grow" />
        <Show when={running} fallback={() => <button type="submit" class="cms-btn cms-btn--primary cms-btn--sm" disabled={computed(() => !configured.value || !props.input.value.trim() || props.busy.value || !props.conversationId.value)}>Send</button>}>{() => <button type="button" class="cms-btn cms-btn--danger cms-btn--sm" on:click={() => props.onStop()}>Stop</button>}</Show>
      </div>
    </form>
  </section>;
}
