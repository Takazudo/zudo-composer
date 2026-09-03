// What the Mapping editor puts on screen, derived from the resolved definition.
//
// Everything here is pure so the row model, the unbound-target list and the
// bind menu's compatibility filtering are verifiable without rendering: the
// binding board is a dense table, and "which rows are broken and why" is the
// part that must not drift.

import {
  BooleanIcon,
  ColorIcon,
  ComposerIcon,
  DateIcon,
  LongTextIcon,
  MarkdownIcon,
  NumberIcon,
  SlugIcon,
  TextIcon,
  UrlIcon,
  type IconComponent,
} from "../../components/icons";
import type { ContentEntryRecord, ContentFieldDefinition, ContentFieldKind, ContentModelRecord } from "../../content";
import type {
  MappingBinding,
  MappingDefinitionDiagnostic,
  MappingDefinitionResolution,
  MappingRecord,
  MappingTarget,
  MappingTargetDescriptor,
  MappingTransform,
} from "../../mapping";
import { contentEntryLabel } from "../content/presentation";
import { compatibleTransforms } from "./controller";

export interface MappingCatalogRef {
  readonly providerId: string;
  readonly recordId: string;
}

/**
 * Select values carry the provider-qualified record, never a list position: a
 * catalog that reorders or reloads between opening a picker and submitting it
 * would otherwise silently choose a different record. Record ids cannot
 * contain "/" (`RECORD_ID_PATTERN`), so the first one splits the pair.
 */
export function refKey(ref: MappingCatalogRef): string {
  return `${ref.providerId}/${ref.recordId}`;
}

export function parseRefKey(key: string): MappingCatalogRef {
  const at = key.indexOf("/");
  return at < 0 ? { providerId: key, recordId: "" } : { providerId: key.slice(0, at), recordId: key.slice(at + 1) };
}

/**
 * Stable key for a `{nodeId, prop}` pair — the identity of a bindable target,
 * and the value a bind menu hands back. A component prop is a JS identifier
 * and so cannot contain "/", which is what makes the LAST one the split point
 * whatever the node id turns out to hold.
 */
export function targetKey(target: MappingTarget): string {
  return `${target.nodeId}/${target.prop}`;
}

export function parseTargetKey(value: string): MappingTarget {
  const at = value.lastIndexOf("/");
  return at < 0 ? { nodeId: value, prop: "" } : { nodeId: value.slice(0, at), prop: value.slice(at + 1) };
}

/**
 * Row status. `incompatible` is the one an author can fix in place by
 * rebinding or changing the transform; `blocked` is a missing source, target
 * or component, which is repaired by re-picking the model or the composition.
 */
export type MappingBindingStatus = "ready" | "incompatible" | "blocked";

export interface MappingBindingRow {
  readonly binding: MappingBinding;
  readonly index: number;
  /** Null once the Content model no longer carries the bound field. */
  readonly source: ContentFieldDefinition | null;
  /** Null once the Composition no longer carries the bound prop. */
  readonly target: MappingTargetDescriptor | null;
  /** Compatible transforms, always including the one currently stored. */
  readonly transforms: readonly MappingTransform["kind"][];
  readonly diagnostics: readonly MappingDefinitionDiagnostic[];
  readonly status: MappingBindingStatus;
}

const INCOMPATIBLE_CODES = new Set<MappingDefinitionDiagnostic["code"]>([
  "incompatible-binding",
  "invalid-transform-config",
]);

function statusOf(row: Pick<MappingBindingRow, "source" | "target" | "diagnostics">): MappingBindingStatus {
  if (row.diagnostics.length === 0) return row.source && row.target ? "ready" : "blocked";
  return row.diagnostics.every((diagnostic) => INCOMPATIBLE_CODES.has(diagnostic.code)) ? "incompatible" : "blocked";
}

/** One row per binding, in authored order. */
export function buildBindingRows(
  mapping: MappingRecord,
  definition: MappingDefinitionResolution | null,
): readonly MappingBindingRow[] {
  const fields = definition?.contentModel?.document.fields ?? [];
  const targets = definition?.targets ?? [];
  const diagnostics = definition?.diagnostics ?? [];

  return mapping.document.bindings.map((binding, index) => {
    const source = fields.find((field) => field.id === binding.sourceFieldId) ?? null;
    const target = targets.find((item) => targetKey(item.target) === targetKey(binding.target)) ?? null;
    // The stored transform is always offered, even when nothing about the pair
    // is compatible: a select that cannot show its own value reads as empty.
    const compatible = source && target ? compatibleTransforms(source.kind, target) : [];
    const transforms = compatible.includes(binding.transform.kind) ? compatible : [...compatible, binding.transform.kind];
    const rowDiagnostics = diagnostics.filter((diagnostic) => diagnostic.bindingId === binding.id);
    return { binding, index, source, target, transforms, diagnostics: rowDiagnostics, status: statusOf({ source, target, diagnostics: rowDiagnostics }) };
  });
}

/** Bindable props with no binding yet — the `+` chips under the table. */
export function unboundTargets(
  mapping: MappingRecord,
  definition: MappingDefinitionResolution | null,
): readonly MappingTargetDescriptor[] {
  const bound = new Set(mapping.document.bindings.map((binding) => targetKey(binding.target)));
  return (definition?.targets ?? []).filter((target) => !bound.has(targetKey(target.target)));
}

export interface MappingMenuGroup<Item> {
  readonly id: string;
  readonly label: string;
  readonly items: readonly Item[];
}

function groupBy<Item>(items: readonly Item[], key: (item: Item) => { id: string; label: string }): readonly MappingMenuGroup<Item>[] {
  const groups: MappingMenuGroup<Item>[] = [];
  const byId = new Map<string, Item[]>();
  for (const item of items) {
    const { id, label } = key(item);
    let bucket = byId.get(id);
    if (!bucket) {
      bucket = [];
      byId.set(id, bucket);
      groups.push({ id, label, items: bucket });
    }
    bucket.push(item);
  }
  return groups;
}

/** Sources that can drive this target under at least one transform, grouped by field kind. */
export function compatibleSourceGroups(
  target: MappingTargetDescriptor,
  fields: readonly ContentFieldDefinition[],
): readonly MappingMenuGroup<ContentFieldDefinition>[] {
  const compatible = fields.filter((field) => compatibleTransforms(field.kind, target).length > 0);
  return groupBy(compatible, (field) => ({ id: field.kind, label: fieldKindLabel(field.kind) }));
}

/** Targets this source can drive, grouped by the composition node that owns them. */
export function compatibleTargetGroups(
  source: ContentFieldDefinition,
  targets: readonly MappingTargetDescriptor[],
): readonly MappingMenuGroup<MappingTargetDescriptor>[] {
  const compatible = targets.filter((target) => compatibleTransforms(source.kind, target).length > 0);
  return groupBy(compatible, (target) => ({ id: target.target.nodeId, label: target.nodeLabel }));
}

/** The first transform that makes this pair work, or null when none does. */
export function firstCompatibleTransform(
  sourceKind: ContentFieldKind,
  target: MappingTargetDescriptor,
): MappingTransform | null {
  const kind = compatibleTransforms(sourceKind, target)[0];
  return kind === undefined ? null : transformValue(kind, { kind: "identity" });
}

export function transformValue(kind: MappingTransform["kind"], previous: MappingTransform): MappingTransform {
  return kind === "prefix" ? { kind, prefix: previous.kind === "prefix" ? previous.prefix : "" } : { kind };
}

export function transformLabel(kind: MappingTransform["kind"]): string {
  switch (kind) {
    case "identity": return "Pass through";
    case "date-medium": return "Format date";
    case "truncate-160": return "Truncate to 160";
    case "prefix": return "Add prefix";
  }
}

/** `SectionHeading.heading` — how a target reads on a chip and in a menu. */
export function targetLabel(target: MappingTargetDescriptor): string {
  return `${target.componentLabel}.${target.target.prop}`;
}

export function fieldKindLabel(kind: ContentFieldKind): string {
  switch (kind) {
    case "long-text": return "Long text";
    default: return kind.charAt(0).toUpperCase() + kind.slice(1);
  }
}

export function fieldIcon(kind: ContentFieldKind): IconComponent {
  switch (kind) {
    case "text": return TextIcon;
    case "long-text": return LongTextIcon;
    case "markdown": return MarkdownIcon;
    case "number": return NumberIcon;
    case "boolean": return BooleanIcon;
    case "date": return DateIcon;
    case "slug": return SlugIcon;
    case "color": return ColorIcon;
    case "url": return UrlIcon;
  }
}

export function targetKindIcon(kind: MappingTargetDescriptor["kind"]): IconComponent {
  switch (kind) {
    case "text": return TextIcon;
    case "boolean": return BooleanIcon;
    case "number": return NumberIcon;
    case "color": return ColorIcon;
    default: return ComposerIcon;
  }
}

/** The sample Entry's display name, from the same rule the Content route uses. */
export function entryLabel(entry: ContentEntryRecord, model: ContentModelRecord | null): string {
  return contentEntryLabel(entry, model?.document.fields ?? []);
}
