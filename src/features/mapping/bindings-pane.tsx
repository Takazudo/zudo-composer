/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import type { JSX } from "preact";
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
import type { MappingTarget, MappingTransform } from "../../mapping";
import { BindMenu } from "./bind-menu";
import {
  compatibleSourceGroups,
  fieldIcon,
  targetKey,
  targetKindIcon,
  targetLabel,
  transformLabel,
  transformValue,
  unboundTargets,
  type MappingBindingRow,
} from "./presentation";
import type { MappingEditorState } from "./controller";

// The binding board: ONE ROW PER BINDING. Source, transform and target used to
// be three stacked card regions per binding, which put a three-binding Mapping
// past a screenful; here they are three cells of one row, and a broken row
// explains itself in a full-width row underneath rather than in a card of its
// own.

export interface BindingsPaneProps {
  state: MappingEditorState;
  rows: readonly MappingBindingRow[];
  notice?: JSX.Element | null;
  onBind: (sourceFieldId: string, target: MappingTarget) => void;
  onRebind: (bindingId: string, sourceFieldId: string) => void;
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
  const source = row.source?.label ?? row.binding.sourceFieldId;
  const target = row.target ? targetLabel(row.target) : `${row.binding.target.nodeId}.${row.binding.target.prop}`;
  return `${source} → ${target}`;
}

function SourceCell({ row }: { row: MappingBindingRow }): JSX.Element {
  const Icon = row.source ? fieldIcon(row.source.kind) : ErrorIcon;
  return (
    <span class="cms-mapping-cell">
      <Icon size="sm" class="cms-mapping-cell__glyph" />
      <span class="cms-mapping-cell__text">
        <strong>{row.source?.label ?? "Missing field"}</strong>
        <span class="cms-mapping-cell__meta">{row.source?.key ?? row.binding.sourceFieldId}</span>
      </span>
    </span>
  );
}

function TargetCell({ row }: { row: MappingBindingRow }): JSX.Element {
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

export function BindingsPane({
  state,
  rows,
  notice,
  onBind,
  onRebind,
  onTransform,
  onMove,
  onRemove,
}: BindingsPaneProps): JSX.Element {
  const mapping = state.mapping!;
  const fields = state.definition?.contentModel?.document.fields ?? [];
  const unbound = unboundTargets(mapping, state.definition);

  /** The bind menu for one target, shared by an unbound chip and a Fix action. */
  const sourceGroups = (target: NonNullable<MappingBindingRow["target"]>) =>
    compatibleSourceGroups(target, fields).map((group) => ({
      id: group.id,
      label: group.label,
      items: group.items.map((field) => ({
        id: field.id,
        label: field.label,
        detail: `${field.key} · ${field.kind}`,
        icon: fieldIcon(field.kind),
      })),
    }));

  const columns: readonly DataTableColumn<MappingBindingRow>[] = [
    { key: "source", header: "Source", variant: "name", cell: (row) => <SourceCell row={row} /> },
    {
      key: "arrow",
      header: "",
      width: "1.5rem",
      cell: () => <ArrowRightIcon size="sm" class="cms-mapping-arrow" aria-hidden="true" />,
    },
    {
      key: "transform",
      header: "Transform",
      cell: (row) => (
        <span class="cms-mapping-transform">
          <Select
            size="sm"
            value={row.binding.transform.kind}
            aria-label={`Transform for ${rowName(row)}`}
            onChange={(event) =>
              onTransform(row.binding.id, transformValue(event.currentTarget.value as MappingTransform["kind"], row.binding.transform))
            }
          >
            {row.transforms.map((kind) => (
              <option key={kind} value={kind}>
                {transformLabel(kind)}
              </option>
            ))}
          </Select>
          {row.binding.transform.kind === "prefix" ? (
            <Input
              size="sm"
              value={row.binding.transform.prefix}
              maxLength={80}
              aria-label={`Prefix for ${rowName(row)}`}
              onInput={(event) => onTransform(row.binding.id, { kind: "prefix", prefix: event.currentTarget.value })}
            />
          ) : null}
        </span>
      ),
    },
    { key: "target", header: "Target", variant: "name", cell: (row) => <TargetCell row={row} /> },
    {
      key: "status",
      header: "Status",
      width: "7rem",
      // The wrapper carries the state as data, so a browser spec can count
      // broken rows without reading a chip's wording.
      cell: (row) => (
        <span class="cms-mapping-status" data-status={row.status}>
          <Chip tone={STATUS[row.status].tone} dot={row.status === "ready"}>
            {STATUS[row.status].label}
          </Chip>
        </span>
      ),
    },
  ];

  return (
    <Pane variant="main" label="Bindings" class="cms-mapping-main">
      <PaneHeader title="Bindings" count={rows.length} />
      <PaneBody padded class="cms-mapping-main__body">
        {notice}
        {rows.length === 0 ? (
          <EmptyState
            icon={MappingIcon}
            title="No bindings yet"
            description="Bind a Composition prop to a Content field with the + chips below. Unbound props keep the value the Composition was authored with."
          />
        ) : (
          <DataTable
            class="cms-mapping-table"
            caption="Bindings"
            density="compact"
            columns={columns}
            rows={rows}
            rowKey={(row) => row.binding.id}
            rowActions={(row) => (
              <RowMenu
                label={rowName(row)}
                triggerLabel={`Binding actions for ${rowName(row)}`}
                actions={[
                  { id: "up", label: "Move up", icon: ArrowUpIcon, disabled: row.index === 0, onSelect: () => onMove(row.binding.id, -1) },
                  { id: "down", label: "Move down", icon: ArrowDownIcon, disabled: row.index === rows.length - 1, onSelect: () => onMove(row.binding.id, 1) },
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
                        groups={sourceGroups(row.target)}
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
        )}
        <PaneSection title="Unbound targets" class="cms-mapping-unbound">
          {unbound.length === 0 ? (
            <p class="cms-mapping-unbound__empty">
              {/* Nothing left to bind and nothing bindable at all look the same
               * from the list alone, and they need opposite answers. */}
              {(state.definition?.targets.length ?? 0) > 0
                ? "Every bindable prop of this Composition has a binding."
                : "This Composition offers no bindable props. Check the Diagnostics tab."}
            </p>
          ) : (
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
                    groups={sourceGroups(target)}
                    onSelect={(fieldId) => onBind(fieldId, target.target)}
                  >
                    {targetLabel(target)}
                  </BindMenu>
                ))}
              </div>
              <p class="cms-mapping-unbound__help">Choose a prop to bind it to a compatible source field.</p>
            </>
          )}
        </PaneSection>
      </PaneBody>
    </Pane>
  );
}
