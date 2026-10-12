import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { Select } from "../components/ui/form-controls";
import { HostedContentSession } from "./session";
import { HostedFieldControl, fieldEditable, fieldClearable, entryLabel, hostedControlLabels } from "./field-control";
import type { HostedControlLabels } from "./field-control";
import type { HostedEditorSessionState, HostedSessionOptions } from "./session";
import type { ContentEntryRef, HostedFieldPermission, HostedPolicy, HostedState, JsonValue } from "./types";

export * from "./preview-browser";
export type { HostedEditorSessionState, HostedRecoveryCheckpoint, HostedPreviewAdapter, HostedSessionOptions } from "./session";
export type { HostedControlLabels } from "./field-control";
export interface HostedEditorSelection { entry: ContentEntryRef; fieldId: string }
export interface HostedEditorLabels extends HostedControlLabels {
  save: string; preview: string; submit: string; loading: string;
  clean: string; dirty: string; saving: string; saved: string; recovering: string; conflict: string; failed: string;
  content: string; edit: string; create: string; addExisting: string; cancel: string;
  review: string; reapply: string; discard: string; localValue: string; serverValue: string;
  reload: string; refreshStatus: string; statusUnavailable: string; cannotClear: string;
  lastKnownStatus: string; previewCurrent: string; previewRequired: string; submissionIncomplete: string;
  submitted: string; building: string; verified: string; integrated: string; deployed: string; unavailable: string;
}
export interface HostedContentEditorOptions extends HostedSessionOptions {
  policy: HostedPolicy;
  selection: HostedEditorSelection;
  /** Defaults to the permitted record form; field mode is the minimal checkpoint surface. */
  presentation?: "record" | "field";
  routeId?: string;
  labels?: Partial<HostedEditorLabels>;
  /** Map typed diagnostics and transport failures to host-facing messages. */
  formatError?(error: unknown): string;
  onNavigate?(selection: HostedEditorSelection): void | Promise<void>;
}
export interface HostedContentEditorHandle {
  readonly state: HostedEditorSessionState;
  ready: Promise<void>;
  subscribe(listener: (state: HostedEditorSessionState) => void): () => void;
  flush(): Promise<void>;
  navigate(selection: HostedEditorSelection): Promise<void>;
  refresh(): Promise<void>;
  preview(): ReturnType<HostedContentSession["captureAndPreview"]>;
  submit(): ReturnType<HostedContentSession["submit"]>;
  refreshPublication(): ReturnType<HostedContentSession["refreshPublication"]>;
  dispose(): void;
}
const defaults: HostedEditorLabels = {
  ...hostedControlLabels,
  save: "Save", preview: "Preview", submit: "Submit", loading: "Loading content…",
  clean: "Saved", dirty: "Unsaved changes", saving: "Saving…", saved: "Saved", recovering: "Recovering save…",
  conflict: "Content changed. Review your retained changes.", failed: "Save failed. Your changes are retained.",
  content: "Content", edit: "Edit", create: "Create item", addExisting: "Add existing item", cancel: "Cancel",
  review: "Review current content", reapply: "Reapply my changes", discard: "Discard my changes", localValue: "Your value", serverValue: "Current saved value",
  reload: "Reload saved content", refreshStatus: "Refresh submission status", statusUnavailable: "Submission status is unavailable. The saved draft is retained.", cannotClear: "This field cannot be cleared.",
  lastKnownStatus: "Last confirmed status", previewCurrent: "Current saved content previewed", previewRequired: "Preview the current saved content before submitting.", submissionIncomplete: "Required content is incomplete.",
  submitted: "Submitted", building: "Building", verified: "Verified", integrated: "Integrated", deployed: "Deployed", unavailable: "Unavailable",
};
const sameRef = (a: ContentEntryRef, b: ContentEntryRef) => a.providerId === b.providerId && a.modelId === b.modelId && a.recordId === b.recordId;
const refKey = (ref: ContentEntryRef) => JSON.stringify([ref.providerId, ref.modelId, ref.recordId]);
function permission(options: HostedContentEditorOptions, selection: HostedEditorSelection): HostedFieldPermission | undefined {
  return options.policy.models.find((model) => model.providerId === selection.entry.providerId && model.modelId === selection.entry.modelId)?.fields.find((field) => field.fieldId === selection.fieldId);
}
function memberRefs(content: HostedState, owner: ContentEntryRef, fieldId: string): ContentEntryRef[] {
  const values = content.providers.find((provider) => provider.providerId === owner.providerId)?.entries.find((entry) => entry.id === owner.recordId && entry.modelId === owner.modelId)?.values[fieldId];
  return Array.isArray(values) ? values as unknown as ContentEntryRef[] : [];
}
function permittedRef(options: HostedContentEditorOptions, ref: ContentEntryRef, content?: HostedState | null): boolean {
  const model = options.policy.models.find((model) => model.providerId === ref.providerId && model.modelId === ref.modelId);
  if (!model) return false;
  return model.entryIds.includes(ref.recordId) || options.policy.collections.some((collection) => collection.target.providerId === ref.providerId && collection.target.modelId === ref.modelId && (!content || memberRefs(content, collection.owner, collection.fieldId).some((member) => sameRef(member, ref))));
}
function permitted(options: HostedContentEditorOptions, selection: HostedEditorSelection, content?: HostedState | null): boolean {
  const allowed = permission(options, selection);
  return permittedRef(options, selection.entry, content) && !!allowed && !!(allowed.replace || allowed.clear || allowed.children?.length || allowed.assetSelect || allowed.assetDescription?.length);
}
function selected(content: HostedState | null, selection: HostedEditorSelection) {
  const provider = content?.providers.find((item) => item.providerId === selection.entry.providerId);
  const entry = provider?.entries.find((item) => item.id === selection.entry.recordId && item.modelId === selection.entry.modelId);
  const model = provider?.models.find((item) => item.id === selection.entry.modelId);
  return entry && model ? { entry, model } : null;
}
const displayValue = (value: JsonValue | undefined, none: string): string => value === undefined ? none : typeof value === "string" ? value : JSON.stringify(value);

/** Mount only the policy projection. Location paths/queries never select local authoring tools. */
export function mountHostedContentEditor(container: HTMLElement, options: HostedContentEditorOptions): HostedContentEditorHandle {
  if (!permitted(options, options.selection)) throw new Error("Selection is not permitted");
  const session = new HostedContentSession(options);
  const labels = { ...defaults, ...options.labels };
  let selection = options.selection;
  let disposed = false;
  const draw = (state = session.state) => { if (!disposed) render(<Editor state={state} />, container); };
  async function navigate(next: HostedEditorSelection) {
    if (disposed) throw new Error("Editor presentation is disposed");
    if (!permitted(options, next, session.state.content)) throw new Error("Selection is not permitted");
    const item = selected(session.state.content, next);
    const field = item?.model.document.fields.find((field) => field.id === next.fieldId);
    if (!field || !fieldEditable(field, permission(options, next))) throw new Error("Selection is not permitted");
    await session.flush();
    if (session.state.dirty) throw new Error("Save or cancel the new item before navigating");
    if (disposed) throw new Error("Editor presentation is disposed");
    await options.onNavigate?.(next);
    selection = next; draw();
  }
  const preview = () => options.routeId ? session.captureAndPreview(options.routeId) : Promise.reject(new Error("A host-owned route is required"));
  function Editor({ state }: { state: HostedEditorSessionState }) {
    const [actionError, setActionError] = useState<unknown>(null);
    const [review, setReview] = useState<HostedState | null>(null);
    const [creating, setCreating] = useState<string | null>(session.state.creationDraft?.collectionId ?? null);
    const [createValues, setCreateValues] = useState<Record<string, JsonValue>>(session.state.creationDraft?.values ?? {});
    const [existing, setExisting] = useState<Record<string, string>>({});
    useEffect(() => { if (!state.creationDraft && state.lastCreatedEntry) { setCreating(null); setCreateValues({}); } }, [state.creationDraft, state.lastCreatedEntry]);
    const run = (action: () => Promise<unknown>) => { setActionError(null); void action().catch(setActionError); };
    if (!state.content) return <section class="hosted-content-editor" aria-busy={state.phase === "loading"}><p role="status">{state.phase === "failed" ? labels.failed : labels.loading}</p></section>;
    const content = state.content;
    const item = selected(content, selection);
    if (!item || !permitted(options, selection, content)) return <section class="hosted-content-editor"><p role="alert">{labels.unavailable}</p></section>;
    const modelPermission = options.policy.models.find((model) => model.providerId === selection.entry.providerId && model.modelId === selection.entry.modelId)!;
    const fields = item.model.document.fields.filter((field) => (options.presentation !== "field" || field.id === selection.fieldId) && fieldEditable(field, modelPermission.fields.find((permission) => permission.fieldId === field.id)));
    const records = content.providers.flatMap((provider) => provider.entries.flatMap((entry) => {
      const ref = { providerId: provider.providerId, modelId: entry.modelId, recordId: entry.id };
      const model = provider.models.find((model) => model.id === entry.modelId);
      const field = model?.document.fields.find((field) => fieldEditable(field, permission(options, { entry: ref, fieldId: field.id })));
      return field && permittedRef(options, ref, content) ? [{ selection: { entry: ref, fieldId: field.id }, label: entryLabel(content, ref) }] : [];
    }));
    const busy = state.phase === "saving";
    const rejected = !!state.pending?.rejected;
    const collections = options.policy.collections.filter((collection) => sameRef(collection.owner, selection.entry));
    const error = actionError ?? state.error;
    const message = error ? options.formatError?.(error) ?? (error instanceof Error ? error.message : String(error)) : null;
    return <section class="hosted-content-editor" aria-busy={busy}>
      {records.length > 1 && options.presentation !== "field" ? <div class="hosted-content-editor__field"><span>{labels.content}</span><Select aria-label={labels.content} value={refKey(selection.entry)} onChange={(event) => { const next = records.find((record) => refKey(record.selection.entry) === event.currentTarget.value); if (next) run(() => navigate(next.selection)); }}>{records.map((record) => <option key={refKey(record.selection.entry)} value={refKey(record.selection.entry)}>{record.label}</option>)}</Select></div> : null}
      <div class="hosted-content-editor__fields">{fields.map((field) => {
        const allowed = modelPermission.fields.find((permission) => permission.fieldId === field.id)!;
        return <div class="hosted-content-editor__field" key={`${refKey(selection.entry)}/${field.id}/${state.presentationRevision}`} data-hosted-field={field.id}><span>{field.label}</span><HostedFieldControl schema={field} field={field} value={item.entry.values[field.id]} permission={allowed} identity={`${refKey(selection.entry)}/${field.id}`} hasIncompleteInput={(prefix) => state.invalidInputs.some((controlId) => controlId === prefix || controlId.startsWith(`${prefix}/`))} onIncompleteNumber={(controlId, raw) => { session.setIncompleteInput(controlId, raw !== null); setActionError(raw === null ? null : new Error(labels.cannotClear)); }} label={field.label} content={content} policy={options.policy} labels={labels} onChange={(next) => { if (next === undefined && !allowed.clear) { setActionError(new Error(labels.cannotClear)); return; } setActionError(null); session.edit(selection.entry, field.id, next); }} />{fieldClearable(field, allowed) ? <button type="button" class="hosted-content-editor__clear" aria-label={`${labels.clear}: ${field.label}`} onClick={() => { for (const controlId of state.invalidInputs) if (controlId.startsWith(`${refKey(selection.entry)}/${field.id}`)) session.setIncompleteInput(controlId, false); session.edit(selection.entry, field.id, undefined); }}>{labels.clear}</button> : null}</div>;
      })}</div>
      {options.presentation !== "field" ? collections.map((collection) => {
        const members = memberRefs(content, collection.owner, collection.fieldId);
        const collectionLabel = item.model.document.fields.find((field) => field.id === collection.fieldId)?.label ?? labels.content;
        const targetProvider = content.providers.find((provider) => provider.providerId === collection.target.providerId);
        const targetModel = targetProvider?.models.find((model) => model.id === collection.target.modelId);
        const targetPermission = options.policy.models.find((model) => model.providerId === collection.target.providerId && model.modelId === collection.target.modelId);
        const candidates = targetProvider?.entries.filter((entry) => entry.modelId === collection.target.modelId && !members.some((member) => member.recordId === entry.id) && permittedRef(options, { ...collection.target, recordId: entry.id }, content)) ?? [];
        const atLimit = members.length >= collection.maxItems;
        return <fieldset class="hosted-content-editor__collection" key={collection.id}><legend>{collectionLabel}</legend><ol>{members.map((ref, index) => {
          const label = entryLabel(content, ref);
          const memberModel = content.providers.find((provider) => provider.providerId === ref.providerId)?.models.find((model) => model.id === ref.modelId);
          const editable = memberModel?.document.fields.find((field) => fieldEditable(field, permission(options, { entry: ref, fieldId: field.id })));
          const move = (direction: -1 | 1) => { const ordered = [...members]; [ordered[index], ordered[index + direction]] = [ordered[index + direction]!, ordered[index]!]; return session.reorder(collection.id, ordered); };
          return <li key={refKey(ref)}><span>{label}</span><div class="hosted-content-editor__actions">{editable ? <button type="button" disabled={busy} aria-label={`${labels.edit}: ${label}`} onClick={() => run(() => navigate({ entry: ref, fieldId: editable.id }))}>{labels.edit}</button> : null}{collection.reorder ? <><button type="button" disabled={busy || !!state.pending || index === 0} aria-label={`${labels.moveUp}: ${label}`} onClick={() => run(() => move(-1))}>{labels.moveUp}</button><button type="button" disabled={busy || !!state.pending || index === members.length - 1} aria-label={`${labels.moveDown}: ${label}`} onClick={() => run(() => move(1))}>{labels.moveDown}</button></> : null}</div></li>;
        })}</ol>
        {collection.create && targetModel && targetPermission ? creating === collection.id && state.creationDraft?.collectionId === collection.id ? <form class="hosted-content-editor__create" noValidate onSubmit={(event) => { event.preventDefault(); run(async () => { const result = await session.createEntry(collection.id, session.state.creationDraft?.values ?? createValues); setCreating(null); setCreateValues({}); const editable = targetModel.document.fields.find((field) => fieldEditable(field, targetPermission.fields.find((permission) => permission.fieldId === field.id))); if (result.createdEntry && editable) await navigate({ entry: result.createdEntry, fieldId: editable.id }); }); }}>
          {targetModel.document.fields.filter((field) => fieldEditable(field, targetPermission.fields.find((permission) => permission.fieldId === field.id))).map((field) => <div class="hosted-content-editor__field" key={field.id}><span>{field.label}</span><HostedFieldControl schema={field} field={field} permission={targetPermission.fields.find((permission) => permission.fieldId === field.id)!} value={createValues[field.id] ?? collection.initialValues[field.id]} identity={`create/${collection.id}/${field.id}`} disabledNumber={busy || !!state.pending && !state.pending.rejected} hasIncompleteInput={(prefix) => state.invalidInputs.some((controlId) => controlId === prefix || controlId.startsWith(`${prefix}/`))} onIncompleteNumber={(controlId, raw) => { session.setIncompleteInput(controlId, raw !== null); setActionError(raw === null ? null : new Error(labels.cannotClear)); }} label={field.label} content={content} policy={options.policy} labels={labels} onChange={(next) => { if (next === undefined) { setActionError(new Error(labels.cannotClear)); return; } setCreateValues((current) => { const updated = { ...current, [field.id]: next }; session.stageCreation(collection.id, updated); return updated; }); }} /></div>)}<div class="hosted-content-editor__actions"><button type="submit" disabled={busy || !!state.pending || atLimit}>{labels.create}</button><button type="button" disabled={busy || !!state.pending && !state.pending.rejected} onClick={() => { try { session.cancelCreation(); setCreating(null); setCreateValues({}); } catch (error) { setActionError(error); } }}>{labels.cancel}</button></div>
        </form> : <button type="button" disabled={busy || !!state.pending || atLimit} onClick={() => { session.stageCreation(collection.id, {}); setCreateValues({}); setCreating(collection.id); }}>{labels.create}: {collectionLabel}</button> : null}
        {collection.add && candidates.length ? <div class="hosted-content-editor__actions"><Select aria-label={`${labels.addExisting}: ${collectionLabel}`} value={existing[collection.id] ?? ""} onChange={(event) => setExisting((current) => ({ ...current, [collection.id]: event.currentTarget.value }))}><option value="">{labels.choose}</option>{candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{entryLabel(content, { ...collection.target, recordId: candidate.id })}</option>)}</Select><button type="button" disabled={busy || !!state.pending || atLimit || !existing[collection.id]} onClick={() => run(async () => { await session.addEntry(collection.id, { ...collection.target, recordId: existing[collection.id]! }); setExisting((current) => ({ ...current, [collection.id]: "" })); })}>{labels.addExisting}</button></div> : null}
        </fieldset>;
      }) : null}
      <div class="hosted-content-editor__actions">
        <button type="button" disabled={busy || rejected || !!state.invalidInputs.length} onClick={() => run(() => session.flush())}>{labels.save}</button>
        {options.preview && options.routeId ? <button type="button" disabled={busy || rejected || !!state.invalidInputs.length} onClick={() => run(preview)}>{labels.preview}</button> : null}
        {options.preview ? <button type="button" disabled={!state.reviewedSnapshot || state.dirty || !!state.pending || !!state.reviewedSnapshot.diagnostics.length} onClick={() => run(() => session.submit())}>{labels.submit}</button> : null}
        <button type="button" disabled={busy || state.dirty || !!state.pending} onClick={() => run(() => session.refresh())}>{labels.reload}</button>
      </div>
      <p role="status" aria-live="polite">{labels[state.phase]}</p>
      {options.preview ? <p>{state.reviewedSnapshot ? labels.previewCurrent : labels.previewRequired}</p> : null}
      {state.reviewedSnapshot?.diagnostics.length ? <div role="alert"><p>{labels.submissionIncomplete}</p><ul>{state.reviewedSnapshot.diagnostics.map((diagnostic, index) => <li key={index}>{diagnostic.message}</li>)}</ul></div> : null}
      {message ? <p role="alert">{message}</p> : null}
      {rejected ? <div class="hosted-content-editor__recovery"><button type="button" onClick={() => run(async () => setReview(await session.reviewAuthoritative()))}>{labels.review}</button>{review ? <><dl>{fields.map((field) => { const current = selected(review, selection)?.entry.values[field.id]; return <div key={field.id}><dt>{field.label}</dt><dd>{labels.localValue}: {displayValue(item.entry.values[field.id], labels.none)}</dd><dd>{labels.serverValue}: {displayValue(current, labels.none)}</dd></div>; })}</dl><div class="hosted-content-editor__actions"><button type="button" onClick={() => run(async () => { await session.reapply(review); setReview(null); })}>{labels.reapply}</button><button type="button" onClick={() => run(async () => { await session.discard(review); setReview(null); })}>{labels.discard}</button></div></> : null}</div> : null}
      {state.publication ? <div class="hosted-content-editor__publication"><p role="status">{state.publicationStale ? `${labels.lastKnownStatus}: ` : ""}{labels[state.publication.status]}</p>{state.publication.message ? <p>{state.publication.message}</p> : null}{state.publicationError ? <p role="alert">{labels.statusUnavailable}</p> : null}<button type="button" onClick={() => run(() => session.refreshPublication())}>{labels.refreshStatus}</button></div> : null}
    </section>;
  }
  const unsubscribeSession = session.subscribe(draw);
  const ready = session.initialize().then(() => {
    const item = selected(session.state.content, selection);
    const field = item?.model.document.fields.find((field) => field.id === selection.fieldId);
    if (!field || !permitted(options, selection, session.state.content) || !fieldEditable(field, permission(options, selection))) throw new Error("Selection is not permitted");
  });
  return {
    get state() { return session.state; }, ready,
    subscribe: (listener) => session.subscribe(listener),
    flush: () => session.flush(), navigate,
    refresh: () => session.refresh(), preview,
    submit: () => session.submit(), refreshPublication: () => session.refreshPublication(),
    dispose() { if (disposed) return; disposed = true; unsubscribeSession(); render(null, container); session.dispose(); },
  };
}
