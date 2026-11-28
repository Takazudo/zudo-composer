import { computed, Show, type Child, type ReadonlySignal } from "@takazudo/zfb/zudo-react";
import { Rebuild } from "../../components/rebuild";
import { ArrowDownIcon, ArrowRightIcon, ArrowUpIcon, ErrorIcon, MappingIcon, TrashIcon } from "../../components/icons";
import { RowMenu } from "../../components/library-page";
import {
  Banner,
  Chip,
  DataTable,
  EmptyState,
  Input,
  Pane,
  PaneBody,
  PaneHeader,
  PaneSection,
  Select,
  type ChipTone,
  type DataTableColumn,
} from "../../components/ui";
import type { ContentFieldDefinition } from "../../content";
import type { MappingBinding, MappingTarget, MappingTransform } from "../../mapping";
import { BindMenu } from "./bind-menu";
import {
  compatibleSourceGroups,
  fieldIcon,
  parseProjectionKey,
  projectionKey,
  projectionLabel,
  targetKey,
  targetKindIcon,
  targetLabel,
  transformLabel,
  transformValue,
  unboundTargets,
  type MappingBindingRow,
} from "./presentation";
import type { MappingEditorState } from "./controller";
import { followModel, keyedBy, memo } from "../../components/reactive";

// The binding board: ONE ROW PER BINDING. Source, transform and target used to
// be three stacked card regions per binding, which put a three-binding Mapping
// past a screenful; here they are three cells of one row, and a broken row
// explains itself in a full-width row underneath rather than in a card of its
// own.

export interface BindingsPaneProps {
  state: ReadonlySignal<MappingEditorState>;
  rows: ReadonlySignal<readonly MappingBindingRow[]>;
  notice?: Child;
  onBind: (sourceFieldId: string, target: MappingTarget) => void;
  onRebind: (bindingId: string, sourceFieldId: string) => void;
  onProjection: (bindingId: string, projection: NonNullable<MappingBinding["projection"]>) => void;
  onTransform: (bindingId: string, transform: MappingTransform) => void;
  onMove: (bindingId: string, direction: -1 | 1) => void;
  onRemove: (bindingId: string) => void;
}

const STATUS: Record<MappingBindingRow["status"], { label: string; tone: ChipTone }> = {
  ready: { label: "Ready", tone: "ok" },
  incompatible: { label: "Incompatible", tone: "err" },
  blocked: { label: "Blocked", tone: "warn" },
};

/** A name for the row in menus and labels, even when neither end resolves. */
function rowName(row: MappingBindingRow): string {
  const source = row.source?.label ?? (row.binding.source ? "Entry identity" : row.binding.sourceFieldId);
  const target = row.target ? targetLabel(row.target) : `${row.binding.target.nodeId}.${row.binding.target.prop}`;
  return `${source} → ${target}`;
}

function SourceCell({ row }: { row: MappingBindingRow }): Child {
  const Icon = row.source ? fieldIcon(row.source.kind) : row.binding.source ? fieldIcon("text") : ErrorIcon;
  return (
    <span class="cms-mapping-cell">
      <Icon size="sm" class="cms-mapping-cell__glyph" />
      <span class="cms-mapping-cell__text">
        <strong>{row.source?.label ?? (row.binding.source ? "Entry identity" : "Missing field")}</strong>
        <span class="cms-mapping-cell__meta">{row.source?.key ?? (row.binding.source ? "Read-only record metadata" : row.binding.sourceFieldId)}</span>
      </span>
    </span>
  );
}

function TargetCell({ row }: { row: MappingBindingRow }): Child {
  const Icon = row.target ? targetKindIcon(row.target.kind) : ErrorIcon;
  return (
    <span class="cms-mapping-cell">
      <Icon size="sm" class="cms-mapping-cell__glyph" />
      <span class="cms-mapping-cell__text">
        <strong>{row.target?.componentLabel ?? "Missing target"}</strong>
        <span class="cms-mapping-cell__meta">
          {row.target ? `.${row.target.target.prop}` : `${row.binding.target.nodeId}.${row.binding.target.prop}`}
          {row.target ? ` · ${row.target.kind}` : ""}
        </span>
      </span>
    </span>
  );
}

/**
 * What the table is built from. The projection, the transform and its prefix
 * and the status are bound live per row, so editing a binding never rebuilds
 * the table under the control the author is using.
 */
function structureKey(rows: readonly MappingBindingRow[]): string {
  return JSON.stringify(rows.map((row) => [
    row.binding.id,
    row.index,
    rows.length,
    row.binding.source ?? null,
    row.binding.sourceFieldId,
    row.binding.target,
    row.source ? [row.source.label, row.source.key, row.source.kind] : null,
    row.target ? [row.target.componentLabel, row.target.kind, row.target.target] : null,
    row.projections.map((projection) => [projectionKey(projection.projection), projection.label]),
    // The fallback option names the current projection only when there is no list.
    row.binding.source || row.projections.length > 0 ? null : projectionLabel(row.binding.projection, row.source),
    row.transforms,
    row.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.message]),
  ]));
}

function TransformCell({ row, live, onProjection, onTransform }: {
  row: MappingBindingRow;
  live: ReadonlySignal<MappingBindingRow>;
  onProjection: BindingsPaneProps["onProjection"];
  onTransform: BindingsPaneProps["onTransform"];
}): Child {
  if (row.binding.source) return <span>Entry identity · unchanged</span>;
  const authored = row.binding.projection;
  const projection = followModel(() => projectionKey(live.value.binding.projection ?? authored));
  const transformKind = followModel<string>(() => live.value.binding.transform.kind);
  const prefix = followModel(() => {
    const transform = live.value.binding.transform;
    return transform.kind === "prefix" ? transform.prefix : "";
  });
  return (
    <span class="cms-mapping-transform">
      <Select
        size="sm"
        modelValue={projection}
        aria-label={`Projection for ${rowName(row)}`}
        on:change={(event) => onProjection(row.binding.id, parseProjectionKey(event.currentTarget.value, row.projections))}
      >
        {row.projections.length === 0 ? <option value={projectionKey(row.binding.projection)}>{projectionLabel(row.binding.projection, row.source)}</option> : null}
        {row.projections.map((option) => (
          <option key={projectionKey(option.projection)} value={projectionKey(option.projection)}>
            {option.label}
          </option>
        ))}
      </Select>
      <Select
        size="sm"
        modelValue={transformKind}
        aria-label={`Transform for ${rowName(row)}`}
        on:change={(event) =>
          onTransform(row.binding.id, transformValue(event.currentTarget.value as MappingTransform["kind"], live.value.binding.transform))
        }
      >
        {row.transforms.map((kind) => (
          <option key={kind} value={kind}>
            {transformLabel(kind)}
          </option>
        ))}
      </Select>
      <Show when={computed(() => live.value.binding.transform.kind === "prefix")}>{() => (
        <Input
          size="sm"
          modelValue={prefix}
          maxlength={80}
          aria-label={`Prefix for ${rowName(row)}`}
          on:input={(event) => onTransform(row.binding.id, { kind: "prefix", prefix: event.currentTarget.value })}
        />
      )}</Show>
    </span>
  );
}

function StatusCell({ live }: { live: ReadonlySignal<MappingBindingRow> }): Child {
  // The wrapper carries the state as data, so a browser spec can count
  // broken rows without reading a chip's wording.
  return (
    <Rebuild value={computed(() => live.value.status)}>{(status) => (
      <span class="cms-mapping-status" data-status={status}>
        <Chip tone={STATUS[status].tone} dot={status === "ready"}>
          {STATUS[status].label}
        </Chip>
      </span>
    )}</Rebuild>
  );
}

export function BindingsPane({
  state,
  rows,
  notice,
  onBind,
  onRebind,
  onProjection,
  onTransform,
  onMove,
  onRemove,
}: BindingsPaneProps): Child {
  // Re-resolving the definition (after every edit) yields equal fields in a new
  // array; rebuilding the table for that would close an open row menu.
  const fields = keyedBy(() => state.value.definition?.contentModel?.document.fields ?? [], (current) => JSON.stringify(current));
  const tableRows = keyedBy(() => rows.value, structureKey);
  const liveRow = (row: MappingBindingRow) => computed(() => rows.value.find((candidate) => candidate.binding.id === row.binding.id) ?? row);

  /** The bind menu for one target, shared by an unbound chip and a Fix action. */
  const sourceGroups = (target: NonNullable<MappingBindingRow["target"]>, currentFields: readonly ContentFieldDefinition[]) =>
    [...(target.kind === "text" ? [{ id: "entry-metadata", label: "Read-only metadata", items: [{ id: "entry:identity", label: "Entry identity", detail: "Selected record ID · text" }] }] : []), ...compatibleSourceGroups(target, currentFields).map((group) => ({
      id: group.id,
      label: group.label,
      items: group.items.map((field) => ({
        id: field.id,
        label: field.label,
        detail: `${field.key} · ${field.kind}`,
        icon: fieldIcon(field.kind),
      })),
    }))];

  const columns: readonly DataTableColumn<MappingBindingRow>[] = [
    { key: "source", header: "Source", variant: "name", cell: (row) => <SourceCell row={row} /> },
    {
      key: "arrow",
      header: "",
      width: "1.5rem",
      cell: () => <ArrowRightIcon size="sm" class="cms-mapping-arrow" aria-hidden="true" />,
    },
    { key: "transform", header: "Transform", cell: (row) => <TransformCell row={row} live={liveRow(row)} onProjection={onProjection} onTransform={onTransform} /> },
    { key: "target", header: "Target", variant: "name", cell: (row) => <TargetCell row={row} /> },
    { key: "status", header: "Status", width: "7rem", cell: (row) => <StatusCell live={liveRow(row)} /> },
  ];

  return (
    <Pane variant="main" label="Bindings" class="cms-mapping-main">
      <PaneHeader title="Bindings" count={computed(() => rows.value.length)} />
      <PaneBody padded class="cms-mapping-main__body">
        {notice}
        <Show when={computed(() => rows.value.length === 0)}>{() => (
          <EmptyState
            icon={MappingIcon}
            title="No bindings yet"
            description="Bind a Composition prop to a Content field with the + chips below. Unbound props keep the value the Composition was authored with."
          />
        )}</Show>
        <Show when={computed(() => rows.value.length > 0)}>{() => (
          <Rebuild value={fields}>{(currentFields) => (
            <DataTable
              class="cms-mapping-table"
              caption="Bindings"
              density="compact"
              columns={columns}
              rows={tableRows}
              rowKey={(row) => row.binding.id}
              rowActions={(row) => (
                <RowMenu
                  label={rowName(row)}
                  triggerLabel={`Binding actions for ${rowName(row)}`}
                  actions={[
                    { id: "up", label: "Move up", icon: ArrowUpIcon, disabled: row.index === 0, onSelect: () => onMove(row.binding.id, -1) },
                    { id: "down", label: "Move down", icon: ArrowDownIcon, disabled: row.index === tableRows.value.length - 1, onSelect: () => onMove(row.binding.id, 1) },
                  ]}
                  destructive={[{ id: "remove", label: "Remove binding", icon: TrashIcon, onSelect: () => onRemove(row.binding.id) }]}
                />
              )}
              rowDetail={(row) =>
                row.diagnostics.length === 0 ? null : (
                  <Banner
                    tone="err"
                    class="cms-mapping-row-banner"
                    action={
                      row.target ? (
                        <BindMenu
                          triggerVariant="default"
                          menuLabel={`Rebind ${targetLabel(row.target)} to…`}
                          triggerLabel={`Fix ${rowName(row)}`}
                          emptyLabel="No compatible source field"
                          groups={sourceGroups(row.target, currentFields)}
                          onSelect={(fieldId) => onRebind(row.binding.id, fieldId)}
                        >
                          Fix
                        </BindMenu>
                      ) : undefined
                    }
                  >
                    {row.diagnostics.map((diagnostic) => (
                      <p key={`${diagnostic.code}:${diagnostic.message}`}>{diagnostic.message}</p>
                    ))}
                  </Banner>
                )
              }
            />
          )}</Rebuild>
        )}</Show>
        <PaneSection title="Unbound targets" class="cms-mapping-unbound">
          <Rebuild value={memo(() => [state.value.mapping, state.value.definition, fields.value] as const)}>{([mapping, definition, currentFields]) => {
            const unbound = mapping ? unboundTargets(mapping, definition) : [];
            // Nothing left to bind and nothing bindable at all look the same
            // from the list alone, and they need opposite answers.
            if (unbound.length === 0) return (
              <p class="cms-mapping-unbound__empty">
                {(definition?.targets.length ?? 0) > 0
                  ? "Every bindable prop of this Composition has a binding."
                  : "This Composition offers no bindable props. Check the Diagnostics tab."}
              </p>
            );
            return (
              <>
                <div class="cms-mapping-unbound__chips">
                  {unbound.map((target) => (
                    <BindMenu
                      key={targetKey(target.target)}
                      triggerVariant="default"
                      triggerClass="cms-mapping-unbound__chip"
                      menuLabel={`Bind ${targetLabel(target)} to…`}
                      triggerLabel={`Bind ${targetLabel(target)} on ${target.target.nodeId}`}
                      emptyLabel={`No ${target.kind} source field is compatible`}
                      groups={sourceGroups(target, currentFields)}
                      onSelect={(fieldId) => onBind(fieldId, target.target)}
                    >
                      {targetLabel(target)}
                    </BindMenu>
                  ))}
                </div>
                <p class="cms-mapping-unbound__help">Choose a prop to bind it to a compatible source field.</p>
              </>
            );
          }}</Rebuild>
        </PaneSection>
      </PaneBody>
    </Pane>
  );
}
