import type { JSX } from "preact";
import { useEffect, useId, useRef, useState } from "preact/hooks";
import { ArrowDownIcon, ArrowUpIcon, EllipsisIcon, ErrorIcon, InfoIcon, PlusIcon, TrashIcon } from "../../components/icons";
import { formatLibraryTimestampFull } from "../../components/library-page";
import { Menu, MenuItem, MenuSeparator, useMenu } from "../../components/overlay";
import { Button, Chip, DataTable, Field, Input, Select, Switch, Textarea, type DataTableColumn } from "../../components/ui";
import { createContentValueSchema, isContentFieldKey, type ContentEntryRecord, type ContentFieldDefinition, type ContentFieldKind } from "../../content";
import type { ContentAuthoringController, ContentAuthoringState } from "./controller";
import { FieldKindPicker, contentFieldKindPresentation } from "./field-kind-picker";
import { MarkdownEditor } from "./markdown-editor";
import { deriveSlug } from "./slug";
import { StructuredValueEditor, type ContentMediaPickerRenderer } from "./structured-field-editor";

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
  label: string;
  value: string;
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
function SchemaTextCell({ label, value, mono = false, validate, onCommit }: SchemaTextCellProps): JSX.Element {
  const errorId = `sg-content-cell-error-${useId()}`;
  const [draft, setDraft] = useState(value);
  // Adjusted during render, not in an effect: an effect runs after paint, so a
  // value replaced from outside (a reload after Remove) would show for a frame.
  const external = useRef(value);
  if (external.current !== value) {
    external.current = value;
    setDraft(value);
  }
  const error = validate(draft);

  return (
    <div class="sg-content-cell">
      <Input
        size="sm"
        class={mono ? "sg-content-mono" : undefined}
        aria-label={label}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={error ? errorId : undefined}
        value={draft}
        onInput={(event) => {
          const next = event.currentTarget.value;
          setDraft(next);
          if (!validate(next)) onCommit(next);
        }}
      />
      {error ? (
        <p class="sg-content-cell__error" id={errorId}>
          <ErrorIcon size="xs" />
          {error}
        </p>
      ) : null}
    </div>
  );
}

interface SchemaFieldMenuProps {
  field: ContentFieldDefinition;
  index: number;
  count: number;
  onMove(direction: -1 | 1): void;
  onRemove(): void;
}

function SchemaFieldMenu({ field, index, count, onMove, onRemove }: SchemaFieldMenuProps): JSX.Element {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menu = useMenu(triggerRef, { align: "end" });
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        elementRef={triggerRef}
        aria-label={`Field actions for ${field.label}`}
        {...menu.triggerProps}
      >
        <EllipsisIcon size="sm" />
      </Button>
      <Menu controller={menu} label={`${field.label} field actions`}>
        <MenuItem icon={ArrowUpIcon} disabled={index === 0} onSelect={() => onMove(-1)}>Move up</MenuItem>
        <MenuItem icon={ArrowDownIcon} disabled={index === count - 1} onSelect={() => onMove(1)}>Move down</MenuItem>
        <MenuSeparator />
        <MenuItem icon={TrashIcon} tone="danger" onSelect={onRemove}>Remove…</MenuItem>
      </Menu>
    </>
  );
}

function FieldSchemaOptions({ field, controller, run }: { field: ContentFieldDefinition; controller: ContentAuthoringController; run: ContentAuthorRun }): JSX.Element | null {
  const [models, setModels] = useState<Awaited<ReturnType<ContentAuthoringController["referenceModels"]>>>([]);
  useEffect(() => { if (field.kind !== "reference" && field.kind !== "reference-list") return; let live = true; void controller.referenceModels().then((items) => { if (live) setModels(items); }); return () => { live = false; }; }, [controller, field.kind]);
  if (field.kind === "choice") return <Textarea aria-label={`Options for ${field.label}`} rows={3} value={field.options.map((option) => `${option.value}|${option.label}`).join("\n")} onBlur={(event) => {
    const options = event.currentTarget.value.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => { const [value, ...label] = line.split("|"); return { value: value!.trim(), label: (label.join("|") || value!).trim() }; }).filter((option) => option.value && option.label);
    if (options.length) run(() => controller.replaceField(field.id, { ...field, options }));
  }} />;
  if (field.kind === "reference" || field.kind === "reference-list") return <div class="sg-content-schema-options"><Select aria-label={`Target model for ${field.label}`} value={`${field.target.providerId}/${field.target.recordId}`} onChange={(event) => { const target = models.find((item) => `${item.ref.providerId}/${item.ref.recordId}` === event.currentTarget.value)?.ref; if (target) run(() => controller.replaceField(field.id, { ...field, target })); }}>{models.map((model) => <option key={`${model.ref.providerId}/${model.ref.recordId}`} value={`${model.ref.providerId}/${model.ref.recordId}`}>{model.label} · {model.providerLabel}</option>)}</Select>{field.kind === "reference-list" ? <Switch label="Preserve explicit order" checked={field.ordered} onCheckedChange={(ordered) => run(() => controller.replaceField(field.id, { ...field, ordered }))} /> : null}</div>;
  if (field.kind === "media-use") return <Select aria-label={`Media presentation for ${field.label}`} value={field.use} onChange={(event) => run(() => controller.replaceField(field.id, { ...field, use: event.currentTarget.value as "image" | "link" | "card" }))}><option value="image">Image</option><option value="link">Link</option><option value="card">Card</option></Select>;
  if (field.kind === "list") return <Select aria-label={`Item type for ${field.label}`} value={field.item.kind} onChange={(event) => run(() => controller.replaceField(field.id, { ...field, item: createContentValueSchema(event.currentTarget.value as ContentFieldKind, { providerId: controller.provider.descriptor.id, recordId: controller.state.model!.id }) }))}>{["text", "long-text", "number", "boolean", "date", "url", "object"].map((kind) => <option value={kind} key={kind}>{contentFieldKindPresentation(kind as ContentFieldKind).label}</option>)}</Select>;
  if (field.kind === "object") return <div class="sg-content-schema-options"><span class="sg-content-hint">{field.fields.length} nested fields</span><Button size="xs" onClick={() => { const index = field.fields.length + 1; const child: ContentFieldDefinition = { id: `nested-${field.id}-${index}`, key: `field${index}`, label: `Nested field ${index}`, required: false, kind: "text" }; run(() => controller.replaceField(field.id, { ...field, fields: [...field.fields, child] })); }}>Add nested field</Button></div>;
  return null;
}

export interface ContentSchemaAuthorProps {
  state: ContentAuthoringState;
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
export function ContentSchemaAuthor({ state, controller, run, onRemove }: ContentSchemaAuthorProps): JSX.Element {
  const model = state.model!;
  const fields = model.document.fields;
  const collection = model.document.kind === "collection";
  const order = new Map(fields.map((field, index) => [field.id, index]));


  const columns: DataTableColumn<ContentFieldDefinition>[] = [
    {
      key: "label",
      header: "Label",
      cell: (field) => (
        <SchemaTextCell
          label={`Label for ${field.label}`}
          value={field.label}
          validate={(next) => (next.trim() === "" ? "Label is required." : null)}
          onCommit={(next) => run(() => controller.updateField(field.id, { label: next }))}
        />
      ),
    },
    {
      key: "key",
      header: "Key",
      cell: (field) => (
        <SchemaTextCell
          label={`Key for ${field.label}`}
          value={field.key}
          mono
          validate={(next) => contentFieldKeyError(next, field.id, fields)}
          onCommit={(next) => run(() => controller.updateField(field.id, { key: next }))}
        />
      ),
    },
    {
      key: "kind",
      header: "Type",
      width: "1%",
      cell: (field) => (
        <FieldKindPicker
          value={field.kind}
          locked={state.usedFieldIds.includes(field.id)}
          label={`Type for ${field.label}`}
          onChange={(kind) => run(() => controller.updateField(field.id, { kind }))}
        />
      ),
    },
    {
      key: "required",
      header: "Required",
      width: "1%",
      cell: (field) => (
        <Switch
          aria-label={`Required for ${field.label}`}
          checked={field.required}
          onCheckedChange={(checked) => run(() => controller.updateField(field.id, { required: checked }))}
        />
      ),
    },
    {
      key: "configuration",
      header: "Configuration",
      cell: (field) => <FieldSchemaOptions field={field} controller={controller} run={run} />,
    },
  ];

  return (
    <div class="sg-content-form">
      <Field controlId="content-model-description" label="Model description" help="Shown in All models so authors can tell similar schemas apart.">
        <Textarea rows={2} value={model.document.description} onInput={(event) => run(() => controller.updateModelDescription(event.currentTarget.value))} />
      </Field>
      <div class="sg-content-locked">
        <span class="sg-content-locked__label">Model kind</span>
        <Chip tone="plain" class="sg-content-locked__chip">
          <InfoIcon size="sm" />
          {collection ? "Collection" : "Single"} · locked after creation
        </Chip>
        <p class="sg-content-hint">
          {collection
            ? "A Collection holds any number of Entries. Kind is immutable after creation to protect Entry cardinality."
            : "A Single holds exactly one Entry. Kind is immutable after creation to protect Entry cardinality."}
        </p>
      </div>

      <section class="sg-content-group">
        <h3 class="sg-content-group__title">Fields</h3>
        <DataTable<ContentFieldDefinition>
          caption={`Fields of ${model.document.name}`}
          density="compact"
          columns={columns}
          rows={fields}
          rowKey={(field) => field.id}
          rowActions={(field) => (
            <SchemaFieldMenu
              field={field}
              index={order.get(field.id) ?? 0}
              count={fields.length}
              onMove={(direction) => run(() => controller.moveField(field.id, direction))}
              onRemove={() => onRemove(field)}
            />
          )}
          empty={<p class="sg-content-hint">This model has no fields yet. Add one to start authoring Entries.</p>}
        />
        <div class="sg-content-group__footer">
          <Button size="sm" onClick={() => run(() => controller.addField())}>
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
  state: ContentAuthoringState;
  controller: ContentAuthoringController;
  run: ContentAuthorRun;
  renderMediaPicker?: ContentMediaPickerRenderer;
}

/**
 * The Entry form: one real widget per field kind.
 *
 * Metadata stops at what this route can answer — id and the two timestamps. An
 * Entry's "used by" is resolved by the Mapping catalogue, which the inspector's
 * Usage tab owns; inventing a count here would mean guessing.
 */
export function ContentEntryAuthor({ state, controller, run, renderMediaPicker }: ContentEntryAuthorProps): JSX.Element {
  const entry = state.entry!;
  const allFields = state.model!.document.fields;
  const view = state.model!.document.presentation?.views.find((item) => item.id === state.viewId);
  const fields = view ? view.fieldIds.flatMap((id) => allFields.filter((field) => field.id === id)) : allFields;
  // The auto-slug source is the field the spec names, not whatever happens to
  // be first: a `text` field keyed `title`.
  const titleField = allFields.find((field) => field.kind === "text" && field.key === "title") ?? null;

  // The host rebuilds `run` every render; the effect below reaches it through a
  // ref so its dependency list stays a statement about the Entry, not the host.
  const runRef = useRef(run);
  runRef.current = run;

  const [autoSlug, setAutoSlug] = useState<Readonly<Record<string, boolean>>>({});
  const lastEntryId = useRef<string | null>(null);
  if (lastEntryId.current !== entry.id) {
    lastEntryId.current = entry.id;
    // Auto-derivation starts on for a slug this Entry has not filled in — which
    // is every slug of a new Entry, and none of an Entry that already has one.
    setAutoSlug(Object.fromEntries(
      fields.filter((field) => field.kind === "slug").map((field) => [field.id, titleField !== null && asText(entry.values[field.id]) === ""]),
    ));
  }

  const titleText = titleField ? asText(entry.values[titleField.id]) : "";
  useEffect(() => {
    if (titleField === null) return;
    const derived = deriveSlug(titleText);
    for (const field of fields) {
      if (field.kind !== "slug" || !autoSlug[field.id]) continue;
      // The only write here that no keystroke asked for, so it goes through the
      // route's reporter rather than throwing out of an effect.
      if (derived !== asText(entry.values[field.id])) runRef.current(() => controller.updateEntryValue(field.id, derived));
    }
    // The write lands back here as a fresh Entry, so the guard above — not the
    // dependency list — is what stops this from looping.
  }, [autoSlug, controller, entry.id, titleField, titleText]);

  return (
    <div class="sg-content-form">
      {fields.map((field) => {
        const controlId = `content-entry-${field.id}`;
        const value = entry.values[field.id];
        const { label: kindLabel, icon: KindIcon } = contentFieldKindPresentation(field.kind);
        // `Field` renders the kind hint inside the `<label>`, where it would
        // otherwise join the accessible name with no separator between the two
        // spans — "TitleShort text". It is a visual aid for a distinction the
        // control already carries (a number announces as a spinbutton, a date as
        // a date), so it is marked decorative and the name stays the label.
        const kind = <span aria-hidden="true"><KindIcon size="xs" />{kindLabel}</span>;
        const commit = (next: ContentEntryRecord["values"][string] | undefined) => run(() => controller.updateEntryValue(field.id, next));

        if (["choice", "reference", "reference-list", "object", "list", "media-use"].includes(field.kind)) {
          return <div class="sg-content-rich-field" data-content-field-id={field.id} data-content-value-path="/" key={field.id}><Field controlId={controlId} label={field.label} required={field.required} kind={kind}><StructuredValueEditor schema={field} field={field} value={value} path={[]} controller={controller} run={run} renderMediaPicker={renderMediaPicker} commit={(next) => controller.updateEntryValue(field.id, next)} /></Field></div>;
        }

        if (field.kind === "markdown") {
          return (
            <MarkdownEditor
              key={field.id}
              identity={`${entry.id}/${field.id}`}
              value={asText(value)}
              label={field.label}
              required={field.required}
              onChange={commit}
            />
          );
        }

        if (field.kind === "boolean") {
          return (
            <Switch
              key={field.id}
              id={controlId}
              class="sg-content-toggle"
              label={<>{field.label}{field.required ? <span class="sg-content-req" aria-hidden="true"> *</span> : null}</>}
              checked={value === true}
              onCheckedChange={(checked) => commit(checked)}
            />
          );
        }

        if (field.kind === "long-text") {
          return (
            <Field key={field.id} controlId={controlId} label={field.label} required={field.required} kind={kind}>
              <Textarea rows={6} value={asText(value)} onInput={(event) => commit(event.currentTarget.value)} />
            </Field>
          );
        }

        if (field.kind === "slug") {
          const auto = autoSlug[field.id] ?? false;
          return (
            <Field key={field.id} controlId={controlId} label={field.label} required={field.required} kind={kind}>
              <div class="sg-content-slug">
                <Input
                  class="sg-content-mono"
                  value={asText(value)}
                  onInput={(event) => {
                    // Typing the slug by hand is what retires the derivation.
                    // Both happen in this one handler, so the effect above sees
                    // the switch already off and leaves the typed value alone.
                    if (auto) setAutoSlug({ ...autoSlug, [field.id]: false });
                    commit(event.currentTarget.value);
                  }}
                />
                {titleField === null ? null : (
                  <Switch
                    id={`${controlId}-auto`}
                    label="Auto from title"
                    checked={auto}
                    onCheckedChange={(checked) => setAutoSlug({ ...autoSlug, [field.id]: checked })}
                  />
                )}
              </div>
            </Field>
          );
        }

        if (field.kind === "number") {
          return (
            <Field key={field.id} controlId={controlId} label={field.label} required={field.required} kind={kind}>
              <Input
                type="number"
                value={asText(value)}
                onInput={(event) => {
                  const numeric = event.currentTarget.valueAsNumber;
                  commit(event.currentTarget.value === "" || !Number.isFinite(numeric) ? undefined : numeric);
                }}
              />
            </Field>
          );
        }

        return (
          <Field key={field.id} controlId={controlId} label={field.label} required={field.required} kind={kind}>
            <Input
              type={field.kind === "date" ? "date" : field.kind === "color" ? "color" : field.kind === "url" ? "url" : "text"}
              class={field.kind === "url" ? "sg-content-mono" : undefined}
              value={asText(value)}
              onInput={(event) => commit(event.currentTarget.value)}
            />
          </Field>
        );
      })}

      <section class="sg-content-group">
        <h3 class="sg-content-group__title">Metadata</h3>
        <dl class="sg-content-meta">
          <div class="sg-content-meta__row">
            <dt>ID</dt>
            <dd><code class="sg-content-mono">{entry.id}</code></dd>
          </div>
          <div class="sg-content-meta__row">
            <dt>Created</dt>
            <dd>{formatLibraryTimestampFull(entry.createdAt)}</dd>
          </div>
          <div class="sg-content-meta__row">
            <dt>Updated</dt>
            <dd>{formatLibraryTimestampFull(entry.updatedAt)}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
