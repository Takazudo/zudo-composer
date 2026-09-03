/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import type { JSX } from "preact";
import { RailCollapseButton } from "../../components/editor-chrome";
import { ContentIcon } from "../../components/icons";
import { Banner, Chip, EmptyState, Field, Pane, PaneBody, PaneHeader, PaneSection, Select } from "../../components/ui";
import type { ContentFieldDefinition } from "../../content";
import type { MappingTarget } from "../../mapping";
import type { MappingEditorState } from "./controller";
import { BindMenu } from "./bind-menu";
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

// The navigator: every field the chosen Content model offers, whether it is
// bound, and the sample Entry the preview is evaluated against. A field with
// no binding carries the `+` that opens the bind menu, so binding can start
// from the source side as well as from an unbound target.

export interface SourcePaneProps {
  state: MappingEditorState;
  rows: readonly MappingBindingRow[];
  onBind: (sourceFieldId: string, target: MappingTarget) => void;
  onSelectEntry: (entryId: string) => void;
}

/** The chip beside a field: bound and working, bound and broken, or unbound. */
function boundChip(rows: readonly MappingBindingRow[], field: ContentFieldDefinition): JSX.Element | null {
  const bindings = rows.filter((row) => row.binding.sourceFieldId === field.id);
  if (bindings.length === 0) return null;
  const broken = bindings.some((row) => row.status !== "ready");
  return <Chip tone={broken ? "err" : "ok"} class="cms-mapping-field__chip">bound</Chip>;
}

export function SourcePane({ state, rows, onBind, onSelectEntry }: SourcePaneProps): JSX.Element {
  const model = state.definition?.contentModel ?? null;
  const fields = model?.document.fields ?? [];
  const targets = state.definition?.targets ?? [];

  return (
    <Pane label="Source fields" class="cms-mapping-nav">
      <PaneHeader title="Source fields" count={fields.length} actions={<RailCollapseButton rail="nav" />} />
      <PaneBody>
        <PaneSection title="Fields">
          {state.entryFailure ? (
            <Banner tone="err" title="Entry provider unavailable.">{state.entryFailure}</Banner>
          ) : null}
          {model === null ? (
            <EmptyState
              inline
              icon={ContentIcon}
              title="No Content model resolved"
              description="Choose a Content model in the toolbar to list its fields."
            />
          ) : null}
          {model !== null && fields.length === 0 ? (
            <EmptyState inline icon={ContentIcon} title="This Content model has no fields." />
          ) : null}
          {fields.length > 0 ? (
            <ul class="cms-mapping-fields">
              {fields.map((field) => {
                const Icon = fieldIcon(field.kind);
                const chip = boundChip(rows, field);
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
                        groups={compatibleTargetGroups(field, targets).map((group) => ({
                          id: group.id,
                          label: group.label,
                          items: group.items.map((target) => ({
                            id: targetKey(target.target),
                            label: targetLabel(target),
                            detail: target.kind,
                            icon: targetKindIcon(target.kind),
                          })),
                        }))}
                        onSelect={(key) => onBind(field.id, parseTargetKey(key))}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </PaneSection>
        <PaneSection title="Sample entry">
          <Field label="Sample Entry" help="Used only to evaluate the preview.">
            <Select
              size="sm"
              value={state.entry?.id ?? ""}
              disabled={state.entries.length === 0}
              onChange={(event) => onSelectEntry(event.currentTarget.value)}
            >
              <option value="">{state.entries.length ? "Choose an Entry" : "No Entries available"}</option>
              {state.entries.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entryLabel(entry, model)} · {entry.id}
                </option>
              ))}
            </Select>
          </Field>
        </PaneSection>
      </PaneBody>
    </Pane>
  );
}
