import { computed, For, getScope, Show, signal, type Child, type ReadonlySignal, type Ref } from "@takazudo/zfb/zudo-react";
import { ArrowDownIcon, ArrowUpIcon, EllipsisIcon, ErrorIcon, InfoIcon, PlusIcon, TrashIcon } from "../../components/icons";
import { formatLibraryTimestampFull } from "../../components/library-page";
import { createMenu, Menu, MenuItem, MenuSeparator } from "../../components/overlay";
import { keyedBy, toSignal, type MaybeSignal } from "../../components/reactive";
import { Rebuild } from "../../components/rebuild";
import { Button, Chip, DataTable, Field, Input, Select, Switch, Textarea, type DataTableColumn, type FieldControl } from "../../components/ui";
import { createDomId } from "../../components/use-dom-id";
import { createContentValueSchema, isContentFieldKey, type ContentEntryRecord, type ContentFieldDefinition, type ContentFieldKind, type ContentModelRecord } from "../../content";
import { Keyed } from "../../runtime";
import { ArticleAiPanel } from "./article-ai-panel";
import { ContentBooleanControl } from "./boolean-control";
import type { ContentAuthoringController, ContentAuthoringState } from "./controller";
import { EntryHistory } from "./entry-history";
import { FieldKindPicker, contentFieldKindPresentation } from "./field-kind-picker";
import { MarkdownEditor } from "./markdown-editor";
import { externalDraft, followExternal } from "./reactive-draft";
import { deriveSlug } from "./slug";
import { StructuredValueEditor, type ContentAssetPickerRenderer } from "./structured-field-editor";
import type { ProductionProviderIntegration } from "../../app/provider-integration";

/** The route's reporter: it runs an action and shows what it failed with. */
export type ContentAuthorRun = (action: () => void | Promise<void>) => void;

/** An Entry value read as the string a text-shaped control can hold. */
function asText(value: ContentEntryRecord["values"][string] | undefined): string {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}

/**
 * Why a field key cannot be stored, in the author's words.
 *
 * The store validates the whole model on write and *throws* on a bad key, so an
 * unfinished key would otherwise surface as "Save failed" rather than as a
 * problem with the box being typed in. The cell holds the draft back until this
 * returns null.
 */
export function contentFieldKeyError(key: string, fieldId: string, fields: readonly ContentFieldDefinition[]): string | null {
  if (key.trim() === "") return "Key is required.";
  if (!isContentFieldKey(key)) return "Start with a lowercase letter, then letters or digits only — up to 64 characters.";
  if (fields.some((field) => field.id !== fieldId && field.key === key)) return `Another field already uses the key “${key}”.`;
  return null;
}

interface SchemaTextCellProps {
  /** Accessible name; every row repeats the column, so it names its field too. */
  label: ReadonlySignal<string>;
  value: ReadonlySignal<string>;
  mono?: boolean;
  validate(next: string): string | null;
  onCommit(next: string): void;
}

/**
 * One editable schema cell that refuses to persist what the model would reject.
 *
 * The draft lives here rather than in the record because a key is invalid for
 * most of the time it takes to type one — "R" of "reviewDate" is already
 * unstorable — and a write per keystroke would put the save queue into an error
 * state the author cannot read from the toolbar.
 */
function SchemaTextCell({ label, value, mono = false, validate, onCommit }: SchemaTextCellProps) {
  const errorId = `sg-content-cell-error-${createDomId()}`;
  const draft = externalDraft(getScope(), value);
  const error = computed(() => validate(draft.value));

  return (
    <div class="sg-content-cell">
      <Input
        size="sm"
        class={mono ? "sg-content-mono" : undefined}
        aria-label={label}
        aria-invalid={computed(() => (error.value ? "true" : undefined))}
        aria-describedby={computed(() => (error.value ? errorId : undefined))}
        modelValue={draft}
        on:input={(event) => {
          const next = event.currentTarget.value;
          draft.value = next;
          if (!validate(next)) onCommit(next);
        }}
      />
      <Show when={computed(() => error.value !== null)}>{() => (
        <p class="sg-content-cell__error" id={errorId}>
          <ErrorIcon size="xs" />
          {computed(() => error.value ?? "")}
        </p>
      )}</Show>
    </div>
  );
}

interface SchemaFieldMenuProps {
  label: ReadonlySignal<string>;
  index: ReadonlySignal<number>;
  count: ReadonlySignal<number>;
  onMove(direction: -1 | 1): void;
  onRemove(): void;
}

function SchemaFieldMenu({ label, index, count, onMove, onRemove }: SchemaFieldMenuProps) {
  const triggerRef: Ref<HTMLButtonElement> = { current: null };
  const menu = createMenu(triggerRef, { align: "end" });
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        elementRef={triggerRef}
        aria-label={computed(() => `Field actions for ${label.value}`)}
        {...menu.triggerProps}
      >
        <EllipsisIcon size="sm" />
      </Button>
      {/* The menu forwards its label to `aria-label`, which binds a signal. */}
      <Menu controller={menu} label={computed(() => `${label.value} field actions`) as unknown as string}>
        <MenuItem icon={ArrowUpIcon} disabled={computed(() => index.value === 0)} onSelect={() => onMove(-1)}>Move up</MenuItem>
        <MenuItem icon={ArrowDownIcon} disabled={computed(() => index.value === count.value - 1)} onSelect={() => onMove(1)}>Move down</MenuItem>
        <MenuSeparator />
        <MenuItem icon={TrashIcon} tone="danger" onSelect={onRemove}>Remove…</MenuItem>
      </Menu>
    </>
  );
}

type ChoiceField = Extract<ContentFieldDefinition, { kind: "choice" }>;
type ChoiceOption = ChoiceField["options"][number];

function ChoiceOptionsEditor({ field, controller, run }: { field: ReadonlySignal<ChoiceField>; controller: ContentAuthoringController; run: ContentAuthorRun }) {
  const scope = getScope();
  const draft = signal<readonly ChoiceOption[]>(structuredClone(field.value.options));
  followExternal(scope, computed(() => JSON.stringify(field.value.options)), () => { draft.value = structuredClone(field.value.options); });
  const error = computed(() => draft.value.some((option) => !option.value.trim() || !option.label.trim()) ? "Every option needs a non-empty value and label." : new Set(draft.value.map((option) => option.value)).size !== draft.value.length ? "Option values must be unique." : null);
  const update = (next: readonly ChoiceOption[]) => { draft.value = next; if (next.length && next.every((option) => option.value.trim() && option.label.trim()) && new Set(next.map((option) => option.value)).size === next.length) run(() => controller.replaceField(field.value.id, { ...field.value, options: [...next] })); };
  const move = (index: number, direction: -1 | 1) => { const target = index + direction; if (target < 0 || target >= draft.value.length) return; const next = [...draft.value]; [next[index], next[target]] = [next[target]!, next[index]!]; update(next); };
  const edit = (index: number, part: "value" | "label", text: string) => update(draft.value.map((item, candidate) => candidate === index ? { ...item, [part]: text } : item));
  const indexes = keyedBy(() => draft.value.map((_, index) => index), (items) => String(items.length));
  return <div class="sg-content-choice-options"><For each={indexes} by={(index) => index}>{(slot) => {
    const index = slot.value;
    const valueDraft = externalDraft(getScope(), computed(() => draft.value[index]?.value ?? ""));
    const labelDraft = externalDraft(getScope(), computed(() => draft.value[index]?.label ?? ""));
    return <div class="sg-content-choice-option"><Textarea rows={1} aria-label={computed(() => `Value for option ${index + 1} in ${field.value.label}`)} modelValue={valueDraft} on:input={(event) => edit(index, "value", event.currentTarget.value)} /><Textarea rows={1} aria-label={computed(() => `Label for option ${index + 1} in ${field.value.label}`)} modelValue={labelDraft} on:input={(event) => edit(index, "label", event.currentTarget.value)} /><Button iconOnly size="xs" aria-label={`Move option ${index + 1} up`} disabled={index === 0} on:click={() => move(index, -1)}><ArrowUpIcon size="xs" /></Button><Button iconOnly size="xs" aria-label={`Move option ${index + 1} down`} disabled={computed(() => index === draft.value.length - 1)} on:click={() => move(index, 1)}><ArrowDownIcon size="xs" /></Button><Button iconOnly size="xs" aria-label={`Remove option ${index + 1}`} disabled={computed(() => draft.value.length === 1)} on:click={() => update(draft.value.filter((_, candidate) => candidate !== index))}><TrashIcon size="xs" /></Button></div>;
  }}</For><Show when={computed(() => error.value !== null)}>{() => <p class="sg-content-cell__error"><ErrorIcon size="xs" />{computed(() => error.value ?? "")}</p>}</Show><Button size="xs" on:click={() => { const current = draft.value; let suffix = current.length + 1, value = `option${suffix}`; while (current.some((option) => option.value === value)) value = `option${++suffix}`; update([...current, { value, label: `Option ${suffix}` }]); }}><PlusIcon size="xs" />Add option</Button></div>;
}

type ReferenceModel = Awaited<ReturnType<ContentAuthoringController["referenceModels"]>>[number];
const targetKey = (ref: { providerId: string; recordId: string }) => `${ref.providerId}/${ref.recordId}`;

function ReferenceTargetSelect({ field, models, controller, run }: { field: ReadonlySignal<Extract<ContentFieldDefinition, { kind: "reference" | "reference-list" }>>; models: readonly ReferenceModel[]; controller: ContentAuthoringController; run: ContentAuthorRun }) {
  const draft = externalDraft(getScope(), computed(() => targetKey(field.value.target)));
  return <Select aria-label={computed(() => `Target model for ${field.value.label}`)} modelValue={draft} on:change={(event) => { const target = models.find((item) => targetKey(item.ref) === event.currentTarget.value)?.ref; if (target) run(() => controller.replaceField(field.value.id, { ...field.value, target })); }}>{models.map((model) => <option value={targetKey(model.ref)}>{model.label} · {model.providerLabel}</option>)}</Select>;
}

/** Configuration for one field kind; a kind change mounts a fresh editor, a value change binds. */
function FieldSchemaOptions({ field, controller, run }: { field: ReadonlySignal<ContentFieldDefinition>; controller: ContentAuthoringController; run: ContentAuthorRun }) {
  const scope = getScope();
  const initial = field.value;
  const live = <K extends ContentFieldKind>(kind: K) => computed(() => (field.value.kind === kind ? field.value : initial) as Extract<ContentFieldDefinition, { kind: K }>);
  const label = computed(() => field.value.label);
  if (initial.kind === "choice") return <ChoiceOptionsEditor field={live("choice")} controller={controller} run={run} />;
  if (initial.kind === "reference" || initial.kind === "reference-list") {
    const reference = computed(() => field.value as Extract<ContentFieldDefinition, { kind: "reference" | "reference-list" }>);
    const models = signal<readonly ReferenceModel[]>([]);
    scope.onActivate(() => { void controller.referenceModels().then((items) => { if (!scope.abortSignal.aborted) models.value = items; }); });
    return <div class="sg-content-schema-options"><Rebuild value={models}>{(items) => <ReferenceTargetSelect field={reference} models={items} controller={controller} run={run} />}</Rebuild>{initial.kind === "reference-list" ? <Switch label="Preserve explicit order" checked={computed(() => Boolean((field.value as Extract<ContentFieldDefinition, { kind: "reference-list" }>).ordered))} onCheckedChange={(ordered) => run(() => controller.replaceField(field.value.id, { ...(field.value as Extract<ContentFieldDefinition, { kind: "reference-list" }>), ordered }))} /> : null}</div>;
  }
  if (initial.kind === "asset-use") {
    const asset = live("asset-use");
    const draft = externalDraft(scope, computed(() => asset.value.use));
    return <Select aria-label={computed(() => `Asset presentation for ${label.value}`)} modelValue={draft} on:change={(event) => run(() => controller.replaceField(asset.value.id, { ...asset.value, use: event.currentTarget.value as "image" | "link" | "card" | "download" }))}><option value="image">Image</option><option value="link">Link</option><option value="card">Card</option><option value="download">Download</option></Select>;
  }
  if (initial.kind === "list") {
    const list = live("list");
    const draft = externalDraft(scope, computed(() => list.value.item.kind));
    return <Select aria-label={computed(() => `Item type for ${label.value}`)} modelValue={draft} on:change={(event) => run(() => controller.replaceField(list.value.id, { ...list.value, item: createContentValueSchema(event.currentTarget.value as ContentFieldKind, { providerId: controller.provider.descriptor.id, recordId: controller.state.model!.id }) }))}>{["text", "long-text", "number", "boolean", "date", "url", "object"].map((kind) => <option value={kind}>{contentFieldKindPresentation(kind as ContentFieldKind).label}</option>)}</Select>;
  }
  if (initial.kind === "object") {
    const object = live("object");
    return <div class="sg-content-schema-options"><span class="sg-content-hint">{computed(() => `${object.value.fields.length} nested fields`)}</span><Button size="xs" on:click={() => { const current = object.value; const index = current.fields.length + 1; const child: ContentFieldDefinition = { id: `nested-${current.id}-${index}`, key: `field${index}`, label: `Nested field ${index}`, required: false, kind: "text" }; run(() => controller.replaceField(current.id, { ...current, fields: [...current.fields, child] })); }}>Add nested field</Button></div>;
  }
  return null;
}

/** The last model the state held; a parent unmounts the author before the model is cleared. */
function lastModel(state: ReadonlySignal<ContentAuthoringState>): ReadonlySignal<ContentModelRecord> {
  let last = state.value.model!;
  return computed(() => { const model = state.value.model; if (model) last = model; return last; });
}

export interface ContentSchemaAuthorProps {
  state: MaybeSignal<ContentAuthoringState>;
  controller: ContentAuthoringController;
  run: ContentAuthorRun;
  onRemove(field: ContentFieldDefinition): void;
}

/**
 * The model's schema: a locked kind, and its fields as one compact table.
 *
 * The model's name is not authored here — the editor toolbar's `RecordTitle`
 * already carries it in Schema mode, and two controls sharing the accessible
 * name "Model name" made every assertion about either of them ambiguous.
 */
export function ContentSchemaAuthor({ state: suppliedState, controller, run, onRemove }: ContentSchemaAuthorProps) {
  const scope = getScope();
  const state = toSignal(suppliedState);
  const model = lastModel(state);
  const fields = computed(() => model.value.document.fields);
  const collection = computed(() => model.value.document.kind === "collection");
  // The table rebuilds only when the set or order of fields changes, so a cell
  // being typed in stays mounted while its own edit round-trips.
  const rows = keyedBy(() => fields.value, (list) => `${model.value.id}\u0000${list.map((field) => field.id).join("\u0000")}`);
  const fieldOf = (initial: ContentFieldDefinition): ReadonlySignal<ContentFieldDefinition> => {
    let last = initial;
    return computed(() => { const found = fields.value.find((field) => field.id === initial.id); if (found) last = found; return last; });
  };
  const description = externalDraft(scope, computed(() => model.value.document.description));

  const columns: DataTableColumn<ContentFieldDefinition>[] = [
    {
      key: "label",
      header: "Label",
      cell: (row) => {
        const field = fieldOf(row);
        return (
          <SchemaTextCell
            label={computed(() => `Label for ${field.value.label}`)}
            value={computed(() => field.value.label)}
            validate={(next) => (next.trim() === "" ? "Label is required." : null)}
            onCommit={(next) => run(() => controller.updateField(row.id, { label: next }))}
          />
        );
      },
    },
    {
      key: "key",
      header: "Key",
      cell: (row) => {
        const field = fieldOf(row);
        return (
          <SchemaTextCell
            label={computed(() => `Key for ${field.value.label}`)}
            value={computed(() => field.value.key)}
            mono
            validate={(next) => contentFieldKeyError(next, row.id, fields.value)}
            onCommit={(next) => run(() => controller.updateField(row.id, { key: next }))}
          />
        );
      },
    },
    {
      key: "kind",
      header: "Type",
      width: "1%",
      cell: (row) => {
        const field = fieldOf(row);
        return (
          <FieldKindPicker
            value={computed(() => field.value.kind)}
            locked={computed(() => state.value.usedFieldIds.includes(row.id))}
            label={computed(() => `Type for ${field.value.label}`)}
            onChange={(kind) => run(() => controller.updateField(row.id, { kind }))}
          />
        );
      },
    },
    {
      key: "required",
      header: "Required",
      width: "1%",
      cell: (row) => {
        const field = fieldOf(row);
        return (
          <Switch
            // Switch forwards its accessible name to the input, which binds a signal.
            aria-label={computed(() => `Required for ${field.value.label}`) as unknown as string}
            checked={computed(() => field.value.required)}
            onCheckedChange={(checked) => run(() => controller.updateField(row.id, { required: checked }))}
          />
        );
      },
    },
    {
      key: "configuration",
      header: "Configuration",
      cell: (row) => {
        const field = fieldOf(row);
        return <Keyed value={computed(() => field.value.kind)} by={(kind) => kind}>{() => <FieldSchemaOptions field={field} controller={controller} run={run} />}</Keyed>;
      },
    },
  ];

  return (
    <div class="sg-content-form">
      <Field controlId="content-model-description" label="Model description" help="Shown in All models so authors can tell similar schemas apart.">
        {(control) => <Textarea field={control} rows={2} modelValue={description} on:input={(event) => run(() => controller.updateModelDescription(event.currentTarget.value))} />}
      </Field>
      <div class="sg-content-locked">
        <span class="sg-content-locked__label">Model kind</span>
        <Chip tone="plain" class="sg-content-locked__chip">
          <InfoIcon size="sm" />
          {computed(() => (collection.value ? "Collection" : "Single"))} · locked after creation
        </Chip>
        <p class="sg-content-hint">
          {computed(() => collection.value
            ? "A Collection holds any number of Entries. Kind is immutable after creation to protect Entry cardinality."
            : "A Single holds exactly one Entry. Kind is immutable after creation to protect Entry cardinality.")}
        </p>
      </div>

      <section class="sg-content-group">
        <h3 class="sg-content-group__title">Fields</h3>
        <Rebuild value={computed(() => model.value.document.name)}>{(name) => (
          <DataTable<ContentFieldDefinition>
            caption={`Fields of ${name}`}
            density="compact"
            columns={columns}
            rows={rows}
            rowKey={(field) => field.id}
            rowActions={(row) => {
              const field = fieldOf(row);
              return (
                <SchemaFieldMenu
                  label={computed(() => field.value.label)}
                  index={computed(() => Math.max(0, fields.value.findIndex((item) => item.id === row.id)))}
                  count={computed(() => fields.value.length)}
                  onMove={(direction) => run(() => controller.moveField(row.id, direction))}
                  onRemove={() => onRemove(field.value)}
                />
              );
            }}
            empty={<p class="sg-content-hint">This model has no fields yet. Add one to start authoring Entries.</p>}
          />
        )}</Rebuild>
        <div class="sg-content-group__footer">
          <Button size="sm" on:click={() => run(() => controller.addField())}>
            <PlusIcon size="sm" />
            Add field
          </Button>
          <p class="sg-content-hint">A field's type locks once a stored Entry holds a value for it.</p>
        </div>
      </section>
    </div>
  );
}

export interface ContentEntryAuthorProps {
  state: MaybeSignal<ContentAuthoringState>;
  controller: ContentAuthoringController;
  run: ContentAuthorRun;
  renderAssetPicker?: ContentAssetPickerRenderer;
  assetPickerCapabilities?: { upload: boolean };
  /** The site project an AI candidate renders in; without it a fresh Apply stays blocked. */
  integration?: ProductionProviderIntegration;
}

/**
 * The Entry form: one real widget per field kind.
 *
 * Metadata stops at what this route can answer — id and the two timestamps. An
 * Entry's "used by" is resolved by the Mapping catalogue, which the inspector's
 * Usage tab owns; inventing a count here would mean guessing.
 *
 * One form belongs to one Entry, view and field set: a change of any of them
 * mounts a fresh form, while value changes bind into the mounted controls.
 */
export function ContentEntryAuthor(props: ContentEntryAuthorProps) {
  const state = toSignal(props.state);
  const identity = computed(() => {
    const { entry, model, viewId } = state.value;
    return entry && model ? JSON.stringify([entry.id, model.id, viewId, model.document.fields, model.document.presentation?.views ?? null]) : "";
  });
  return <Keyed value={identity} by={(key) => key}>{(key) => key.value ? <EntryForm {...props} state={state} /> : null}</Keyed>;
}

type EntryValue = ContentEntryRecord["values"][string] | undefined;

/** Number, date and color inputs take no model: the DOM is written only when the value changes from elsewhere. */
function UnmodeledInput({ type, value, field, mono, commit }: { type: "number" | "date" | "color"; value: ReadonlySignal<EntryValue>; field: FieldControl; mono?: boolean; commit(next: EntryValue): void }) {
  const element: Ref<HTMLInputElement> = { current: null };
  let emitted: EntryValue = value.value;
  followExternal(getScope(), value, (next) => {
    if (Object.is(next, emitted)) return;
    emitted = next;
    if (element.current) element.current.value = asText(next);
  });
  const emit = (next: EntryValue) => { emitted = next; commit(next); };
  return (
    <Input
      field={field}
      elementRef={element}
      type={type}
      class={mono ? "sg-content-mono" : undefined}
      value={asText(value.value)}
      on:input={(event) => {
        if (type !== "number") { emit(event.currentTarget.value); return; }
        const numeric = event.currentTarget.valueAsNumber;
        emit(event.currentTarget.value === "" || !Number.isFinite(numeric) ? undefined : numeric);
      }}
    />
  );
}

function EntryForm({ state, controller, run, renderAssetPicker, assetPickerCapabilities, integration }: Omit<ContentEntryAuthorProps, "state"> & { state: ReadonlySignal<ContentAuthoringState> }) {
  const scope = getScope();
  let lastEntry = state.value.entry!;
  const entry = computed(() => { const current = state.value.entry; if (current) lastEntry = current; return lastEntry; });
  const entryId = lastEntry.id;
  const model = state.value.model!;
  const allFields = model.document.fields;
  const view = model.document.presentation?.views.find((item) => item.id === state.value.viewId);
  const fields = view ? view.fieldIds.flatMap((id) => allFields.filter((field) => field.id === id)) : allFields;
  // The auto-slug source is the field the spec names, not whatever happens to
  // be first: a `text` field keyed `title`.
  const titleField = allFields.find((field) => field.kind === "text" && field.key === "title") ?? null;

  // Auto-derivation starts on for a slug this Entry has not filled in — which
  // is every slug of a new Entry, and none of an Entry that already has one.
  const autoSlug = signal<Readonly<Record<string, boolean>>>(Object.fromEntries(
    fields.filter((field) => field.kind === "slug").map((field) => [field.id, titleField !== null && asText(lastEntry.values[field.id]) === ""]),
  ));

  if (titleField !== null) {
    const titleText = computed(() => asText(entry.value.values[titleField.id]));
    scope.effect(() => {
      const derived = deriveSlug(titleText.value);
      const auto = autoSlug.value;
      // Read without tracking: only the title and the switches start a derivation.
      const values = controller.state.entry?.id === entryId ? controller.state.entry.values : lastEntry.values;
      for (const field of fields) {
        if (field.kind !== "slug" || !auto[field.id]) continue;
        // The only write here that no keystroke asked for, so it goes through the
        // route's reporter rather than throwing out of an effect.
        if (derived !== asText(values[field.id])) run(() => controller.updateEntryValue(field.id, derived));
      }
      // The write lands back here as a fresh Entry, so the guard above is what
      // stops this from looping.
    });
  }

  const valueOf = (fieldId: string) => computed(() => entry.value.values[fieldId]);
  const textOf = (fieldId: string) => computed(() => asText(entry.value.values[fieldId]));

  const renderField = (field: ContentFieldDefinition): Child => {
    const controlId = `content-entry-${field.id}`;
    const { label: kindLabel, icon: KindIcon } = contentFieldKindPresentation(field.kind);
    // `Field` renders the kind hint inside the `<label>`, where it would
    // otherwise join the accessible name with no separator between the two
    // spans — "TitleShort text". It is a visual aid for a distinction the
    // control already carries (a number announces as a spinbutton, a date as
    // a date), so it is marked decorative and the name stays the label.
    const kind = <span aria-hidden="true"><KindIcon size="xs" />{kindLabel}</span>;
    const commit = (next: EntryValue) => run(() => controller.updateEntryValue(field.id, next));

    if (["choice", "reference", "reference-list", "object", "list", "asset-use"].includes(field.kind)) {
      return <div class="sg-content-rich-field" data-content-field-id={field.id} data-content-value-path="/"><Field controlId={controlId} label={field.label} required={field.required} kind={kind}>{(control) => <StructuredValueEditor schema={field} field={field} value={valueOf(field.id)} path={[]} controller={controller} run={run} renderAssetPicker={renderAssetPicker} assetPickerCapabilities={assetPickerCapabilities} fieldControl={control} commit={(next) => controller.updateEntryValue(field.id, next)} />}</Field></div>;
    }

    if (field.kind === "markdown") {
      return (
        <MarkdownEditor
          identity={`${entryId}/${field.id}`}
          value={textOf(field.id)}
          label={field.label}
          required={field.required}
          onChange={commit}
        />
      );
    }

    if (field.kind === "boolean") {
      return (
        <ContentBooleanControl id={controlId} class="sg-content-toggle"
          label={field.label} required={field.required} value={valueOf(field.id)} onChange={commit} />
      );
    }

    if (field.kind === "long-text") {
      const draft = externalDraft(scope, textOf(field.id));
      return (
        <Field controlId={controlId} label={field.label} required={field.required} kind={kind}>
          {(control) => <Textarea field={control} rows={6} modelValue={draft} on:input={(event) => commit(event.currentTarget.value)} />}
        </Field>
      );
    }

    if (field.kind === "slug") {
      const draft = externalDraft(scope, textOf(field.id));
      const auto = computed(() => autoSlug.value[field.id] ?? false);
      return (
        <Field controlId={controlId} label={field.label} required={field.required} kind={kind}>
          {(control) => (
            <div class="sg-content-slug">
              <Input
                field={control}
                class="sg-content-mono"
                modelValue={draft}
                on:input={(event) => {
                  // Typing the slug by hand is what retires the derivation.
                  // Both happen in this one handler, so the derivation sees
                  // the switch already off and leaves the typed value alone.
                  if (auto.value) autoSlug.value = { ...autoSlug.value, [field.id]: false };
                  commit(event.currentTarget.value);
                }}
              />
              {titleField === null ? null : (
                <Switch
                  id={`${controlId}-auto`}
                  label="Auto from title"
                  checked={auto}
                  onCheckedChange={(checked) => { autoSlug.value = { ...autoSlug.value, [field.id]: checked }; }}
                />
              )}
            </div>
          )}
        </Field>
      );
    }

    if (field.kind === "number" || field.kind === "date" || field.kind === "color") {
      const type = field.kind;
      return (
        <Field controlId={controlId} label={field.label} required={field.required} kind={kind}>
          {(control) => <UnmodeledInput type={type} value={valueOf(field.id)} field={control} commit={commit} />}
        </Field>
      );
    }

    const draft = externalDraft(scope, textOf(field.id));
    return (
      <Field controlId={controlId} label={field.label} required={field.required} kind={kind}>
        {(control) => (
          <Input
            field={control}
            type={field.kind === "url" ? "url" : "text"}
            class={field.kind === "url" ? "sg-content-mono" : undefined}
            modelValue={draft}
            on:input={(event) => commit(event.currentTarget.value)}
          />
        )}
      </Field>
    );
  };

  return (
    <div class="sg-content-form">
      {fields.map(renderField)}

      <section class="sg-content-group">
        <h3 class="sg-content-group__title">Metadata</h3>
        <dl class="sg-content-meta">
          <div class="sg-content-meta__row">
            <dt>ID</dt>
            <dd><code class="sg-content-mono">{entryId}</code></dd>
          </div>
          <div class="sg-content-meta__row">
            <dt>Created</dt>
            <dd>{formatLibraryTimestampFull(lastEntry.createdAt)}</dd>
          </div>
          <div class="sg-content-meta__row">
            <dt>Updated</dt>
            <dd>{computed(() => formatLibraryTimestampFull(entry.value.updatedAt))}</dd>
          </div>
        </dl>
      </section>
      <ArticleAiPanel controller={controller} state={state} entry={entry} fields={allFields} integration={integration} />
      <EntryHistory controller={controller} entry={entry} fields={allFields} refreshKey={computed(() => `${entry.value.updatedAt}:${state.value.saveStatus}`)} notice={computed(() => state.value.historyNotice)} />
    </div>
  );
}
