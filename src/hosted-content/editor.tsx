import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { Input } from "../components/ui/form-controls";
import { HostedContentSession } from "./session";
import type { HostedEditorSessionState, HostedSessionOptions } from "./session";
import type { ContentEntryRef, HostedPolicy } from "./types";

export * from "./preview-browser";
export type { HostedEditorSessionState, HostedRecoveryCheckpoint, HostedPreviewAdapter, HostedSessionOptions } from "./session";
export interface HostedEditorSelection { entry: ContentEntryRef; fieldId: string }
export interface HostedEditorLabels {
  save: string; preview: string; submit: string; loading: string;
  clean: string; dirty: string; saving: string; saved: string; recovering: string; conflict: string; failed: string;
}
export interface HostedContentEditorOptions extends HostedSessionOptions {
  policy: HostedPolicy;
  selection: HostedEditorSelection;
  routeId?: string;
  labels?: Partial<HostedEditorLabels>;
  onNavigate?(selection: HostedEditorSelection): void | Promise<void>;
}
export interface HostedContentEditorHandle {
  readonly state: HostedEditorSessionState;
  ready: Promise<void>;
  subscribe(listener: (state: HostedEditorSessionState) => void): () => void;
  flush(): Promise<void>;
  navigate(selection: HostedEditorSelection): Promise<void>;
  dispose(): void;
}
const defaults: HostedEditorLabels = {
  save: "Save", preview: "Preview", submit: "Submit", loading: "Loading content…",
  clean: "Saved", dirty: "Unsaved changes", saving: "Saving…", saved: "Saved", recovering: "Recovering save…",
  conflict: "Content changed. Review your retained changes.", failed: "Save failed. Your changes are retained.",
};
function permitted(options: HostedContentEditorOptions, selection: HostedEditorSelection): boolean {
  return !!options.policy.models.find((model) => model.providerId === selection.entry.providerId && model.modelId === selection.entry.modelId && model.entryIds.includes(selection.entry.recordId))?.fields.some((field) => field.fieldId === selection.fieldId && field.replace);
}
function selected(state: HostedEditorSessionState, selection: HostedEditorSelection) {
  const provider = state.content?.providers.find((item) => item.providerId === selection.entry.providerId);
  const entry = provider?.entries.find((item) => item.id === selection.entry.recordId && item.modelId === selection.entry.modelId);
  const field = provider?.models.find((item) => item.id === selection.entry.modelId)?.document.fields.find((item) => item.id === selection.fieldId);
  return entry && field ? { entry, field } : null;
}
/** Thin durable checkpoint surface. Only the selected permitted existing text field is mounted. */
export function mountHostedContentEditor(container: HTMLElement, options: HostedContentEditorOptions): HostedContentEditorHandle {
  if (!permitted(options, options.selection)) throw new Error("Selection is not permitted");
  const session = new HostedContentSession(options);
  const labels = { ...defaults, ...options.labels };
  let selection = options.selection;
  let disposed = false;
  const draw = () => { if (!disposed) render(<Editor />, container); };
  function Editor() {
    const [state, setState] = useState(session.state);
    useEffect(() => session.subscribe(setState), []);
    const item = selected(state, selection);
    const run = (action: () => Promise<unknown>) => { void action().catch(() => undefined); };
    if (!state.content) return <section class="hosted-content-editor" aria-busy="true"><p role="status">{state.phase === "failed" ? labels.failed : labels.loading}</p></section>;
    if (!item || item.field.kind !== "text") return <section class="hosted-content-editor"><p role="alert">Selected field is unavailable.</p></section>;
    const value = item.entry.values[item.field.id];
    return <section class="hosted-content-editor">
      <label class="hosted-content-editor__field"><span>{item.field.label}</span><Input aria-label={item.field.label} value={typeof value === "string" ? value : ""} required={item.field.required} onInput={(event) => session.edit(selection.entry, item.field.id, event.currentTarget.value)} /></label>
      <div class="hosted-content-editor__actions">
        <button type="button" onClick={() => run(() => session.flush())}>{labels.save}</button>
        {options.preview && options.routeId ? <button type="button" onClick={() => run(() => session.captureAndPreview(options.routeId!))}>{labels.preview}</button> : null}
        {options.preview ? <button type="button" disabled={!state.reviewedSnapshot || state.dirty || !!state.pending || !!state.reviewedSnapshot.diagnostics.length} onClick={() => run(() => session.submit())}>{labels.submit}</button> : null}
      </div>
      <p role="status" aria-live="polite">{labels[state.phase]}</p>
    </section>;
  }
  draw();
  const ready = session.initialize();
  return {
    get state() { return session.state; }, ready,
    subscribe: (listener) => session.subscribe(listener),
    flush: () => session.flush(),
    async navigate(next) {
      if (disposed) throw new Error("Editor presentation is disposed");
      if (!permitted(options, next)) throw new Error("Selection is not permitted");
      await session.flush();
      if (disposed) throw new Error("Editor presentation is disposed");
      await options.onNavigate?.(next);
      selection = next; draw();
    },
    dispose() { if (disposed) return; disposed = true; render(null, container); session.dispose(); },
  };
}
