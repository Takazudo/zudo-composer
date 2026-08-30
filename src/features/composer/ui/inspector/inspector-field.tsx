/** @jsxRuntime automatic */
/** @jsxImportSource preact */

// Recursive Composer inspector field renderer.
//
// Component props remain plain JSON values. This module renders the canonical
// contract-v2 schema/editor pairs directly and never stores an editor wrapper in
// the document. Leaf edits carry their exact relative path to InspectorPanel;
// list/group structure changes carry a structural marker so the controller can
// make them standalone history checkpoints.

import { useEffect, useId, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
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
import type { PropPath } from "../../chrome/history-model";
import { useNumericField } from "./use-numeric-field";
import { useTextField } from "./use-text-field";

type InspectorDefinition = FieldDefinition | ValueDefinition | ObjectFieldDefinition | TupleItemDefinition;
type InspectorValue = JsonValue | undefined;
type CommitChannel = "keystream" | "discrete" | "structural";
type RelativePath = readonly (string | number)[];

/** A path is relative to the top-level field while this file is recursing. */
export type InspectorCommit = (value: JsonValue, path?: PropPath, structural?: boolean) => void;

export interface InspectorFieldProps {
  field: FieldDefinition;
  /** Undefined is meaningful: it is an omitted optional prop, not JSON null. */
  value: InspectorValue;
  disabled: boolean;
  onCommit: InspectorCommit;
  /** Debounced channel for text/color/number leaves. */
  onCommitDebounced?: InspectorCommit;
  /** Land any debounce-pending commit now (called on every text/number blur). */
  onFlushPending?: () => void;
  /** Remove an optional top-level prop while preserving true omission. */
  onRemove?: () => void;
}

const FIELD_LABEL_CLASS = "block text-caption font-medium text-muted";
const FIELD_INPUT_CLASS =
  "sg-composer-inspector-control w-full rounded-md border border-border bg-surface px-hsp-sm text-small text-fg disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger";
const STRUCTURE_BUTTON_CLASS = "sg-composer-toolbar-button";

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
  value,
  disabled,
  onCommit,
  onCommitDebounced,
  onFlushPending,
  onRemove,
}: InspectorFieldProps): JSX.Element {
  const addSeed = value === undefined ? seedValue(field) : undefined;
  if (value === undefined && field.required !== true) {
    const message = addSeed === undefined ? "Cannot add this value: its required fields have no deterministic seed." : null;
    return (
      <div class="flex flex-col gap-vsp-3xs" data-sg-inspector-optional-field={field.prop}>
        <span class={FIELD_LABEL_CLASS}>{field.label}</span>
        <button
          type="button"
          class={STRUCTURE_BUTTON_CLASS}
          disabled={disabled || addSeed === undefined}
          aria-label={`Add ${field.label}`}
          onClick={() => {
            if (addSeed !== undefined) emitCommit("structural", addSeed, undefined, onCommit, onCommitDebounced);
          }}
        >
          Add {field.label}
        </button>
        {message && <p class="text-caption text-danger" role="alert">{message}</p>}
      </div>
    );
  }

  if (value === undefined) {
    return (
      <div class="flex flex-col gap-vsp-3xs" data-sg-inspector-missing-required={field.prop}>
        <span class={FIELD_LABEL_CLASS}>{field.label}</span>
        <p class="text-caption text-danger" role="alert">Required value is missing.</p>
      </div>
    );
  }

  const editor = isStructured(field) ? (
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
  const invalidValue = isStructured(field) ? null : validationMessage(field, value);
  return (
    <div class="flex flex-col gap-vsp-3xs">
      {invalidValue && <p class="text-caption text-danger" role="alert" data-sg-inspector-validation>{invalidValue}</p>}
      {editor}
      {field.required !== true && onRemove && (
        <button
          type="button"
          class={`${STRUCTURE_BUTTON_CLASS} sg-composer-inspector-remove`}
          disabled={disabled}
          onClick={onRemove}
        >
          Remove {field.label}
        </button>
      )}
    </div>
  );
}

interface ValueEditorProps {
  definition: InspectorDefinition;
  value: InspectorValue;
  path: RelativePath;
  labelOverride?: string;
  disabled: boolean;
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
}: ValueEditorProps): JSX.Element {
  // Allocate control ids for every editor invocation before branching. This
  // keeps hook order stable even if a caller replaces a definition at runtime.
  const inputId = useId();
  const errorId = useId();
  const label = labelOverride ?? labelFor(definition);
  switch (definition.editor.kind) {
    case "text":
      return (
        <ScalarTextEditor
          label={label}
          value={typeof value === "string" ? value : ""}
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
          value={typeof value === "string" ? value : ""}
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
          value={typeof value === "number" ? value : 0}
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
        <label
          class="sg-composer-inspector-control flex cursor-pointer items-center gap-hsp-xs text-small text-fg has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50"
          for={inputId}
        >
          <input
            id={inputId}
            type="checkbox"
            class="h-4 w-4 accent-accent"
            checked={value === true}
            disabled={disabled}
            onChange={(event) => {
              if (event.currentTarget instanceof HTMLInputElement) onLeafCommit(event.currentTarget.checked, path, "discrete");
            }}
          />
          <span>{label}</span>
        </label>
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
  value: string;
  multiline: boolean;
  swatch?: boolean;
  disabled: boolean;
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
}: ScalarTextEditorProps): JSX.Element {
  const { draft, onInput, onFocus, onBlur } = useTextField({ value, onCommit });
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
    <div class="flex flex-col gap-vsp-3xs">
      {label && <label class={FIELD_LABEL_CLASS} for={inputId}>{label}</label>}
      <div class="flex items-center gap-hsp-xs">
        {swatch && <span class="sg-composer-inspector-swatch" style={{ backgroundColor: draft || "transparent" }} aria-hidden="true" />}
        {multiline ? (
          <textarea
            id={inputId}
            class="w-full rounded-md border border-border bg-surface px-hsp-sm py-vsp-2xs text-small text-fg disabled:cursor-not-allowed disabled:opacity-50"
            value={draft}
            disabled={disabled}
            rows={3}
            onInput={(event) => {
              if (event.currentTarget instanceof HTMLTextAreaElement) onInput(event.currentTarget.value);
            }}
            onFocus={handleFocus}
            onBlur={handleBlur}
          />
        ) : (
          <input
            id={inputId}
            type="text"
            class={FIELD_INPUT_CLASS}
            value={draft}
            disabled={disabled}
            onInput={(event) => {
              if (event.currentTarget instanceof HTMLInputElement) onInput(event.currentTarget.value);
            }}
            onFocus={handleFocus}
            onBlur={handleBlur}
          />
        )}
      </div>
    </div>
  );
}

interface ScalarNumberEditorProps {
  label: string | undefined;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  disabled: boolean;
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
}: ScalarNumberEditorProps): JSX.Element {
  const { draft, error, onInput, onFocus, onBlur } = useNumericField({ value, min, max, step, onCommit });
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
    <div class="flex flex-col gap-vsp-3xs">
      {label && <label class={FIELD_LABEL_CLASS} for={inputId}>{label}</label>}
      <input
        id={inputId}
        type="number"
        class={FIELD_INPUT_CLASS}
        value={draft}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        aria-invalid={error !== null}
        aria-describedby={error !== null ? errorId : undefined}
        onInput={(event) => {
          if (event.currentTarget instanceof HTMLInputElement) onInput(event.currentTarget.value);
        }}
        onFocus={handleFocus}
        onBlur={handleBlur}
      />
      {error !== null && <p id={errorId} class="text-caption text-danger" role="alert">{error}</p>}
    </div>
  );
}

interface ScalarSelectEditorProps {
  label: string | undefined;
  value: InspectorValue;
  options: readonly string[];
  disabled: boolean;
  inputId: string;
  onCommit: (value: string) => void;
}

function ScalarSelectEditor({ label, value, options, disabled, inputId, onCommit }: ScalarSelectEditorProps): JSX.Element {
  const current = typeof value === "string" ? value : "";
  const invalid = !options.includes(current);
  return (
    <div class="flex flex-col gap-vsp-3xs">
      {label && <label class={FIELD_LABEL_CLASS} for={inputId}>{label}</label>}
      <select
        id={inputId}
        class={FIELD_INPUT_CLASS}
        value={current}
        disabled={disabled}
        aria-invalid={invalid}
        onChange={(event) => {
          if (event.currentTarget instanceof HTMLSelectElement) onCommit(event.currentTarget.value);
        }}
      >
        {invalid && <option value={current}>{current || "Invalid value"} (invalid)</option>}
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </div>
  );
}

type ListDefinition = ArrayValueDefinition;
type TupleDefinition = TupleValueDefinition;
type GroupDefinition = ObjectValueDefinition;

interface CompositeEditorProps {
  value: InspectorValue;
  path: RelativePath;
  label: string | undefined;
  disabled: boolean;
  onLeafCommit: ValueEditorProps["onLeafCommit"];
  onStructuralCommit: (value: JsonValue) => void;
  onFlushPending?: () => void;
  onEditingChange?: (focused: boolean) => void;
}

function ListValueEditor({
  definition,
  value,
  path,
  label,
  disabled,
  onLeafCommit,
  onStructuralCommit,
  onFlushPending,
  onEditingChange,
}: CompositeEditorProps & { definition: ListDefinition }): JSX.Element {
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set());
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const items = Array.isArray(value) ? value : null;
  const itemDefinition = definition.schema.items;

  if (items === null) {
    return (
      <div class="flex flex-col gap-vsp-3xs">
        {label && <span class={FIELD_LABEL_CLASS}>{label}</span>}
        <p class="text-caption text-danger" role="alert">{label ?? "Value"} must be an ordered list.</p>
      </div>
    );
  }

  const move = (from: number, to: number): void => {
    if (to < 0 || to >= items.length || from === to) return;
    const next = [...items];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    onStructuralCommit(next);
    setExpanded((current) => {
      const result = new Set<number>();
      for (const index of current) {
        if (index === from) result.add(to);
        else if (from < to && index > from && index <= to) result.add(index - 1);
        else if (from > to && index >= to && index < from) result.add(index + 1);
        else result.add(index);
      }
      return result;
    });
  };

  const addSeed = seedValue(itemDefinition);
  return (
    <div class="flex flex-col gap-vsp-3xs" data-sg-inspector-list={path.join(".")}>
      {label && <span class={FIELD_LABEL_CLASS}>{label}</span>}
      {items.map((item, index) => {
        const collapsible = itemDefinition.editor.kind === "group";
        const isExpanded = !collapsible || expanded.has(index);
        const summary = itemSummary(itemDefinition, item, index);
        return (
          <div
            key={`${path.join(".")}-${index}`}
            data-sg-inspector-list-item={index}
            class="flex flex-col gap-vsp-3xs rounded-md border border-border p-hsp-sm"
            draggable={!disabled}
            onDragStart={() => setDraggedIndex(index)}
            onDragEnd={() => setDraggedIndex(null)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (draggedIndex !== null) move(draggedIndex, index);
              setDraggedIndex(null);
            }}
          >
            <div class="flex flex-wrap items-center gap-hsp-2xs">
              {collapsible && (
                <button
                  type="button"
                  class={STRUCTURE_BUTTON_CLASS}
                  aria-expanded={isExpanded}
                  disabled={disabled}
                  onClick={() => setExpanded((current) => {
                    const next = new Set(current);
                    if (next.has(index)) next.delete(index); else next.add(index);
                    return next;
                  })}
                >
                  {summary}
                </button>
              )}
              <button type="button" class={STRUCTURE_BUTTON_CLASS} disabled={disabled || index === 0} onClick={() => move(index, index - 1)}>
                Move up
              </button>
              <button type="button" class={STRUCTURE_BUTTON_CLASS} disabled={disabled || index === items.length - 1} onClick={() => move(index, index + 1)}>
                Move down
              </button>
              <button
                type="button"
                class={`${STRUCTURE_BUTTON_CLASS} sg-composer-inspector-remove`}
                disabled={disabled}
                onClick={() => {
                  const next = items.filter((_, itemIndex) => itemIndex !== index);
                  onStructuralCommit(next);
                  setExpanded((current) => new Set([...current].filter((itemIndex) => itemIndex !== index).map((itemIndex) => itemIndex > index ? itemIndex - 1 : itemIndex)));
                }}
              >
                Remove
              </button>
            </div>
            {isExpanded && (
              <ValueEditor
                definition={itemDefinition}
                value={item}
                path={[...path, index]}
                labelOverride={collapsible ? undefined : `Item ${index + 1}`}
                disabled={disabled}
                onLeafCommit={onLeafCommit}
                onStructuralCommit={(next) => {
                  const nextItems = [...items];
                  nextItems[index] = next;
                  onStructuralCommit(nextItems);
                }}
                onFlushPending={onFlushPending}
                onEditingChange={onEditingChange}
              />
            )}
          </div>
        );
      })}
      <button
        type="button"
        class={STRUCTURE_BUTTON_CLASS}
        disabled={disabled || addSeed === undefined}
        onClick={() => {
          if (addSeed === undefined) return;
          onStructuralCommit([...items, addSeed]);
          setExpanded((current) => new Set(current).add(items.length));
        }}
      >
        Add item
      </button>
      {addSeed === undefined && <p class="text-caption text-danger" role="alert">Cannot add item: required fields have no deterministic seed.</p>}
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
}: CompositeEditorProps & { definition: TupleDefinition }): JSX.Element {
  if (!Array.isArray(value) || value.length !== definition.schema.items.length) {
    return (
      <div class="flex flex-col gap-vsp-3xs">
        {label && <span class={FIELD_LABEL_CLASS}>{label}</span>}
        <p class="text-caption text-danger" role="alert">{label ?? "Value"} must contain exactly {definition.schema.items.length} items.</p>
      </div>
    );
  }
  return (
    <div class="flex flex-col gap-vsp-xs" data-sg-inspector-tuple={path.join(".")}>
      {label && <span class={FIELD_LABEL_CLASS}>{label}</span>}
      {definition.schema.items.map((item, index) => (
        <ValueEditor
          key={`${path.join(".")}-${index}`}
          definition={item}
          value={value[index]}
          path={[...path, index]}
          disabled={disabled}
          onLeafCommit={onLeafCommit}
          onStructuralCommit={(next) => {
            const tuple = [...value];
            tuple[index] = next;
            onStructuralCommit(tuple);
          }}
          onFlushPending={onFlushPending}
          onEditingChange={onEditingChange}
        />
      ))}
    </div>
  );
}

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
}: CompositeEditorProps & { definition: GroupDefinition }): JSX.Element {
  if (!isObjectValue(value)) {
    return (
      <div class="flex flex-col gap-vsp-3xs">
        {label && <span class={FIELD_LABEL_CLASS}>{label}</span>}
        <p class="text-caption text-danger" role="alert">{label ?? "Value"} must be an object.</p>
      </div>
    );
  }
  return (
    <div class="flex flex-col gap-vsp-xs" data-sg-inspector-group={path.join(".")}>
      {label && <span class={FIELD_LABEL_CLASS}>{label}</span>}
      {definition.schema.fields.map((field) => {
        const present = Object.hasOwn(value, field.key);
        if (!present && field.required === true) {
          return (
            <div key={field.key} class="flex flex-col gap-vsp-3xs">
              <span class={FIELD_LABEL_CLASS}>{field.label}</span>
              <p class="text-caption text-danger" role="alert">Required field is missing.</p>
            </div>
          );
        }
        if (!present) {
          const addSeed = seedValue(field);
          return (
            <div key={field.key} class="flex flex-col gap-vsp-3xs">
              <span class={FIELD_LABEL_CLASS}>{field.label}</span>
              <button
                type="button"
                class={STRUCTURE_BUTTON_CLASS}
                disabled={disabled || addSeed === undefined}
                onClick={() => {
                  if (addSeed === undefined) return;
                  onStructuralCommit({ ...value, [field.key]: addSeed });
                }}
              >
                Add {field.label}
              </button>
              {addSeed === undefined && <p class="text-caption text-danger" role="alert">Cannot add {field.label}: no deterministic seed is available.</p>}
            </div>
          );
        }
        return (
          <div key={field.key} class="flex flex-col gap-vsp-3xs" data-sg-inspector-object-field={field.key}>
            <ValueEditor
              definition={field}
              value={value[field.key]}
              path={[...path, field.key]}
              disabled={disabled}
              onLeafCommit={onLeafCommit}
              onStructuralCommit={(next) => onStructuralCommit({ ...value, [field.key]: next })}
              onFlushPending={onFlushPending}
              onEditingChange={onEditingChange}
            />
            {field.required !== true && (
              <button
                type="button"
                class={`${STRUCTURE_BUTTON_CLASS} sg-composer-inspector-remove`}
                disabled={disabled}
                onClick={() => {
                  const next: Record<string, JsonValue> = { ...value };
                  delete next[field.key];
                  onStructuralCommit(next);
                }}
              >
                Remove {field.label}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * A structured top-level field owns a local raw-JSON draft. This prevents a
 * debounced edit in one nested leaf from being overwritten by a sibling leaf
 * edit before the controller's document catches up.
 */
export function StructuredFieldDraft({
  field,
  value,
  disabled,
  onCommit,
  onCommitDebounced,
  onFlushPending,
}: InspectorFieldProps): JSX.Element {
  const [draft, setDraft] = useState<InspectorValue>(() => value);
  const draftRef = useRef<InspectorValue>(value);
  const sourceFingerprintRef = useRef(fingerprint(value));
  const focusedRef = useRef(false);
  const incomingFingerprint = fingerprint(value);

  useEffect(() => {
    if (incomingFingerprint === sourceFingerprintRef.current) return;
    sourceFingerprintRef.current = incomingFingerprint;
    if (!focusedRef.current) {
      draftRef.current = value;
      setDraft(value);
    }
  }, [incomingFingerprint, value]);

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
    const current = draftRef.current;
    if (current === undefined) return;
    const nextDraft = setAtPath(current, relativePath.slice(1), next);
    draftRef.current = nextDraft;
    setDraft(nextDraft);
    emit(nextDraft, relativePath.length === 0 ? undefined : relativePath as PropPath, channel);
  };
  const structuralCommit = (next: JsonValue): void => {
    draftRef.current = next;
    setDraft(next);
    emit(next, undefined, "structural");
  };
  const editingChange = (focused: boolean): void => {
    focusedRef.current = focused;
  };

  const validationError = validationMessage(field, draft);

  return (
    <div class="flex flex-col gap-vsp-3xs">
      {validationError && <p class="text-caption text-danger" role="alert" data-sg-inspector-validation>{validationError}</p>}
      <ValueEditor
        definition={field}
        value={draft}
        path={[field.prop]}
        disabled={disabled}
        onLeafCommit={leafCommit}
        onStructuralCommit={structuralCommit}
        onFlushPending={onFlushPending}
        onEditingChange={editingChange}
      />
    </div>
  );
}
