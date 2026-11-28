// Recursive Composer inspector field renderer.
//
// Component props remain plain JSON values. This module renders the canonical
// contract-v2 schema/editor pairs directly and never stores an editor wrapper in
// the document. Leaf edits carry their exact relative path to InspectorPanel;
// list/group structure changes carry a structural marker so the controller can
// make them standalone history checkpoints.
//
// Every editor runs once and follows its value through a signal, so a focused
// leaf keeps its element, caret and draft while siblings update around it.
// Only a change of SHAPE (an item appearing, a value changing type) mounts or
// unmounts an editor.

import { computed, For, getScope, signal, Show, type Child, type ReadonlySignal } from "@takazudo/zfb/zudo-react";
import type {
  ArrayValueDefinition,
  FieldDefinition,
  JsonObject,
  JsonValue,
  ObjectValueDefinition,
  ObjectFieldDefinition,
  TupleValueDefinition,
  TupleItemDefinition,
  ValueDefinition,
} from "@zudo-composer/component-contract";
import { ContractValidationError, validateFieldValue } from "@zudo-composer/component-contract";
import { read, toSignal, type MaybeSignal } from "../../../../components/reactive";
import { Keyed } from "../../../../runtime";
import { Button, Checkbox, Field, Input, Select, Textarea } from "../../../../components/ui";
import type { FieldControl } from "../../../../components/ui/field-context";
import type { PropPath } from "../../chrome/history-model";
import { createNumericField } from "./use-numeric-field";
import { createTextField } from "./use-text-field";
import { createDomId } from "../../../../components/use-dom-id";

type InspectorDefinition = FieldDefinition | ValueDefinition | ObjectFieldDefinition | TupleItemDefinition;
type InspectorValue = JsonValue | undefined;
type CommitChannel = "keystream" | "discrete" | "structural";
type RelativePath = readonly (string | number)[];

/** A path is relative to the top-level field while this file is recursing. */
export type InspectorCommit = (value: JsonValue, path?: PropPath, structural?: boolean) => void;

export interface InspectorFieldProps {
  field: FieldDefinition;
  /** Undefined is meaningful: it is an omitted optional prop, not JSON null. A signal follows the document. */
  value: MaybeSignal<InspectorValue>;
  disabled: MaybeSignal<boolean>;
  onCommit: InspectorCommit;
  /** Debounced channel for text/color/number leaves. */
  onCommitDebounced?: InspectorCommit;
  /** Land any debounce-pending commit now (called on every text/number blur). */
  onFlushPending?: () => void;
  /** Remove an optional top-level prop while preserving true omission. */
  onRemove?: () => void;
}

const FIELD_LABEL_CLASS = "cms-field__label-text";
/** The compact chrome button the composite editors use for their own structure actions. */
const STRUCTURE_BUTTON_CLASS = "cms-btn cms-btn--xs";

/**
 * A labelled leaf is a `Field`; an unlabelled one — a list item's scalar, say —
 * is the bare control, because a `Field` with no label text would render an
 * empty label element and claim the control has a name it does not have.
 */
function FieldRow({
  label,
  controlId,
  error,
  children,
}: {
  label: string | undefined;
  controlId: string;
  error?: ReadonlySignal<string | null>;
  children: (field: FieldControl | undefined) => Child;
}): Child {
  if (label === undefined) {
    return (
      <div class="sg-composer-inspector-row">
        {children(undefined)}
        {error ? (
          <Show when={computed(() => error.value !== null)}>
            {() => <p class="cms-field__error" role="alert">{error}</p>}
          </Show>
        ) : null}
      </div>
    );
  }
  return (
    <Field label={label} controlId={controlId} error={error ?? undefined}>
      {(field) => children(field)}
    </Field>
  );
}

function labelFor(definition: InspectorDefinition): string | undefined {
  if ("label" in definition && typeof definition.label === "string") return definition.label;
  return undefined;
}

function isStructured(definition: InspectorDefinition): boolean {
  return definition.editor.kind === "list" || definition.editor.kind === "tuple" || definition.editor.kind === "group";
}

function fingerprint(value: InspectorValue): string {
  return value === undefined ? "__undefined__" : JSON.stringify(value);
}

function isObjectValue(value: InspectorValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function setAtPath(value: JsonValue, path: readonly (string | number)[], next: JsonValue): JsonValue {
  if (path.length === 0) return next;
  const [segment, ...rest] = path;
  if (Array.isArray(value)) {
    const index = typeof segment === "number" ? segment : Number(segment);
    const copy = [...value] as JsonValue[];
    copy[index] = setAtPath(copy[index] ?? null, rest, next);
    return copy;
  }
  const object: Record<string, JsonValue> = isObjectValue(value) ? { ...value } : {};
  const key = String(segment);
  object[key] = setAtPath(object[key] ?? null, rest, next);
  return object;
}

/** Build the deterministic seed required by list Add and optional-key Add. */
export function seedValue(definition: ValueDefinition): JsonValue | undefined {
  switch (definition.editor.kind) {
    case "text":
    case "color":
      return "";
    case "select":
      return (definition as { schema: { enum: readonly [string, ...string[]] } }).schema.enum[0];
    case "boolean":
      return false;
    case "number": {
      const { min, max, step } = (definition as { schema: { min?: number; max?: number; step?: number } }).schema;
      if (step === undefined) {
        const candidate = min !== undefined && min >= 0 ? min : max !== undefined && max < 0 ? max : 0;
        if ((min === undefined || candidate >= min) && (max === undefined || candidate <= max)) return candidate;
        return undefined;
      }
      // Pick the valid step nearest zero. The two candidates around zero are
      // enough because the domain is an arithmetic progression.
      const base = min ?? 0;
      const lower = min === undefined ? Number.NEGATIVE_INFINITY : Math.ceil((min - base) / step - 1e-9);
      const upper = max === undefined ? Number.POSITIVE_INFINITY : Math.floor((max - base) / step + 1e-9);
      if (lower > upper) return undefined;
      const aroundZero = Math.round((0 - base) / step);
      const candidates = [aroundZero - 1, aroundZero, aroundZero + 1];
      if (Number.isFinite(lower)) candidates.push(lower, lower + 1);
      if (Number.isFinite(upper)) candidates.push(upper, upper - 1);
      const valid = candidates
        .filter((index) => index >= lower && index <= upper)
        .map((index) => base + index * step)
        .filter((candidate) => Number.isFinite(candidate))
        .filter((candidate) => (min === undefined || candidate >= min) && (max === undefined || candidate <= max));
      if (valid.length === 0) return undefined;
      valid.sort((left, right) => Math.abs(left) - Math.abs(right) || (right >= 0 ? 1 : -1) - (left >= 0 ? 1 : -1));
      return valid[0];
    }
    case "list":
      return [];
    case "tuple": {
      const items: JsonValue[] = [];
      for (const item of (definition as TupleValueDefinition).schema.items) {
        const seed = seedValue(item);
        if (seed === undefined) return undefined;
        items.push(seed);
      }
      return items;
    }
    case "group": {
      const object: Record<string, JsonValue> = {};
      for (const field of (definition as ObjectValueDefinition).schema.fields) {
        const seed = seedValue(field);
        if (seed === undefined) {
          if (field.required === true) return undefined;
          continue;
        }
        // Optional fields intentionally start omitted. Add/Remove therefore
        // preserves the distinction between absence and a present empty value.
        if (field.required === true) object[field.key] = seed;
      }
      return object;
    }
    default:
      return undefined;
  }
}

function emitCommit(
  channel: CommitChannel,
  value: JsonValue,
  path: PropPath | undefined,
  onCommit: InspectorCommit,
  onCommitDebounced: InspectorCommit | undefined,
): void {
  if (channel === "structural") {
    onCommit(value, undefined, true);
    return;
  }
  const callback = channel === "keystream" ? (onCommitDebounced ?? onCommit) : onCommit;
  // Keep the old two-argument top-level callback shape. Nested paths are
  // explicit so controller history can distinguish every edited leaf.
  if (path === undefined || path.length === 0) callback(value);
  else callback(value, path, false);
}

function validationMessage(field: FieldDefinition, value: InspectorValue): string | null {
  if (value === undefined) return null;
  try {
    validateFieldValue(field, value, `$props.${field.prop}`);
    return null;
  } catch (error) {
    return error instanceof ContractValidationError
      ? error.message.replace("one of the select enum values", "one of the allowed options")
      : "Stored value does not match its component schema.";
  }
}

/** One canonical top-level field, including optional omission handling. */
export function InspectorField({
  field,
  value: valueProp,
  disabled,
  onCommit,
  onCommitDebounced,
  onFlushPending,
  onRemove,
}: InspectorFieldProps): Child {
  const value = toSignal(valueProp);
  const disabledSignal = computed(() => read(disabled));
  // An absent optional prop is offered by the inspector's own "Optional props"
  // section, not here: this renderer only ever draws a value that exists.
  const missing = computed(() => value.value === undefined);
  return (
    <Keyed value={missing} by={(isMissing) => (isMissing ? "missing" : "present")}>
      {(isMissing) => isMissing.value ? (
        <div class="sg-composer-inspector-row" data-sg-inspector-missing-required={field.prop}>
          <span class={FIELD_LABEL_CLASS}>{field.label}</span>
          <p class="cms-field__error" role="alert">Required value is missing.</p>
        </div>
      ) : (
        <PresentInspectorField
          field={field}
          value={value}
          disabled={disabledSignal}
          onCommit={onCommit}
          onCommitDebounced={onCommitDebounced}
          onFlushPending={onFlushPending}
          onRemove={onRemove}
        />
      )}
    </Keyed>
  );
}

function PresentInspectorField({
  field,
  value,
  disabled,
  onCommit,
  onCommitDebounced,
  onFlushPending,
  onRemove,
}: Omit<InspectorFieldProps, "value" | "disabled"> & { value: ReadonlySignal<InspectorValue>; disabled: ReadonlySignal<boolean> }): Child {
  const structured = isStructured(field);
  const editor = structured ? (
      <StructuredFieldDraft
        field={field}
        value={value}
        disabled={disabled}
        onCommit={onCommit}
        onCommitDebounced={onCommitDebounced}
        onFlushPending={onFlushPending}
      />
    ) : (
      <ValueEditor
        definition={field}
        value={value}
        path={[]}
        disabled={disabled}
        onLeafCommit={(next, path, channel) => emitCommit(channel, next, path.length === 0 ? undefined : [field.prop, ...path] as PropPath, onCommit, onCommitDebounced)}
        onStructuralCommit={(next) => emitCommit("structural", next, undefined, onCommit, onCommitDebounced)}
        onFlushPending={onFlushPending}
      />
    );
  const invalidValue = computed(() => (structured ? null : validationMessage(field, value.value)));
  return (
    <div class="sg-composer-inspector-row">
      <Show when={computed(() => invalidValue.value !== null)}>
        {() => <p class="cms-field__error" role="alert" data-sg-inspector-validation>{invalidValue}</p>}
      </Show>
      {editor}
      {field.required !== true && onRemove ? (
        <Button size="xs" variant="ghost" disabled={disabled} on:click={() => onRemove()}>
          Remove {field.label}
        </Button>
      ) : null}
    </div>
  );
}

interface ValueEditorProps {
  definition: InspectorDefinition;
  value: ReadonlySignal<InspectorValue>;
  path: RelativePath;
  labelOverride?: string;
  disabled: ReadonlySignal<boolean>;
  onLeafCommit: (value: JsonValue, path: RelativePath, channel: Exclude<CommitChannel, "structural">) => void;
  onStructuralCommit: (value: JsonValue) => void;
  onFlushPending?: () => void;
  onEditingChange?: (focused: boolean) => void;
}

function ValueEditor({
  definition,
  value,
  path,
  labelOverride,
  disabled,
  onLeafCommit,
  onStructuralCommit,
  onFlushPending,
  onEditingChange,
}: ValueEditorProps): Child {
  const inputId = createDomId();
  const errorId = createDomId();
  const label = labelOverride ?? labelFor(definition);
  switch (definition.editor.kind) {
    case "text":
      return (
        <ScalarTextEditor
          label={label}
          value={computed(() => (typeof value.value === "string" ? value.value : ""))}
          multiline={definition.editor.multiline === true}
          disabled={disabled}
          inputId={inputId}
          onCommit={(next) => onLeafCommit(next, path, "keystream")}
          onFlushPending={onFlushPending}
          onEditingChange={onEditingChange}
        />
      );
    case "color":
      return (
        <ScalarTextEditor
          label={label}
          value={computed(() => (typeof value.value === "string" ? value.value : ""))}
          multiline={false}
          swatch
          disabled={disabled}
          inputId={inputId}
          onCommit={(next) => onLeafCommit(next, path, "keystream")}
          onFlushPending={onFlushPending}
          onEditingChange={onEditingChange}
        />
      );
    case "select":
      return (
        <ScalarSelectEditor
          label={label}
          value={value}
          options={(definition as { schema: { enum: readonly string[] } }).schema.enum}
          disabled={disabled}
          inputId={inputId}
          onCommit={(next) => onLeafCommit(next, path, "discrete")}
        />
      );
    case "number":
      return (
        <ScalarNumberEditor
          label={label}
          value={computed(() => (typeof value.value === "number" ? value.value : 0))}
          min={(definition as { schema: { min?: number } }).schema.min}
          max={(definition as { schema: { max?: number } }).schema.max}
          step={(definition as { schema: { step?: number } }).schema.step}
          disabled={disabled}
          inputId={inputId}
          errorId={errorId}
          onCommit={(next) => onLeafCommit(next, path, "keystream")}
          onFlushPending={onFlushPending}
          onEditingChange={onEditingChange}
        />
      );
    case "boolean": {
      return (
        <Checkbox
          id={inputId}
          checked={computed(() => value.value === true)}
          disabled={disabled}
          // An unlabelled boolean is a list or tuple item, which the composite
          // editors name by position rather than by prop.
          {...(label === undefined ? { "aria-label": "Value" } : { label })}
          onCheckedChange={(checked) => onLeafCommit(checked, path, "discrete")}
        />
      );
    }
    case "list":
      return (
        <ListValueEditor
          definition={definition as ListDefinition}
          value={value}
          path={path}
          label={label}
          disabled={disabled}
          onLeafCommit={onLeafCommit}
          onStructuralCommit={onStructuralCommit}
          onFlushPending={onFlushPending}
          onEditingChange={onEditingChange}
        />
      );
    case "tuple":
      return (
        <TupleValueEditor
          definition={definition as TupleDefinition}
          value={value}
          path={path}
          label={label}
          disabled={disabled}
          onLeafCommit={onLeafCommit}
          onStructuralCommit={onStructuralCommit}
          onFlushPending={onFlushPending}
          onEditingChange={onEditingChange}
        />
      );
    case "group":
      return (
        <GroupValueEditor
          definition={definition as GroupDefinition}
          value={value}
          path={path}
          label={label}
          disabled={disabled}
          onLeafCommit={onLeafCommit}
          onStructuralCommit={onStructuralCommit}
          onFlushPending={onFlushPending}
          onEditingChange={onEditingChange}
        />
      );
    default:
      return assertNever(definition as never);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Composer editor kind: ${JSON.stringify(value)}`);
}

interface ScalarTextEditorProps {
  label: string | undefined;
  value: ReadonlySignal<string>;
  multiline: boolean;
  swatch?: boolean;
  disabled: ReadonlySignal<boolean>;
  inputId: string;
  onCommit: (value: string) => void;
  onFlushPending?: () => void;
  onEditingChange?: (focused: boolean) => void;
}

function ScalarTextEditor({
  label,
  value,
  multiline,
  swatch,
  disabled,
  inputId,
  onCommit,
  onFlushPending,
  onEditingChange,
}: ScalarTextEditorProps): Child {
  const { draft, onInput, onFocus, onBlur } = createTextField(getScope(), { value, onCommit });
  const handleFocus = () => {
    onFocus();
    onEditingChange?.(true);
  };
  const handleBlur = () => {
    onBlur();
    onEditingChange?.(false);
    onFlushPending?.();
  };
  return (
    <FieldRow label={label} controlId={inputId}>
      {(field) => (
        <div class="sg-composer-inspector-control-row">
          {swatch ? <span class="sg-composer-inspector-swatch" style={computed(() => ({ "background-color": draft.value || "transparent" }))} aria-hidden="true" /> : null}
          {multiline ? (
            <Textarea
              field={field}
              id={inputId}
              modelValue={draft}
              disabled={disabled}
              rows={3}
              on:input={(event: Event) => {
                if (event.currentTarget instanceof HTMLTextAreaElement) onInput(event.currentTarget.value);
              }}
              on:focus={handleFocus}
              on:blur={handleBlur}
            />
          ) : (
            <Input
              field={field}
              id={inputId}
              type="text"
              size="sm"
              modelValue={draft}
              disabled={disabled}
              on:input={(event: Event) => {
                if (event.currentTarget instanceof HTMLInputElement) onInput(event.currentTarget.value);
              }}
              on:focus={handleFocus}
              on:blur={handleBlur}
            />
          )}
        </div>
      )}
    </FieldRow>
  );
}

interface ScalarNumberEditorProps {
  label: string | undefined;
  value: ReadonlySignal<number>;
  min?: number;
  max?: number;
  step?: number;
  disabled: ReadonlySignal<boolean>;
  inputId: string;
  errorId: string;
  onCommit: (value: number) => void;
  onFlushPending?: () => void;
  onEditingChange?: (focused: boolean) => void;
}

function ScalarNumberEditor({
  label,
  value,
  min,
  max,
  step,
  disabled,
  inputId,
  errorId,
  onCommit,
  onFlushPending,
  onEditingChange,
}: ScalarNumberEditorProps): Child {
  const inputRef: { current: HTMLInputElement | null } = { current: null };
  const { draft, error, onInput, onFocus, onBlur } = createNumericField(getScope(), {
    value,
    min,
    max,
    step,
    onCommit,
    writeDom: (text) => {
      if (inputRef.current && inputRef.current.value !== text) inputRef.current.value = text;
    },
  });
  const handleFocus = () => {
    onFocus();
    onEditingChange?.(true);
  };
  const handleBlur = () => {
    onBlur();
    onEditingChange?.(false);
    onFlushPending?.();
  };
  const hasError = computed(() => error.value !== null);
  return (
    <FieldRow label={label} controlId={inputId} error={error}>
      {(field) => (
        <>
          <Input
            field={field}
            elementRef={inputRef}
            id={inputId}
            type="number"
            size="sm"
            value={draft.value}
            min={min === undefined ? undefined : String(min)}
            max={max === undefined ? undefined : String(max)}
            // An omitted contract step accepts any finite number; HTML defaults to 1.
            step={step === undefined ? "any" : String(step)}
            disabled={disabled}
            aria-invalid={computed(() => (hasError.value ? "true" : undefined))}
            // A labelled field is described by `Field`'s own error element; only the
            // unlabelled case (a list item's scalar) needs its own wiring.
            aria-describedby={label === undefined ? computed(() => (hasError.value ? errorId : undefined)) : field?.describedBy}
            on:input={(event: Event) => {
              if (event.currentTarget instanceof HTMLInputElement) onInput(event.currentTarget.value);
            }}
            on:focus={handleFocus}
            on:blur={handleBlur}
          />
          {label === undefined ? (
            <Show when={hasError}>{() => <p id={errorId} class="cms-field__error" role="alert">{error}</p>}</Show>
          ) : null}
        </>
      )}
    </FieldRow>
  );
}

interface ScalarSelectEditorProps {
  label: string | undefined;
  value: ReadonlySignal<InspectorValue>;
  options: readonly string[];
  disabled: ReadonlySignal<boolean>;
  inputId: string;
  onCommit: (value: string) => void;
}

function ScalarSelectEditor({ label, value, options, disabled, inputId, onCommit }: ScalarSelectEditorProps): Child {
  const current = computed(() => (typeof value.value === "string" ? value.value : ""));
  // The option set is static per select, so an invalid stored value (which
  // needs its own extra option) rebuilds the whole control around it.
  const optionSet = computed(() => {
    const now = current.value;
    return options.includes(now) ? { invalid: null } : { invalid: now };
  });
  return (
    <FieldRow label={label} controlId={inputId}>
      {(field) => (
        <Keyed value={optionSet} by={(set) => (set.invalid === null ? "valid" : `invalid:${set.invalid}`)}>
          {(set) => {
            const invalid = set.value.invalid;
            const model = signal(current.value);
            getScope().effect(() => {
              model.value = current.value;
            });
            return (
              <Select
                field={field}
                id={inputId}
                size="sm"
                modelValue={model}
                disabled={disabled}
                aria-invalid={invalid !== null ? "true" : undefined}
                on:change={(event: Event) => {
                  if (event.currentTarget instanceof HTMLSelectElement) onCommit(event.currentTarget.value);
                }}
              >
                {invalid !== null ? <option value={invalid}>{`${invalid || "Invalid value"} (invalid)`}</option> : null}
                {options.map((option) => <option value={option}>{option}</option>)}
              </Select>
            );
          }}
        </Keyed>
      )}
    </FieldRow>
  );
}

type ListDefinition = ArrayValueDefinition;
type TupleDefinition = TupleValueDefinition;
type GroupDefinition = ObjectValueDefinition;

interface CompositeEditorProps {
  value: ReadonlySignal<InspectorValue>;
  path: RelativePath;
  label: string | undefined;
  disabled: ReadonlySignal<boolean>;
  onLeafCommit: ValueEditorProps["onLeafCommit"];
  onStructuralCommit: (value: JsonValue) => void;
  onFlushPending?: () => void;
  onEditingChange?: (focused: boolean) => void;
}

function ListValueEditor(props: CompositeEditorProps & { definition: ListDefinition }): Child {
  const { value, label } = props;
  const isList = computed(() => Array.isArray(value.value));
  return (
    <Show
      when={isList}
      fallback={() => (
        <div class="flex flex-col gap-vsp-3xs">
          {label ? <span class={FIELD_LABEL_CLASS}>{label}</span> : null}
          <p class="text-caption text-danger" role="alert">{label ?? "Value"} must be an ordered list.</p>
        </div>
      )}
    >
      {() => <ListItemsEditor {...props} />}
    </Show>
  );
}

function ListItemsEditor({
  definition,
  value,
  path,
  label,
  disabled,
  onLeafCommit,
  onStructuralCommit,
  onFlushPending,
  onEditingChange,
}: CompositeEditorProps & { definition: ListDefinition }): Child {
  const expanded = signal<ReadonlySet<number>>(new Set());
  let draggedIndex: number | null = null;
  const items = computed(() => (Array.isArray(value.value) ? value.value : []) as readonly JsonValue[]);
  const indices = computed(() => items.value.map((_, index) => index));
  const itemDefinition = definition.schema.items;
  const pathKey = path.join(".");

  const move = (from: number, to: number): void => {
    const current = items.value;
    if (to < 0 || to >= current.length || from === to) return;
    const next = [...current];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    onStructuralCommit(next);
    const result = new Set<number>();
    for (const index of expanded.value) {
      if (index === from) result.add(to);
      else if (from < to && index > from && index <= to) result.add(index - 1);
      else if (from > to && index >= to && index < from) result.add(index + 1);
      else result.add(index);
    }
    expanded.value = result;
  };

  const addSeed = seedValue(itemDefinition);
  const collapsible = itemDefinition.editor.kind === "group";
  return (
    <div class="flex flex-col gap-vsp-3xs" data-sg-inspector-list={pathKey}>
      {label ? <span class={FIELD_LABEL_CLASS}>{label}</span> : null}
      <For each={indices} by={(index) => `${pathKey}-${index}`}>
        {(indexSignal) => {
          const index = indexSignal.value;
          const item = computed(() => items.value[index] as InspectorValue);
          const isExpanded = computed(() => !collapsible || expanded.value.has(index));
          const summary = computed(() => itemSummary(itemDefinition, items.value[index] ?? null, index));
          return (
            <div
              data-sg-inspector-list-item={index}
              class="flex flex-col gap-vsp-3xs rounded-md border border-border p-hsp-sm"
              draggable={computed(() => !disabled.value)}
              on:dragstart={() => { draggedIndex = index; }}
              on:dragend={() => { draggedIndex = null; }}
              on:dragover={(event: DragEvent) => event.preventDefault()}
              on:drop={(event: DragEvent) => {
                event.preventDefault();
                if (draggedIndex !== null) move(draggedIndex, index);
                draggedIndex = null;
              }}
            >
              <div class="flex flex-wrap items-center gap-hsp-2xs">
                {collapsible ? (
                  <button
                    type="button"
                    class={STRUCTURE_BUTTON_CLASS}
                    aria-expanded={isExpanded}
                    disabled={disabled}
                    on:click={() => {
                      const next = new Set(expanded.value);
                      if (next.has(index)) next.delete(index); else next.add(index);
                      expanded.value = next;
                    }}
                  >
                    {summary}
                  </button>
                ) : null}
                <button type="button" class={STRUCTURE_BUTTON_CLASS} disabled={computed(() => disabled.value || index === 0)} on:click={() => move(index, index - 1)}>
                  Move up
                </button>
                <button type="button" class={STRUCTURE_BUTTON_CLASS} disabled={computed(() => disabled.value || index === items.value.length - 1)} on:click={() => move(index, index + 1)}>
                  Move down
                </button>
                <button
                  type="button"
                  class={`${STRUCTURE_BUTTON_CLASS} sg-composer-inspector-remove`}
                  disabled={disabled}
                  on:click={() => {
                    const next = items.value.filter((_, itemIndex) => itemIndex !== index);
                    onStructuralCommit(next);
                    expanded.value = new Set([...expanded.value].filter((itemIndex) => itemIndex !== index).map((itemIndex) => itemIndex > index ? itemIndex - 1 : itemIndex));
                  }}
                >
                  Remove
                </button>
              </div>
              <Show when={isExpanded}>
                {() => (
                  <ValueEditor
                    definition={itemDefinition}
                    value={item}
                    path={[...path, index]}
                    labelOverride={collapsible ? undefined : `Item ${index + 1}`}
                    disabled={disabled}
                    onLeafCommit={onLeafCommit}
                    onStructuralCommit={(next) => {
                      const nextItems = [...items.value];
                      nextItems[index] = next;
                      onStructuralCommit(nextItems);
                    }}
                    onFlushPending={onFlushPending}
                    onEditingChange={onEditingChange}
                  />
                )}
              </Show>
            </div>
          );
        }}
      </For>
      <button
        type="button"
        class={STRUCTURE_BUTTON_CLASS}
        disabled={computed(() => disabled.value || addSeed === undefined)}
        on:click={() => {
          if (addSeed === undefined) return;
          const length = items.value.length;
          onStructuralCommit([...items.value, addSeed]);
          expanded.value = new Set(expanded.value).add(length);
        }}
      >
        Add item
      </button>
      {addSeed === undefined ? <p class="text-caption text-danger" role="alert">Cannot add item: required fields have no deterministic seed.</p> : null}
    </div>
  );
}

function itemSummary(definition: ValueDefinition, value: JsonValue, index: number): string {
  if (definition.editor.kind === "group" && isObjectValue(value)) {
    for (const field of (definition as ObjectValueDefinition).schema.fields) {
      if (field.schema.type === "string" && Object.hasOwn(value, field.key) && typeof value[field.key] === "string") {
        return value[field.key] as string;
      }
    }
  }
  return `Item ${index + 1}`;
}

function TupleValueEditor({
  definition,
  value,
  path,
  label,
  disabled,
  onLeafCommit,
  onStructuralCommit,
  onFlushPending,
  onEditingChange,
}: CompositeEditorProps & { definition: TupleDefinition }): Child {
  const valid = computed(() => Array.isArray(value.value) && value.value.length === definition.schema.items.length);
  const tuple = computed(() => (Array.isArray(value.value) ? value.value : []) as readonly JsonValue[]);
  return (
    <Show
      when={valid}
      fallback={() => (
        <div class="flex flex-col gap-vsp-3xs">
          {label ? <span class={FIELD_LABEL_CLASS}>{label}</span> : null}
          <p class="text-caption text-danger" role="alert">{label ?? "Value"} must contain exactly {definition.schema.items.length} items.</p>
        </div>
      )}
    >
      {() => (
        <div class="flex flex-col gap-vsp-xs" data-sg-inspector-tuple={path.join(".")}>
          {label ? <span class={FIELD_LABEL_CLASS}>{label}</span> : null}
          {definition.schema.items.map((item, index) => (
            <ValueEditor
              key={`${path.join(".")}-${index}`}
              definition={item}
              value={computed(() => tuple.value[index] as InspectorValue)}
              path={[...path, index]}
              disabled={disabled}
              onLeafCommit={onLeafCommit}
              onStructuralCommit={(next) => {
                const nextTuple = [...tuple.value];
                nextTuple[index] = next;
                onStructuralCommit(nextTuple);
              }}
              onFlushPending={onFlushPending}
              onEditingChange={onEditingChange}
            />
          ))}
        </div>
      )}
    </Show>
  );
}

type GroupFieldState = "missing-required" | "absent" | "present";

function GroupValueEditor({
  definition,
  value,
  path,
  label,
  disabled,
  onLeafCommit,
  onStructuralCommit,
  onFlushPending,
  onEditingChange,
}: CompositeEditorProps & { definition: GroupDefinition }): Child {
  const isObject = computed(() => isObjectValue(value.value));
  const object = computed(() => (isObjectValue(value.value) ? value.value : {}) as JsonObject);
  return (
    <Show
      when={isObject}
      fallback={() => (
        <div class="flex flex-col gap-vsp-3xs">
          {label ? <span class={FIELD_LABEL_CLASS}>{label}</span> : null}
          <p class="text-caption text-danger" role="alert">{label ?? "Value"} must be an object.</p>
        </div>
      )}
    >
      {() => (
        <div class="flex flex-col gap-vsp-xs" data-sg-inspector-group={path.join(".")}>
          {label ? <span class={FIELD_LABEL_CLASS}>{label}</span> : null}
          {definition.schema.fields.map((field) => {
            const fieldState = computed((): GroupFieldState => {
              const present = Object.hasOwn(object.value, field.key);
              if (!present && field.required === true) return "missing-required";
              return present ? "present" : "absent";
            });
            return (
              <Keyed value={fieldState} by={(state) => state}>
                {(state) => {
                  if (state.value === "missing-required") {
                    return (
                      <div class="flex flex-col gap-vsp-3xs">
                        <span class={FIELD_LABEL_CLASS}>{field.label}</span>
                        <p class="text-caption text-danger" role="alert">Required field is missing.</p>
                      </div>
                    );
                  }
                  if (state.value === "absent") {
                    const addSeed = seedValue(field);
                    return (
                      <div class="flex flex-col gap-vsp-3xs">
                        <span class={FIELD_LABEL_CLASS}>{field.label}</span>
                        <button
                          type="button"
                          class={STRUCTURE_BUTTON_CLASS}
                          disabled={computed(() => disabled.value || addSeed === undefined)}
                          on:click={() => {
                            if (addSeed === undefined) return;
                            onStructuralCommit({ ...object.value, [field.key]: addSeed });
                          }}
                        >
                          Add {field.label}
                        </button>
                        {addSeed === undefined ? <p class="text-caption text-danger" role="alert">Cannot add {field.label}: no deterministic seed is available.</p> : null}
                      </div>
                    );
                  }
                  return (
                    <div class="flex flex-col gap-vsp-3xs" data-sg-inspector-object-field={field.key}>
                      <ValueEditor
                        definition={field}
                        value={computed(() => object.value[field.key] as InspectorValue)}
                        path={[...path, field.key]}
                        disabled={disabled}
                        onLeafCommit={onLeafCommit}
                        onStructuralCommit={(next) => onStructuralCommit({ ...object.value, [field.key]: next })}
                        onFlushPending={onFlushPending}
                        onEditingChange={onEditingChange}
                      />
                      {field.required !== true ? (
                        <button
                          type="button"
                          class={`${STRUCTURE_BUTTON_CLASS} sg-composer-inspector-remove`}
                          disabled={disabled}
                          on:click={() => {
                            const next: Record<string, JsonValue> = { ...object.value };
                            delete next[field.key];
                            onStructuralCommit(next);
                          }}
                        >
                          Remove {field.label}
                        </button>
                      ) : null}
                    </div>
                  );
                }}
              </Keyed>
            );
          })}
        </div>
      )}
    </Show>
  );
}

/**
 * A structured top-level field owns a local raw-JSON draft. This prevents a
 * debounced edit in one nested leaf from being overwritten by a sibling leaf
 * edit before the controller's document catches up.
 */
export function StructuredFieldDraft({
  field,
  value: valueProp,
  disabled,
  onCommit,
  onCommitDebounced,
  onFlushPending,
}: InspectorFieldProps): Child {
  const value = toSignal(valueProp);
  const draft = signal<InspectorValue>(value.value);
  let sourceFingerprint = fingerprint(value.value);
  let focused = false;

  getScope().effect(() => {
    const incoming = value.value;
    const incomingFingerprint = fingerprint(incoming);
    if (incomingFingerprint === sourceFingerprint) return;
    sourceFingerprint = incomingFingerprint;
    if (!focused) draft.value = incoming;
  });

  const emit = (next: JsonValue, path: PropPath | undefined, channel: CommitChannel): void => {
    if (channel === "structural") {
      onCommit(next, undefined, true);
      return;
    }
    const callback = channel === "keystream" ? (onCommitDebounced ?? onCommit) : onCommit;
    if (path === undefined || path.length === 0) callback(next);
    else callback(next, path, false);
  };

  const leafCommit: ValueEditorProps["onLeafCommit"] = (next, relativePath, channel) => {
    const current = draft.value;
    if (current === undefined) return;
    const nextDraft = setAtPath(current, relativePath.slice(1), next);
    draft.value = nextDraft;
    emit(nextDraft, relativePath.length === 0 ? undefined : relativePath as PropPath, channel);
  };
  const structuralCommit = (next: JsonValue): void => {
    draft.value = next;
    emit(next, undefined, "structural");
  };
  const editingChange = (isFocused: boolean): void => {
    focused = isFocused;
  };

  const validationError = computed(() => validationMessage(field, draft.value));

  return (
    <div class="flex flex-col gap-vsp-3xs">
      <Show when={computed(() => validationError.value !== null)}>
        {() => <p class="text-caption text-danger" role="alert" data-sg-inspector-validation>{validationError}</p>}
      </Show>
      <ValueEditor
        definition={field}
        value={draft}
        path={[field.prop]}
        disabled={computed(() => read(disabled))}
        onLeafCommit={leafCommit}
        onStructuralCommit={structuralCommit}
        onFlushPending={onFlushPending}
        onEditingChange={editingChange}
      />
    </div>
  );
}
