import { computed, For, getScope, Show, signal, type Child, type ReadonlySignal, type Ref } from "@takazudo/zfb/zudo-react";
import { Rebuild } from "../components/rebuild";
import { Select } from "../components/ui/form-controls";
import { diagnoseContentEntryCompleteness } from "../content/library/helpers";
import type { ContentCompletenessDiagnostic, ContentValueSchema } from "../content/model/types";
import { externalDraft, stableComputed } from "../features/content/reactive-draft";
import { COMPOSER_ROOT_BUILD, Keyed, mountOwnedChild } from "../runtime";
import { canonicalSerialize } from "./canonical";
import { HostedContentSession } from "./session";
import { HostedFieldControl, fieldEditable, fieldClearable, entryLabel } from "./field-control";
import { hostedEditorLabels } from "./labels";
import type { HostedEditorErrorCode, HostedEditorLabels } from "./labels";
import type { HostedEditorSessionState, HostedSessionOptions } from "./session";
import type { ContentEntryRef, ContentFieldDefinition, HostedFieldPermission, HostedPolicy, HostedResult, HostedState, JsonValue } from "./types";

export * from "./preview-browser";
export type { HostedEditorSessionState, HostedPreviewFailure, HostedRecoveryCheckpoint, HostedPreviewAdapter, HostedSessionOptions } from "./session";
export type { HostedControlLabels } from "./field-control";
export { hostedEditorLabels, hostedEditorLabelsJa, hostedErrorMessages, hostedErrorMessagesJa } from "./labels";
export type { HostedEditorErrorCode, HostedEditorLabels } from "./labels";
export interface HostedEditorSelection { entry: ContentEntryRef; fieldId: string }
/** What a host field renderer receives. It never holds storage, transport or the session itself. */
export interface HostedFieldRenderContext {
  readonly entry: ContentEntryRef; readonly field: ContentFieldDefinition; readonly permission: HostedFieldPermission;
  readonly value: JsonValue | undefined; readonly disabled: boolean; readonly labels: HostedEditorLabels;
  /** True while the field is incomplete; `describedBy` names the editor's visible explanation. */
  readonly invalid: boolean; readonly describedBy?: string;
  /** Stage a value through the same session edit as the built-in control; the service validates it on save. */
  setValue(next: JsonValue | undefined): void;
  /** Mount the built-in control for this field into a host element, e.g. beside a host-owned counter. */
  renderDefault(element: HTMLElement): HostedFieldMount;
}
export interface HostedFieldMount { update(context: HostedFieldRenderContext): void; destroy(): void }
/** Host-owned control for chosen fields. Fields it does not match keep the built-in control. */
export interface HostedFieldRenderer {
  matches(field: ContentFieldDefinition, entry: ContentEntryRef): boolean;
  mount(element: HTMLElement, context: HostedFieldRenderContext): HostedFieldMount;
}
export interface HostedContentEditorOptions extends HostedSessionOptions {
  policy: HostedPolicy;
  selection: HostedEditorSelection;
  /** Defaults to the permitted record form; field mode is the minimal checkpoint surface. */
  presentation?: "record" | "field";
  routeId?: string;
  labels?: Partial<HostedEditorLabels>;
  /** Routine messages for typed service and preview errors, e.g. `hostedErrorMessagesJa`; other errors show their own message. */
  errorMessages?: Partial<Record<HostedEditorErrorCode, string>>;
  /** `false` when the host offers no submission: Submit and its preview-first prompt are not shown. Defaults to true. */
  submission?: boolean;
  /** Map typed diagnostics and transport failures to host-facing messages. Overrides `errorMessages`. */
  formatError?(error: unknown): string;
  onNavigate?(selection: HostedEditorSelection): void | Promise<void>;
  /** The first matching renderer replaces a record field's control; the label and clear action stay built in. */
  fieldRenderers?: HostedFieldRenderer[];
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
  readonly selection: HostedEditorSelection;
  /** Restore an exact revision of a permitted Entry as a new working revision; unsaved edits are saved first. */
  restore(entry: ContentEntryRef, revisionId: string): Promise<HostedResult>;
  dispose(): void;
}
const HOSTED_ROOT = { component: "HostedContentEditor", build: COMPOSER_ROOT_BUILD };
const HOSTED_FIELD_ROOT = { component: "HostedDefaultField", build: COMPOSER_ROOT_BUILD };

/** A host renderer's element and lifetime: mounted once, told each new context, destroyed with the field. */
function CustomField({ renderer, context }: { renderer: HostedFieldRenderer; context: ReadonlySignal<HostedFieldRenderContext> }) {
  const scope = getScope();
  const host: Ref<HTMLDivElement> = { current: null };
  let mounted: HostedFieldMount | null = null;
  let told = context.value;
  scope.onActivate(() => {
    told = context.value;
    mounted = renderer.mount(host.current!, told);
    return () => { mounted?.destroy(); mounted = null; };
  });
  scope.effect(() => {
    const next = context.value;
    if (next === told) return;
    told = next;
    mounted?.update(next);
  });
  return <div ref={host} class="hosted-content-editor__custom" />;
}
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
const sameValue = (a: JsonValue | undefined, b: JsonValue | undefined) => a === undefined || b === undefined ? a === b : canonicalSerialize(a) === canonicalSerialize(b);
const errorCode = (error: unknown): HostedEditorErrorCode | null => error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code as HostedEditorErrorCode : null;
/** Labels along a diagnostic path below its top-level field; list indexes are skipped. */
function diagnosticLabels(field: ContentFieldDefinition, path: readonly (string | number)[] | undefined): string[] {
  const names: string[] = [];
  let schema: ContentValueSchema = field;
  for (const step of path?.slice(1) ?? []) {
    if (schema.kind === "list") { schema = schema.item; continue; }
    if (schema.kind !== "object") break;
    const child = schema.fields.find((candidate) => candidate.id === step);
    if (!child) break;
    names.push(child.label); schema = child;
  }
  return names;
}
let editorMounts = 0;

/** Mount only the policy projection. Location paths/queries never select local authoring tools. */
export function mountHostedContentEditor(container: HTMLElement, options: HostedContentEditorOptions): HostedContentEditorHandle {
  if (!permitted(options, options.selection)) throw new Error("Selection is not permitted");
  const session = new HostedContentSession(options);
  const labels = { ...hostedEditorLabels, ...options.labels };
  const submission = options.submission !== false;
  const domPrefix = `hosted-content-editor-${++editorMounts}`;
  const messageFor = (error: unknown): string => {
    const code = errorCode(error);
    return options.formatError?.(error) ?? (code && options.errorMessages?.[code]) ?? (error instanceof Error ? error.message : String(error));
  };
  function diagnosticText(content: HostedState, current: ContentEntryRef, diagnostic: ContentCompletenessDiagnostic): string {
    const provider = content.providers.find((candidate) => candidate.models.some((model) => model.id === diagnostic.modelId) && candidate.entries.some((entry) => entry.id === diagnostic.entryId && entry.modelId === diagnostic.modelId));
    const top = provider?.models.find((model) => model.id === diagnostic.modelId)?.document.fields.find((field) => field.id === diagnostic.path?.[0] || field.id === diagnostic.fieldId);
    if (!provider || !top) return diagnostic.message;
    const ref = { providerId: provider.providerId, modelId: diagnostic.modelId, recordId: diagnostic.entryId };
    const name = [...(sameRef(ref, current) ? [] : [entryLabel(content, ref)]), top.label, ...diagnosticLabels(top, diagnostic.path)].join(": ");
    return (diagnostic.code === "required-value-missing" ? labels.diagnosticRequired : labels.diagnosticAccessibleText).replace("{field}", name);
  }
  const state = signal<HostedEditorSessionState>(session.state);
  const selection = signal(options.selection);
  let disposed = false;
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
    selection.value = next;
  }
  const preview = () => options.routeId ? session.captureAndPreview(options.routeId) : Promise.reject(new Error("A host-owned route is required"));
  function ConflictReview({ review, fields, local }: { review: HostedState; fields: readonly ContentFieldDefinition[]; local: Record<string, JsonValue> }) {
    const current = selected(review, selection.value)?.entry.values ?? {};
    const differing = fields.filter((field) => !sameValue(local[field.id], current[field.id]));
    const unchanged = fields.filter((field) => !differing.includes(field));
    const headingId = `${domPrefix}-differing`;
    return <div class="hosted-content-editor__review">
      <div role="group" aria-labelledby={headingId}><p id={headingId} class="hosted-content-editor__review-heading">{labels.differingFields} ({differing.length})</p>
      {differing.length ? <dl>{differing.map((field) => <div data-hosted-difference={field.id}><dt>{field.label}</dt><dd>{labels.localValue}: {displayValue(local[field.id], labels.none)}</dd><dd>{labels.serverValue}: {displayValue(current[field.id], labels.none)}</dd></div>)}</dl> : <p>{labels.noDifferingFields}</p>}</div>
      {unchanged.length ? <details class="hosted-content-editor__unchanged"><summary>{labels.unchangedFields} ({unchanged.length})</summary><ul>{unchanged.map((field) => <li>{field.label}</li>)}</ul></details> : null}
    </div>;
  }
  function PreviewFailure({ error, diagnostics, content }: { error: unknown; diagnostics: readonly ContentCompletenessDiagnostic[]; content: HostedState }) {
    const reason = messageFor(error);
    const code = errorCode(error);
    const technical = error instanceof Error ? error.message : String(error);
    const detail = [code, technical].filter(Boolean).join(": ");
    return <div role="alert" class="hosted-content-editor__preview-failure">
      <p class="hosted-content-editor__review-heading">{labels.previewFailed}</p>
      <p>{reason}</p>
      {diagnostics.length ? <><p>{labels.submissionIncomplete}</p><ul>{diagnostics.map((diagnostic) => <li>{diagnosticText(content, selection.value.entry, diagnostic)}</li>)}</ul></> : null}
      {detail && detail !== reason ? <p class="hosted-content-editor__detail">{labels.errorDetail}: <code>{detail}</code></p> : null}
    </div>;
  }

  function Editor() {
    const actionError = signal<unknown>(null);
    const review = signal<HostedState | null>(null);
    const creating = signal<string | null>(session.state.creationDraft?.collectionId ?? null);
    const createValues = signal<Record<string, JsonValue>>(session.state.creationDraft?.values ?? {});
    const existing = signal<Record<string, string>>({});
    const scope = getScope();
    let seenCreation: unknown[] | null = null;
    scope.effect(() => {
      const { creationDraft, lastCreatedEntry } = state.value;
      if (seenCreation && seenCreation[0] === creationDraft && seenCreation[1] === lastCreatedEntry) return;
      seenCreation = [creationDraft, lastCreatedEntry];
      if (!creationDraft && lastCreatedEntry) { creating.value = null; createValues.value = {}; }
    });
    const run = (action: () => Promise<unknown>) => { actionError.value = null; void action().catch((error: unknown) => { actionError.value = error; }); };
    const busy = computed(() => state.value.phase === "saving");
    const pending = computed(() => !!state.value.pending);
    const rejected = computed(() => !!state.value.pending?.rejected);
    const hasIncompleteInput = (prefix: string) => state.value.invalidInputs.some((controlId) => controlId === prefix || controlId.startsWith(`${prefix}/`));
    const onIncompleteNumber = (controlId: string, raw: string | null) => { session.setIncompleteInput(controlId, raw !== null); actionError.value = raw === null ? null : new Error(labels.cannotClear); };

    const loading = () => <section class="hosted-content-editor" aria-busy={computed(() => state.value.phase === "loading")}><p role="status">{computed(() => state.value.phase === "failed" ? labels.failed : labels.loading)}</p></section>;

    const loaded = () => {
      let lastContent = state.value.content!;
      const content = computed(() => { const current = state.value.content; if (current) lastContent = current; return lastContent; });
      const item = computed(() => selected(content.value, selection.value));
      const available = computed(() => !!item.value && permitted(options, selection.value, content.value));
      const error = computed(() => actionError.value ?? state.value.error);
      // A preview failure is explained once, in its own alert below.
      const message = computed(() => { const current = error.value; return current && current !== state.value.previewFailure?.error ? messageFor(current) : null; });

      const records = computed(() => content.value.providers.flatMap((provider) => provider.entries.flatMap((entry) => {
        const ref = { providerId: provider.providerId, modelId: entry.modelId, recordId: entry.id };
        const model = provider.models.find((model) => model.id === entry.modelId);
        const field = model?.document.fields.find((field) => fieldEditable(field, permission(options, { entry: ref, fieldId: field.id })));
        return field && permittedRef(options, ref, content.value) ? [{ selection: { entry: ref, fieldId: field.id }, label: entryLabel(content.value, ref) }] : [];
      })));
      const recordChoices = stableComputed(() => ({ records: records.value, current: refKey(selection.value.entry) }), (value) => JSON.stringify([value.current, value.records.map((record) => [refKey(record.selection.entry), record.label])]));

      const form = () => {
        const current = selection.value;
        const modelPermission = options.policy.models.find((model) => model.providerId === current.entry.providerId && model.modelId === current.entry.modelId)!;
        let lastItem = item.value!;
        const live = computed(() => { const next = item.value; if (next) lastItem = next; return lastItem; });
        const fields = computed(() => live.value.model.document.fields.filter((field) => (options.presentation !== "field" || field.id === current.fieldId) && fieldEditable(field, modelPermission.fields.find((permission) => permission.fieldId === field.id))));
        const completeness = computed(() => diagnoseContentEntryCompleteness(live.value.model, live.value.entry));
        const slots = stableComputed(() => fields.value.map((field, index) => ({ field, index, key: `${refKey(current.entry)}/${field.id}/${state.value.presentationRevision}` })), (list) => list.map((slot) => slot.key).join("\u0000"));
        const collections = options.policy.collections.filter((collection) => sameRef(collection.owner, current.entry));

        const fieldRow = (slot: { field: ContentFieldDefinition; index: number }): Child => {
          const { field, index: fieldIndex } = slot;
          const allowed = modelPermission.fields.find((permission) => permission.fieldId === field.id)!;
          const change = (next: JsonValue | undefined) => { if (next === undefined && !allowed.clear) { actionError.value = new Error(labels.cannotClear); return; } actionError.value = null; session.edit(current.entry, field.id, next); };
          const problems = computed(() => completeness.value.filter((diagnostic) => (diagnostic.path?.[0] ?? diagnostic.fieldId) === field.id));
          const invalid = computed(() => problems.value.length > 0);
          const id = `${domPrefix}-problem-${fieldIndex}`;
          const problemId = computed(() => invalid.value ? id : undefined);
          const value = computed(() => live.value.entry.values[field.id]);
          const identity = `${refKey(current.entry)}/${field.id}`;
          const control = (bound: { value: ReadonlySignal<JsonValue | undefined>; invalid: ReadonlySignal<boolean>; describedBy: ReadonlySignal<string | undefined> }) => <HostedFieldControl schema={field} field={field} invalid={bound.invalid} describedBy={bound.describedBy} value={bound.value} permission={allowed} identity={identity} hasIncompleteInput={hasIncompleteInput} onIncompleteNumber={onIncompleteNumber} label={field.label} content={content} policy={options.policy} labels={labels} onChange={change} />;
          const renderer = options.fieldRenderers?.find((candidate) => candidate.matches(field, current.entry));
          let body: Child;
          if (renderer) {
            const renderDefault = (element: HTMLElement): HostedFieldMount => {
              const told = signal(context.value);
              const root = mountOwnedChild(control({ value: computed(() => told.value.value), invalid: computed(() => told.value.invalid), describedBy: computed(() => told.value.describedBy) }), { identity: HOSTED_FIELD_ROOT, parent: element });
              return { update: (next) => { told.value = next; }, destroy: () => root.stop() };
            };
            const context = computed<HostedFieldRenderContext>(() => ({ entry: current.entry, field, permission: allowed, value: value.value, disabled: busy.value, labels, invalid: invalid.value, ...(problemId.value ? { describedBy: problemId.value } : {}), setValue: change, renderDefault }));
            body = <CustomField renderer={renderer} context={context} />;
          } else {
            body = control({ value, invalid, describedBy: problemId });
          }
          return <div class="hosted-content-editor__field" data-hosted-field={field.id} data-invalid={computed(() => invalid.value ? "true" : undefined)}><span>{field.label}</span>{body}<Show when={invalid}>{() => <p id={id} class="hosted-content-editor__problem">{computed(() => problems.value.map((diagnostic) => [...diagnosticLabels(field, diagnostic.path), diagnostic.code === "required-value-missing" ? labels.requiredMissing : labels.accessibleTextMissing].join(": ")).join(" "))}</p>}</Show>{fieldClearable(field, allowed) ? <button type="button" class="hosted-content-editor__clear" aria-label={`${labels.clear}: ${field.label}`} on:click={() => { for (const controlId of state.value.invalidInputs) if (controlId.startsWith(identity)) session.setIncompleteInput(controlId, false); session.edit(current.entry, field.id, undefined); }}>{labels.clear}</button> : null}</div>;
        };

        const collectionBlock = (collection: HostedPolicy["collections"][number]): Child => {
          const members = computed(() => memberRefs(content.value, collection.owner, collection.fieldId));
          const collectionLabel = live.value.model.document.fields.find((field) => field.id === collection.fieldId)?.label ?? labels.content;
          const targetModel = computed(() => content.value.providers.find((provider) => provider.providerId === collection.target.providerId)?.models.find((model) => model.id === collection.target.modelId));
          const targetPermission = options.policy.models.find((model) => model.providerId === collection.target.providerId && model.modelId === collection.target.modelId);
          const candidates = computed(() => content.value.providers.find((provider) => provider.providerId === collection.target.providerId)?.entries.filter((entry) => entry.modelId === collection.target.modelId && !members.value.some((member) => member.recordId === entry.id) && permittedRef(options, { ...collection.target, recordId: entry.id }, content.value)) ?? []);
          const atLimit = computed(() => members.value.length >= collection.maxItems);
          const blocked = computed(() => busy.value || pending.value || atLimit.value);
          const editableFields = (model: NonNullable<typeof targetModel.value>, permitted: NonNullable<typeof targetPermission>) => model.document.fields.filter((field) => fieldEditable(field, permitted.fields.find((permission) => permission.fieldId === field.id)));

          const createForm = (model: NonNullable<typeof targetModel.value>, permitted: NonNullable<typeof targetPermission>) => <form class="hosted-content-editor__create" novalidate on:submit={(event) => { event.preventDefault(); run(async () => { const result = await session.createEntry(collection.id, session.state.creationDraft?.values ?? createValues.value); creating.value = null; createValues.value = {}; const editable = editableFields(model, permitted)[0]; if (result.createdEntry && editable) await navigate({ entry: result.createdEntry, fieldId: editable.id }); }); }}>
            {editableFields(model, permitted).map((field) => <div class="hosted-content-editor__field"><span>{field.label}</span><HostedFieldControl schema={field} field={field} permission={permitted.fields.find((permission) => permission.fieldId === field.id)!} value={computed(() => createValues.value[field.id] ?? collection.initialValues[field.id])} identity={`create/${collection.id}/${field.id}`} disabledNumber={computed(() => busy.value || pending.value && !rejected.value)} hasIncompleteInput={hasIncompleteInput} onIncompleteNumber={onIncompleteNumber} label={field.label} content={content} policy={options.policy} labels={labels} onChange={(next) => { if (next === undefined) { actionError.value = new Error(labels.cannotClear); return; } const updated = { ...createValues.value, [field.id]: next }; session.stageCreation(collection.id, updated); createValues.value = updated; }} /></div>)}<div class="hosted-content-editor__actions"><button type="submit" disabled={blocked}>{labels.create}</button><button type="button" disabled={computed(() => busy.value || pending.value && !rejected.value)} on:click={() => { try { session.cancelCreation(); creating.value = null; createValues.value = {}; } catch (error) { actionError.value = error; } }}>{labels.cancel}</button></div>
          </form>;

          return <fieldset class="hosted-content-editor__collection"><legend>{collectionLabel}</legend><ol><For each={members} by={refKey}>{(member, index) => {
            const ref = member.value;
            const label = computed(() => entryLabel(content.value, ref));
            const memberModel = content.value.providers.find((provider) => provider.providerId === ref.providerId)?.models.find((model) => model.id === ref.modelId);
            const editable = memberModel?.document.fields.find((field) => fieldEditable(field, permission(options, { entry: ref, fieldId: field.id })));
            const move = (direction: -1 | 1) => { const ordered = [...members.value], at = index.value; [ordered[at], ordered[at + direction]] = [ordered[at + direction]!, ordered[at]!]; return session.reorder(collection.id, ordered); };
            return <li><span>{label}</span><div class="hosted-content-editor__actions">{editable ? <button type="button" disabled={busy} aria-label={computed(() => `${labels.edit}: ${label.value}`)} on:click={() => run(() => navigate({ entry: ref, fieldId: editable.id }))}>{labels.edit}</button> : null}{collection.reorder ? <><button type="button" disabled={computed(() => busy.value || pending.value || index.value === 0)} aria-label={computed(() => `${labels.moveUp}: ${label.value}`)} on:click={() => run(() => move(-1))}>{labels.moveUp}</button><button type="button" disabled={computed(() => busy.value || pending.value || index.value === members.value.length - 1)} aria-label={computed(() => `${labels.moveDown}: ${label.value}`)} on:click={() => run(() => move(1))}>{labels.moveDown}</button></> : null}</div></li>;
          }}</For></ol>
          {collection.create && targetPermission ? <Rebuild value={computed(() => targetModel.value ? (creating.value === collection.id && state.value.creationDraft?.collectionId === collection.id ? "form" : "button") : null)}>{(mode) => {
            const model = targetModel.value;
            if (mode === null || !model) return null;
            if (mode === "form") return createForm(model, targetPermission);
            return <button type="button" disabled={blocked} on:click={() => { session.stageCreation(collection.id, {}); createValues.value = {}; creating.value = collection.id; }}>{labels.create}: {collectionLabel}</button>;
          }}</Rebuild> : null}
          {collection.add ? <Rebuild value={stableComputed(() => candidates.value, (list) => JSON.stringify(list.map((candidate) => [candidate.id, entryLabel(content.value, { ...collection.target, recordId: candidate.id })])))}>{(list) => list.length ? (
            <div class="hosted-content-editor__actions"><Select aria-label={`${labels.addExisting}: ${collectionLabel}`} modelValue={externalDraft(getScope(), computed(() => existing.value[collection.id] ?? ""))} on:change={(event) => { existing.value = { ...existing.value, [collection.id]: event.currentTarget.value }; }}><option value="">{labels.choose}</option>{list.map((candidate) => <option value={candidate.id}>{entryLabel(content.value, { ...collection.target, recordId: candidate.id })}</option>)}</Select><button type="button" disabled={computed(() => blocked.value || !existing.value[collection.id])} on:click={() => run(async () => { await session.addEntry(collection.id, { ...collection.target, recordId: existing.value[collection.id]! }); existing.value = { ...existing.value, [collection.id]: "" }; })}>{labels.addExisting}</button></div>
          ) : null}</Rebuild> : null}
          </fieldset>;
        };

        return <section class="hosted-content-editor" aria-busy={busy}>
          {options.presentation !== "field" ? <Rebuild value={recordChoices}>{({ records: list, current: currentKey }) => list.length > 1 ? <div class="hosted-content-editor__field"><span>{labels.content}</span><Select aria-label={labels.content} modelValue={signal(currentKey)} on:change={(event) => { const next = list.find((record) => refKey(record.selection.entry) === event.currentTarget.value); if (next) run(() => navigate(next.selection)); }}>{list.map((record) => <option value={refKey(record.selection.entry)}>{record.label}</option>)}</Select></div> : null}</Rebuild> : null}
          <div class="hosted-content-editor__fields"><For each={slots} by={(slot) => slot.key}>{(slot) => fieldRow(slot.value)}</For></div>
          {options.presentation !== "field" ? collections.map(collectionBlock) : null}
          <div class="hosted-content-editor__actions">
            <button type="button" disabled={computed(() => busy.value || rejected.value || !!state.value.invalidInputs.length)} on:click={() => run(() => session.flush())}>{labels.save}</button>
            {options.preview && options.routeId ? <button type="button" disabled={computed(() => busy.value || rejected.value || !!state.value.invalidInputs.length)} on:click={() => { actionError.value = null; // The session records every current preview failure in state.previewFailure; a superseded or outdated one stays hidden.
              void preview().catch(() => undefined); }}>{labels.preview}</button> : null}
            {options.preview && submission ? <button type="button" disabled={computed(() => { const { reviewedSnapshot, dirty } = state.value; return !reviewedSnapshot || dirty || pending.value || !!reviewedSnapshot.diagnostics.length; })} on:click={() => run(() => session.submit())}>{labels.submit}</button> : null}
            <button type="button" disabled={computed(() => busy.value || state.value.dirty || pending.value)} on:click={() => run(() => session.refresh())}>{labels.reload}</button>
          </div>
          <p role="status" aria-live="polite">{computed(() => labels[state.value.phase])}</p>
          {options.preview ? <Show when={computed(() => !!state.value.reviewedSnapshot || submission)}>{() => <p>{computed(() => state.value.reviewedSnapshot ? labels.previewCurrent : labels.previewRequired)}</p>}</Show> : null}
          <Rebuild value={computed(() => state.value.reviewedSnapshot?.diagnostics.length ? state.value.reviewedSnapshot.diagnostics : null)}>{(diagnostics) => diagnostics ? <div role="alert"><p>{labels.submissionIncomplete}</p><ul>{diagnostics.map((diagnostic) => <li>{diagnosticText(content.value, current.entry, diagnostic)}</li>)}</ul></div> : null}</Rebuild>
          <Rebuild value={computed(() => state.value.previewFailure ?? null)}>{(failure) => failure ? <PreviewFailure error={failure.error} diagnostics={failure.diagnostics} content={content.value} /> : null}</Rebuild>
          <Show when={computed(() => message.value !== null)}>{() => <p role="alert">{computed(() => message.value ?? "")}</p>}</Show>
          <Show when={rejected}>{() => <div class="hosted-content-editor__recovery"><button type="button" on:click={() => run(async () => { review.value = await session.reviewAuthoritative(); })}>{labels.review}</button><Rebuild value={review}>{(authoritative) => authoritative ? <><ConflictReview review={authoritative} fields={fields.value} local={live.value.entry.values} /><div class="hosted-content-editor__actions"><button type="button" on:click={() => run(async () => { await session.reapply(authoritative); review.value = null; })}>{labels.reapply}</button><button type="button" on:click={() => run(async () => { await session.discard(authoritative); review.value = null; })}>{labels.discard}</button></div></> : null}</Rebuild></div>}</Show>
          <Rebuild value={computed(() => { const { publication, publicationStale, publicationError } = state.value; return publication ? { publication, stale: publicationStale, failed: !!publicationError } : null; })}>{(status) => status ? <div class="hosted-content-editor__publication"><p role="status">{status.stale ? `${labels.lastKnownStatus}: ` : ""}{labels[status.publication.status]}</p>{status.publication.message ? <p>{status.publication.message}</p> : null}{status.failed ? <p role="alert">{labels.statusUnavailable}</p> : null}<button type="button" on:click={() => run(() => session.refreshPublication())}>{labels.refreshStatus}</button></div> : null}</Rebuild>
        </section>;
      };

      return <Show when={available} fallback={() => <section class="hosted-content-editor"><p role="alert">{labels.unavailable}</p></section>}>{() => <Keyed value={selection} by={(current) => `${refKey(current.entry)}/${current.fieldId}`}>{form}</Keyed>}</Show>;
    };

    return <Show when={computed(() => state.value.content !== null)} fallback={loading}>{loaded}</Show>;
  }

  const unsubscribeSession = session.subscribe((next) => { if (!disposed) state.value = next; });
  const root = mountOwnedChild(<Editor />, { identity: HOSTED_ROOT, parent: container });
  const ready = session.initialize().then(() => {
    const item = selected(session.state.content, selection.value);
    const field = item?.model.document.fields.find((field) => field.id === selection.value.fieldId);
    if (!field || !permitted(options, selection.value, session.state.content) || !fieldEditable(field, permission(options, selection.value))) throw new Error("Selection is not permitted");
  });
  return {
    get state() { return session.state; }, ready,
    subscribe: (listener) => session.subscribe(listener),
    flush: () => session.flush(), navigate,
    refresh: () => session.refresh(), preview,
    submit: () => submission ? session.submit() : Promise.reject(new Error("Submission is not offered by this host")), refreshPublication: () => session.refreshPublication(),
    get selection() { return selection.value; },
    restore(entry, revisionId) {
      if (disposed) return Promise.reject(new Error("Editor presentation is disposed"));
      if (!permittedRef(options, entry, session.state.content)) return Promise.reject(new Error("Entry is not permitted"));
      return session.restoreRevision(entry, revisionId);
    },
    dispose() { if (disposed) return; disposed = true; unsubscribeSession(); root.stop(); session.dispose(); },
  };
}
