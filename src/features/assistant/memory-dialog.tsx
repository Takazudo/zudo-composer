import { batch, computed, For, getScope, Show, signal, type Ref } from "@takazudo/zfb/zudo-react";
import { Rebuild } from "../../components/rebuild";
import { assistantRequest } from "../native-editing/session";
import { when } from "../native-editing/live";
import type { MemoryMode, MemoryView } from "./types";

const MODES: { value: MemoryMode; label: string; detail: string }[] = [
  { value: "read-only", label: "Read only", detail: "The Assistant reads Memory; it can only propose updates for you to approve." },
  { value: "auto", label: "Auto remember", detail: "The Assistant may save short facts you state. It can never approve page changes." },
  { value: "off", label: "Off", detail: "Memory is not sent to or saved by the Assistant. You can still edit it here." },
];

/** One editable site Memory document, separate from conversations and page content. */
export function MemoryDialog({ workspaceId, siteName, onClose, onChanged }: { workspaceId: string; siteName: string; onClose(): void; onChanged(memory: MemoryView): void }) {
  const scope = getScope();
  const dialog: Ref<HTMLDialogElement> = { current: null };
  const memory = signal<MemoryView | null>(null);
  const body = signal("");
  const dirty = signal(false);
  const busy = signal(false);
  const message = signal<{ tone: "error" | "status"; text: string } | null>(null);
  const historyOpen = signal(false);
  // The radios mirror the saved mode; a refused change snaps back to it.
  const mode = signal<string | null>(null);
  scope.effect(() => { mode.value = memory.value?.mode ?? null; });
  const load = async (keepInput = false) => {
    const value = await assistantRequest<MemoryView>("memory", workspaceId);
    if (scope.abortSignal.aborted) return value;
    batch(() => { memory.value = value; if (!keepInput) { body.value = value.body; dirty.value = false; } });
    onChanged(value);
    return value;
  };
  scope.onActivate(() => {
    dialog.current?.showModal();
    void load().catch(cause => { if (!scope.abortSignal.aborted) message.value = { tone: "error", text: cause.message }; });
  });
  const act = async (operation: string, input: Record<string, unknown>, done: string) => {
    if (!memory.value) return;
    batch(() => { busy.value = true; message.value = null; });
    try {
      const value = await assistantRequest<MemoryView>(operation, workspaceId, input);
      if (scope.abortSignal.aborted) return;
      batch(() => {
        memory.value = value;
        if (operation !== "setMemoryMode") { body.value = value.body; dirty.value = false; }
        message.value = { tone: "status", text: done };
      });
      onChanged(value);
    } catch (cause) {
      // Unsaved text stays in the editor; refresh only the revision shown.
      if (scope.abortSignal.aborted) return;
      message.value = { tone: "error", text: cause instanceof Error ? cause.message : "Memory was not saved." };
      await load(true).catch(() => {});
    } finally { if (!scope.abortSignal.aborted) batch(() => { busy.value = false; mode.value = memory.value?.mode ?? null; }); }
  };
  const confirmDiscard = () => !dirty.value || confirm("Discard unsaved Memory changes?");
  const revision = computed(() => memory.value ? `revision ${memory.value.revision}${dirty.value ? " · unsaved changes" : ""}` : "");
  const history = computed(() => memory.value ? [...memory.value.history].reverse() : []);
  return <dialog ref={dialog} class="cms-assistant-memory" aria-labelledby="assistant-memory-title" on:close={() => onClose()} on:cancel={event => { if (!confirmDiscard()) event.preventDefault(); }}>
    <header class="cms-assistant-memory__header">
      <h2 id="assistant-memory-title">Site Memory · {siteName}</h2>
      <button type="button" class="cms-assistant-link" on:click={() => { if (confirmDiscard()) dialog.current?.close(); }}>Close</button>
    </header>
    <p class="cms-assistant-hint">One document of durable site context (audience, tone, policies). It is separate from conversations and page content, and never grants the Assistant permission to apply changes.</p>
    <Show when={when(() => memory.value)}>{() => <fieldset class="cms-assistant-memory__modes" disabled={busy}>
      <legend>Assistant access</legend>
      {MODES.map(entry => <label><input type="radio" name="memory-mode" value={entry.value} modelValue={mode} on:change={() => { const current = memory.value; if (current) void act("setMemoryMode", { mode: entry.value, expectedModeRevision: current.modeRevision }, `Memory mode: ${entry.label}.`); }} /> <strong>{entry.label}</strong> <span>{entry.detail}</span></label>)}
    </fieldset>}</Show>
    <label class="cms-assistant-memory__editor">Memory <Show when={when(() => memory.value)}>{() => <span class="cms-assistant-hint">{revision}</span>}</Show>
      <textarea modelValue={body} rows={10} maxlength={20_000} disabled={computed(() => !memory.value)} on:input={() => { dirty.value = true; }} />
    </label>
    <Rebuild value={message}>{value => value ? <p role={value.tone === "error" ? "alert" : "status"} class={value.tone === "error" ? "cms-assistant-error" : "cms-assistant-hint"}>{value.text}</p> : null}</Rebuild>
    <div class="cms-assistant-row">
      <button type="button" class="cms-btn cms-btn--primary cms-btn--sm" disabled={computed(() => busy.value || !memory.value || !dirty.value)} on:click={() => void act("saveMemory", { body: body.value, expectedRevision: memory.value!.revision }, "Memory saved.")}>Save Memory</button>
      <button type="button" class="cms-btn cms-btn--sm" disabled={computed(() => busy.value || !memory.value || !memory.value.body)} on:click={() => { if (confirm("Clear Memory? Conversation history is not erased, and pending automatic updates will be discarded.")) void act("clearMemory", { expectedRevision: memory.value!.revision }, "Memory cleared. Earlier conversations still show what they used."); }}>Clear</button>
      <button type="button" class="cms-btn cms-btn--ghost cms-btn--sm" aria-expanded={historyOpen} on:click={() => { historyOpen.value = !historyOpen.value; }}>History</button>
    </div>
    <Show when={when(() => historyOpen.value && memory.value)}>{() => <ol class="cms-assistant-memory__history" aria-label="Memory history" reversed>
      <For each={history} by={entry => `${entry.revision}\0${memory.value?.revision}`}>{item => {
        const entry = item.value;
        return <li>
          <span>Revision {entry.revision} · {entry.kind}{entry.restoredFrom ? ` of ${entry.restoredFrom}` : ""} by {entry.actor === "assistant" ? "Assistant" : "you"} · {new Date(entry.createdAt).toLocaleString("en")}</span>
          {entry.revision !== memory.value?.revision && <button type="button" class="cms-assistant-link" disabled={busy} on:click={() => { const current = memory.value; if (current) void act("restoreMemory", { revision: entry.revision, expectedRevision: current.revision }, `Restored revision ${entry.revision} as a new revision.`); }}>Restore</button>}
        </li>;
      }}</For>
    </ol>}</Show>
  </dialog>;
}
