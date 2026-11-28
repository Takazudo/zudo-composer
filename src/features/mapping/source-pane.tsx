import { computed, Show, type Child, type ReadonlySignal } from "@takazudo/zfb/zudo-react";
import { createEditorRails, RailCollapseButton, type EditorRailsController } from "../../components/editor-chrome";
import { Rebuild } from "../../components/rebuild";
import { Keyed } from "../../runtime";
import { ContentIcon } from "../../components/icons";
import { Banner, Chip, EmptyState, Field, Pane, PaneBody, PaneHeader, PaneSection, Select } from "../../components/ui";
import type { ContentFieldDefinition } from "../../content";
import type { MappingTarget, MappingTargetDescriptor } from "../../mapping";
import type { MappingEditorState } from "./controller";
import { BindMenu } from "./bind-menu";
import { CollectionQueryPane, type CollectionQueryPaneProps } from "./query-pane";
import {
  compatibleTargetGroups,
  entryLabel,
  fieldIcon,
  fieldKindLabel,
  parseTargetKey,
  targetKey,
  targetKindIcon,
  targetLabel,
  type MappingBindingRow,
} from "./presentation";
import { followModel, memo } from "../../components/reactive";

// The navigator: every field the chosen Content model offers, whether it is
// bound, and the sample Entry the preview is evaluated against. A field with
// no binding carries the `+` that opens the bind menu, so binding can start
// from the source side as well as from an unbound target.

export interface SourcePaneProps {
  state: ReadonlySignal<MappingEditorState>;
  rows: ReadonlySignal<readonly MappingBindingRow[]>;
  /** The editor body's rails controller, for the collapse control. */
  rails?: EditorRailsController;
  onBind: (sourceFieldId: string, target: MappingTarget) => void;
  onSelectEntry: (entryId: string) => void;
  onModeChange: (kind: "single" | "collection") => void;
  onQueryChange: CollectionQueryPaneProps["onQueryChange"];
  referenceEntries?: CollectionQueryPaneProps["referenceEntries"];
  onOpenPins: () => void;
}

/** The chip beside a field: bound and working, bound and broken, or unbound. */
function boundChip(rows: readonly MappingBindingRow[], field: ContentFieldDefinition): Child {
  const bindings = rows.filter((row) => row.binding.sourceFieldId === field.id);
  if (bindings.length === 0) return null;
  const broken = bindings.some((row) => row.status !== "ready");
  return <Chip tone={broken ? "err" : "ok"} class="cms-mapping-field__chip">Bound</Chip>;
}

/** The targets this field can drive, as bind-menu rows grouped by node. */
function targetMenuGroups(field: ContentFieldDefinition, targets: readonly MappingTargetDescriptor[]) {
  return compatibleTargetGroups(field, targets).map((group) => ({
    id: group.id,
    label: group.label,
    items: group.items.map((target) => ({
      id: targetKey(target.target),
      label: targetLabel(target),
      detail: target.kind,
      icon: targetKindIcon(target.kind),
    })),
  }));
}

export function SourcePane({ state, rows, rails = createEditorRails(), onBind, onSelectEntry, onModeChange, onQueryChange, onOpenPins, referenceEntries }: SourcePaneProps): Child {
  const model = computed(() => state.value.definition?.contentModel ?? null);
  const fields = computed(() => model.value?.document.fields ?? []);
  const targets = computed(() => state.value.definition?.targets ?? []);
  const entries = computed(() => state.value.entries);
  const entryFailure = computed(() => state.value.entryFailure);
  // The sample Entry select is rebuilt when its options change; the model follows the selection.
  const entryOptions = computed(() => [model.value?.id ?? "", ...entries.value.map((entry) => `${entry.id}\u0000${entryLabel(entry, model.value)}`)].join("\u0001"));

  return (
    <Pane label="Source fields" class="cms-mapping-nav">
      <PaneHeader title="Source fields" count={computed(() => fields.value.length)} actions={<RailCollapseButton rail="nav" rails={rails} />} />
      <PaneBody>
        <Rebuild value={memo(() => [model.value, targets.value] as const)}>{([currentModel, currentTargets]) => currentModel ? <PaneSection title="Read-only metadata">
          <strong>Entry identity</strong>
          <p>The selected Content record ID; independent of order and field values. Supports scalar text targets only.</p>
          <BindMenu menuLabel="Bind Entry identity to…" triggerLabel="Bind Entry identity" emptyLabel="No scalar text target is available" groups={[{ id: "text-targets", label: "Text targets", items: currentTargets.filter((target) => target.kind === "text").map((target) => ({ id: targetKey(target.target), label: targetLabel(target), detail: target.kind })) }]} onSelect={(key) => onBind("entry:identity", parseTargetKey(key))} />
        </PaneSection> : null}</Rebuild>
        <PaneSection title="Fields">
          <Show when={computed(() => Boolean(entryFailure.value))}>{() => (
            <Banner tone="err" title="Entry provider unavailable.">{computed(() => entryFailure.value ?? "")}</Banner>
          )}</Show>
          <Show when={computed(() => model.value === null)}>{() => (
            <EmptyState
              inline
              icon={ContentIcon}
              title="No Content model resolved"
              description="Choose a Content model in the toolbar to list its fields."
            />
          )}</Show>
          <Show when={computed(() => model.value !== null && fields.value.length === 0)}>{() => (
            <EmptyState inline icon={ContentIcon} title="This Content model has no fields." />
          )}</Show>
          <Rebuild value={memo(() => [fields.value, rows.value, targets.value] as const)}>{([currentFields, currentRows, currentTargets]) => currentFields.length > 0 ? (
            <ul class="cms-mapping-fields">
              {currentFields.map((field) => {
                const Icon = fieldIcon(field.kind);
                const chip = boundChip(currentRows, field);
                return (
                  <li key={field.id} class="cms-mapping-field">
                    <Icon size="sm" class="cms-mapping-field__glyph" />
                    <span class="cms-mapping-field__text">
                      <strong>{field.label}</strong>
                      <span class="cms-mapping-field__meta">
                        {field.key} · {field.kind}
                        {field.required ? " · required" : ""}
                      </span>
                    </span>
                    {chip ?? (
                      <BindMenu
                        triggerClass="cms-mapping-field__chip"
                        menuLabel={`Bind ${field.label} to…`}
                        triggerLabel={`Bind ${field.label}`}
                        emptyLabel={`No ${fieldKindLabel(field.kind).toLowerCase()} target is compatible`}
                        groups={targetMenuGroups(field, currentTargets)}
                        onSelect={(key) => onBind(field.id, parseTargetKey(key))}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}</Rebuild>
        </PaneSection>
        <CollectionQueryPane referenceEntries={referenceEntries} state={state} onModeChange={onModeChange} onQueryChange={onQueryChange} onOpenPins={onOpenPins} />
        <PaneSection title="Sample entry">
          <Field label="Sample Entry" help="Used only to evaluate the preview.">
            {(control) => (
              <Keyed value={entryOptions} by={(key) => key}>{() => {
                const selected = followModel(() => state.value.entry?.id ?? "");
                const current = entries.value;
                const currentModel = model.value;
                return (
                  <Select
                    size="sm"
                    field={control}
                    modelValue={selected}
                    disabled={current.length === 0}
                    on:change={(event) => onSelectEntry(event.currentTarget.value)}
                  >
                    <option value="">{current.length ? "Choose an Entry" : "No Entries available"}</option>
                    {current.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {`${entryLabel(entry, currentModel)} · ${entry.id}`}
                      </option>
                    ))}
                  </Select>
                );
              }}</Keyed>
            )}
          </Field>
        </PaneSection>
      </PaneBody>
    </Pane>
  );
}
