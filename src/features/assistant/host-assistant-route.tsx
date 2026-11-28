import { batch, computed, For, getScope, Show, signal } from "@takazudo/zfb/zudo-react";
import type { RouteServicesProps } from "../../app/services";
import { formatIntent } from "../../app/route-intents";
import { assistantConfig, assistantEvents, assistantRequest, nativeEditRequest, waitForNativeAuthoringReady } from "../native-editing/session";
import { LiveSelect, when } from "../native-editing/live";
import { takeHostSelection } from "./host-selection";
import { pendingHostReviewIds } from "./host-review-recovery";
import { HostReviewCard } from "./host-review-card";
import type { AssistantStatus, Conversation, ConversationSummary, RunRecord } from "./types";
import type { HostSelection } from "../../shared/host-review-types";

/**
 * Host-specific authoring uses real documents; the ordinary Assistant remains separate.
 * App remounts routes per workspace, so one mount serves exactly one workspace.
 */
export function HostAssistantRoute({ services }: RouteServicesProps) {
  const scope = getScope();
  const alive = () => !scope.abortSignal.aborted;
  const integration = services.workspace.integration, workspaceId = integration.workspace.id ?? "";
  const prefix = `zudo-host-assistant:${workspaceId}`;
  const handoff = (() => { try { return { selection: takeHostSelection(sessionStorage, workspaceId), error: null }; } catch (cause) { return { selection: null, error: cause instanceof Error ? cause.message : "Selection unavailable." }; } })();
  const selection: HostSelection | null = handoff.selection;
  const retainedReviews = (() => { try { return pendingHostReviewIds(localStorage, workspaceId); } catch { return []; } })();
  const status = signal<AssistantStatus | null>(null), error = signal<string | null>(handoff.error);
  const conversations = signal<ConversationSummary[]>([]), conversation = signal<Conversation | null>(null);
  const text = signal(""), busy = signal(false), runId = signal<string | null>(null), reply = signal("");
  const initializing = signal(true);
  const documentUrl = signal<string | null>(null);
  let turn: string | null = null, sending = false, stream: AbortController | null = null;
  const fail = (cause: unknown, fallback: string) => { if (alive()) error.value = cause instanceof Error ? cause.message : fallback; };
  const load = async (id?: string) => {
    const [list, current] = await Promise.all([assistantRequest<ConversationSummary[]>("conversations", workspaceId, {}), id ? assistantRequest<Conversation>("conversation", workspaceId, { conversationId: id }) : Promise.resolve(null)]);
    if (!alive()) return;
    batch(() => { conversations.value = list; if (current) conversation.value = current; });
    if (current) sessionStorage.setItem(`${prefix}:conversation`, current.id);
  };
  const follow = async (id: string, conversationId: string) => {
    stream?.abort(); const controller = new AbortController(); stream = controller;
    batch(() => { runId.value = id; reply.value = ""; });
    sessionStorage.setItem(`${prefix}:run`, JSON.stringify({ id, conversationId }));
    const stopped = () => !alive() || controller.signal.aborted;
    try {
      await assistantEvents(workspaceId, id, 0, event => { if (stopped()) return; if (event.type === "text" && typeof event.data.delta === "string") reply.value += event.data.delta; }, controller.signal);
      if (stopped()) return;
      const run = await assistantRequest<RunRecord>("run", workspaceId, { runId: id });
      if (stopped()) return;
      if (run.status === "running") throw new Error("Reply stream ended early. Recover the running reply.");
      sessionStorage.removeItem(`${prefix}:run`); runId.value = null; await load(conversationId);
      if (run.error && alive()) error.value = run.error.message;
    } catch (cause) { if (!controller.signal.aborted) fail(cause, "Reply unavailable. Recover the saved run."); }
  };
  scope.onActivate(() => {
    const initialization = new AbortController();
    void (async () => {
      // Capturing the saved document freezes this session. Finish that handshake
      // before reading Assistant state or allowing a new conversation mutation.
      try {
        if (selection) {
          const value = await nativeEditRequest<{ documentUrl: string }>("document-preview", { workspaceId, pathname: selection.pathname });
          if (!alive()) return;
          documentUrl.value = value.documentUrl;
        }
      } catch (cause) { fail(cause, "Saved preview unavailable."); }
      if (!alive()) return;
      try {
        await waitForNativeAuthoringReady(initialization.signal);
        if (!alive()) return;
        const results = await Promise.allSettled([
          assistantRequest<AssistantStatus>("status", workspaceId, {}).then(value => { if (alive()) status.value = value; }),
          load(sessionStorage.getItem(`${prefix}:conversation`) ?? undefined),
        ]);
        const failed = results.find(result => result.status === "rejected");
        if (failed?.status === "rejected") throw failed.reason;
      } catch (cause) { fail(cause, "Assistant unavailable."); }
      finally { if (alive()) initializing.value = false; }
      if (!alive()) return;
      try {
        const pending = sessionStorage.getItem(`${prefix}:run`);
        if (pending) { const value = JSON.parse(pending); if (typeof value.id === "string" && typeof value.conversationId === "string") void follow(value.id, value.conversationId); }
      } catch (cause) { fail(cause, "Recovery unavailable."); }
    })();
    return () => { initialization.abort(); stream?.abort(); };
  });
  const send = async () => {
    const current = conversation.value;
    if (!current || !selection || !text.value.trim() || busy.value || runId.value || sending) return;
    sending = true; batch(() => { busy.value = true; error.value = null; });
    try {
      turn ??= crypto.randomUUID();
      const result = await assistantRequest<{ runId: string; conversationId: string }>("start", workspaceId, { conversationId: current.id, clientTurnId: turn, text: text.value, context: { page: null, selection: null, payloadIds: [], hostSelection: selection } });
      if (!alive()) return;
      turn = null; text.value = ""; void follow(result.runId, result.conversationId);
    } catch (cause) { fail(cause, "Message retained; retry uses the same turn identity."); }
    finally { if (alive()) busy.value = false; sending = false; }
  };
  const createConversation = async () => {
    if (initializing.value || sending || busy.value || runId.value) return;
    sending = true; busy.value = true;
    try {
      const value = await assistantRequest<Conversation>("createConversation", workspaceId, {});
      if (!alive()) return;
      // The mutation response is authoritative even if a subsequent catalog
      // refresh is refused by another tab's capture. Never replay creation.
      batch(() => {
        conversation.value = value;
        conversations.value = [{ id: value.id, title: value.title, updatedAt: value.updatedAt, messages: value.messages.length, lastText: "" }, ...conversations.value.filter(item => item.id !== value.id)];
      });
      sessionStorage.setItem(`${prefix}:conversation`, value.id);
      await load(value.id);
    }
    catch (cause) { fail(cause, "Conversation unavailable."); }
    finally { if (alive()) busy.value = false; sending = false; }
  };
  const reviews = computed(() => [...new Set([...retainedReviews, ...(conversation.value?.messages ?? []).flatMap(message => message.hostReviews ?? []).map(review => review.reviewId)])]);
  if (!assistantConfig) return <main><h1>Host Assistant unavailable</h1><p>Configure the supported local Assistant provider to start new proposals. Existing review recovery requires the original authorized host.</p></main>;
  const running = when(() => runId.value);
  const locked = computed(() => busy.value || !!runId.value);
  const options = computed(() => [{ value: "", label: "Choose conversation" }, ...conversations.value.map(item => ({ value: item.id, label: item.title }))]);
  return <main class="cms-host-assistant"><header><h1>{computed(() => status.value?.botName ?? "Assistant")}</h1><a href={formatIntent({ route: "composer", mode: "page", ...(selection ? { visitorUrl: selection.pathname } : {}) })}>Select a saved page component</a><p>{computed(() => status.value ? `${status.value.destination.provider} · ${status.value.destination.model}` : "Loading provider status…")}</p><Show when={when(() => status.value && !status.value.provider.ok)}>{() => <p role="status">{computed(() => { const provider = status.value?.provider; return provider && !provider.ok ? provider.message : ""; })} Existing reviews remain recoverable.</p>}</Show></header>
    <Show when={when(() => error.value)}>{() => <p role="alert">{computed(() => error.value ?? "")}</p>}</Show>
    {selection ? <p>Selected owner: {selection.target.providerId}/{selection.target.recordId}/{selection.target.nodeId}{selection.prop ? ` · ${selection.prop}` : " · arrangement"}. The server re-resolves this exact saved revision before proposing.</p> : <p>Select a component/property in Page authoring and choose Ask Assistant. A previous conversation never supplies implicit edit authority.</p>}
    <label>Conversation <LiveSelect disabled={locked} options={options} value={computed(() => conversation.value?.id ?? "")} onChange={value => void load(value).catch(cause => fail(cause, "Conversation unavailable."))} /></label>
    <button class="cms-btn" disabled={computed(() => initializing.value || locked.value)} on:click={() => void createConversation()}>New conversation</button>
    <section aria-label="Conversation messages"><For each={computed(() => conversation.value?.messages ?? [])} by={message => `${message.id}\0${message.text}`}>{message => <article><strong>{message.value.role}</strong><p style={{ "white-space": "pre-wrap" }}>{message.value.text}</p></article>}</For><Show when={running}>{() => <p role="status">{computed(() => reply.value || "Reply running…")}</p>}</Show></section>
    <label>Request <textarea modelValue={text} disabled={locked} on:input={() => { turn = null; }} /></label><button class="cms-btn" disabled={computed(() => !selection || !conversation.value || !text.value.trim() || locked.value || !status.value?.provider.ok)} on:click={() => void send()}>Send</button>
    <Show when={running}>{() => <><button class="cms-btn" on:click={() => { const id = runId.value, current = conversation.value; if (id) void assistantRequest("stop", workspaceId, { runId: id }).then(() => current && follow(id, current.id), cause => fail(cause, "Stop failed.")); }}>Stop reply</button><button class="cms-btn" on:click={() => { const value = JSON.parse(sessionStorage.getItem(`${prefix}:run`) ?? "null"); if (value) void follow(value.id, value.conversationId); }}>Recover reply</button></>}</Show>
    <p>Composition and Content changes are reviewed separately. Nothing is saved before each human Apply. Shared values are never copied into local component properties.</p>
    <For each={reviews} by={review => review}>{review => <HostReviewCard reviewId={review.value} workspaceId={workspaceId} integration={integration} blocked={locked} />}</For>
    <Show when={when(() => documentUrl.value)}>{() => <details><summary>Saved current host page (not a candidate acknowledgement)</summary><iframe title="Saved host page" sandbox="allow-scripts allow-same-origin" src={documentUrl} /></details>}</Show>
  </main>;
}
