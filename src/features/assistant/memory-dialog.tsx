import { useEffect, useRef, useState } from "preact/hooks";
import { assistantRequest } from "../native-editing/session";
import type { MemoryMode, MemoryView } from "./types";

const MODES: { value: MemoryMode; label: string; detail: string }[] = [
  { value: "read-only", label: "Read only", detail: "The Assistant reads Memory; it can only propose updates for you to approve." },
  { value: "auto", label: "Auto remember", detail: "The Assistant may save short facts you state. It can never approve page changes." },
  { value: "off", label: "Off", detail: "Memory is not sent to or saved by the Assistant. You can still edit it here." },
];

/** One editable site Memory document, separate from conversations and page content. */
export function MemoryDialog({ workspaceId, siteName, onClose, onChanged }: { workspaceId: string; siteName: string; onClose(): void; onChanged(memory: MemoryView): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [memory, setMemory] = useState<MemoryView | null>(null);
  const [body, setBody] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "status"; text: string } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const load = async (keepInput = false) => {
    const value = await assistantRequest<MemoryView>("memory", workspaceId);
    setMemory(value);
    if (!keepInput) { setBody(value.body); setDirty(false); }
    onChanged(value);
    return value;
  };
  useEffect(() => { void load().catch(cause => setMessage({ tone: "error", text: cause.message })); }, [workspaceId]);
  const act = async (operation: string, input: Record<string, unknown>, done: string) => {
    if (!memory) return;
    setBusy(true); setMessage(null);
    try {
      const value = await assistantRequest<MemoryView>(operation, workspaceId, input);
      setMemory(value); onChanged(value);
      if (operation !== "setMemoryMode") { setBody(value.body); setDirty(false); }
      setMessage({ tone: "status", text: done });
    } catch (cause) {
      // Unsaved text stays in the editor; refresh only the revision shown.
      setMessage({ tone: "error", text: cause instanceof Error ? cause.message : "Memory was not saved." });
      await load(true).catch(() => {});
    } finally { setBusy(false); }
  };
  return <dialog ref={dialog} class="cms-assistant-memory" aria-labelledby="assistant-memory-title" onClose={onClose} onCancel={event => { if (dirty && !confirm("Discard unsaved Memory changes?")) event.preventDefault(); }}>
    <header class="cms-assistant-memory__header">
      <h2 id="assistant-memory-title">Site Memory · {siteName}</h2>
      <button type="button" class="cms-assistant-link" onClick={() => { if (!dirty || confirm("Discard unsaved Memory changes?")) dialog.current?.close(); }}>Close</button>
    </header>
    <p class="cms-assistant-hint">One document of durable site context (audience, tone, policies). It is separate from conversations and page content, and never grants the Assistant permission to apply changes.</p>
    {memory && <fieldset class="cms-assistant-memory__modes" disabled={busy}>
      <legend>Assistant access</legend>
      {MODES.map(mode => <label key={mode.value}><input type="radio" name="memory-mode" checked={memory.mode === mode.value} onChange={() => void act("setMemoryMode", { mode: mode.value, expectedModeRevision: memory.modeRevision }, `Memory mode: ${mode.label}.`)} /> <strong>{mode.label}</strong> <span>{mode.detail}</span></label>)}
    </fieldset>}
    <label class="cms-assistant-memory__editor">Memory {memory ? <span class="cms-assistant-hint">revision {memory.revision}{dirty ? " · unsaved changes" : ""}</span> : null}
      <textarea value={body} rows={10} maxLength={20_000} disabled={!memory} onInput={event => { setBody(event.currentTarget.value); setDirty(true); }} />
    </label>
    {message && <p role={message.tone === "error" ? "alert" : "status"} class={message.tone === "error" ? "cms-assistant-error" : "cms-assistant-hint"}>{message.text}</p>}
    <div class="cms-assistant-row">
      <button type="button" class="cms-btn cms-btn--primary cms-btn--sm" disabled={busy || !memory || !dirty} onClick={() => void act("saveMemory", { body, expectedRevision: memory!.revision }, "Memory saved.")}>Save Memory</button>
      <button type="button" class="cms-btn cms-btn--sm" disabled={busy || !memory || !memory.body} onClick={() => { if (confirm("Clear Memory? Conversation history is not erased, and pending automatic updates will be discarded.")) void act("clearMemory", { expectedRevision: memory!.revision }, "Memory cleared. Earlier conversations still show what they used."); }}>Clear</button>
      <button type="button" class="cms-btn cms-btn--ghost cms-btn--sm" aria-expanded={historyOpen} onClick={() => setHistoryOpen(!historyOpen)}>History</button>
    </div>
    {historyOpen && memory && <ol class="cms-assistant-memory__history" aria-label="Memory history" reversed>
      {[...memory.history].reverse().map(entry => <li key={entry.revision}>
        <span>Revision {entry.revision} · {entry.kind}{entry.restoredFrom ? ` of ${entry.restoredFrom}` : ""} by {entry.actor === "assistant" ? "Assistant" : "you"} · {new Date(entry.createdAt).toLocaleString("en")}</span>
        {entry.revision !== memory.revision && <button type="button" class="cms-assistant-link" disabled={busy} onClick={() => void act("restoreMemory", { revision: entry.revision, expectedRevision: memory.revision }, `Restored revision ${entry.revision} as a new revision.`)}>Restore</button>}
      </li>)}
    </ol>}
  </dialog>;
}
