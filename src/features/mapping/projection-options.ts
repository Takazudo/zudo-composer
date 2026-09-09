import type { ContentFieldDefinition, ContentFieldKind } from "../../content";
import { isMappingCompatible, type MappingSourceProjection, type MappingTargetDescriptor, type MappingTransform } from "../../mapping";

export interface MappingProjectionOption {
  readonly projection: MappingSourceProjection;
  readonly label: string;
  readonly kind: ContentFieldKind;
}

/** All stable projections the current source field can provide. */
export function sourceProjectionOptions(field: ContentFieldDefinition): readonly MappingProjectionOption[] {
  const options: MappingProjectionOption[] = [{ projection: { kind: "value" }, label: "Whole value", kind: field.kind }];
  if (field.kind === "object") collectObjectProjections(field, [], options, field);
  if (field.kind === "asset-use") {
    options.push({ projection: { kind: "asset-ref" }, label: "Asset reference", kind: "object" });
    const fields = field.use === "image" ? ["alt", "caption"] : field.use === "link" ? ["label"] : ["title", "description"];
    for (const candidate of fields) options.push({ projection: { kind: "asset-text", field: candidate as "alt" | "caption" | "label" | "title" | "description" }, label: `Asset ${candidate}`, kind: "text" });
  }
  if (field.kind === "reference") {
    options.push({ projection: { kind: "reference-id" }, label: "Referenced record ID", kind: "text" });
    options.push({ projection: { kind: "route-link" }, label: "Resolved route link", kind: "text" });
  }
  if (field.kind === "reference-list") options.push({ projection: { kind: "reference-list-ids" }, label: "Referenced record IDs", kind: "list" });
  return options;
}

function collectObjectProjections(field: Extract<ContentFieldDefinition, { kind: "object" }>, parent: readonly string[], output: MappingProjectionOption[], root: Extract<ContentFieldDefinition, { kind: "object" }>): void {
  for (const child of field.fields) {
    const path = [...parent, child.id];
    const projection: MappingSourceProjection = { kind: "object-field", fieldIds: path };
    output.push({ projection, label: objectPathLabels(root, path).join(" › "), kind: child.kind });
    if (child.kind === "object") collectObjectProjections(child, path, output, root);
  }
}

function objectPathLabels(root: ContentFieldDefinition, path: readonly string[]): string[] {
  let current: ContentFieldDefinition | undefined = root;
  const labels: string[] = [];
  for (const fieldId of path) {
    current = current?.kind === "object" ? current.fields.find((field) => field.id === fieldId) : undefined;
    labels.push(current?.label ?? fieldId);
  }
  return labels;
}

export function projectionKey(projection: MappingSourceProjection): string {
  return projection.kind === "object-field" ? `${projection.kind}:${projection.fieldIds.join(",")}` : projection.kind === "asset-text" ? `${projection.kind}:${projection.field}` : projection.kind;
}

export function parseProjectionKey(value: string, options: readonly MappingProjectionOption[]): MappingSourceProjection {
  return options.find((option) => projectionKey(option.projection) === value)?.projection ?? { kind: "value" };
}

export function projectionLabel(projection: MappingSourceProjection, source?: ContentFieldDefinition | null): string {
  if (projection.kind === "value") return "Whole value";
  if (projection.kind === "object-field") {
    let current: ContentFieldDefinition | undefined = source ?? undefined;
    const labels: string[] = [];
    for (const fieldId of projection.fieldIds) {
      current = current?.kind === "object" ? current.fields.find((field) => field.id === fieldId) : undefined;
      labels.push(current?.label ?? fieldId);
    }
    return labels.join(" › ");
  }
  if (projection.kind === "asset-ref") return "Asset reference";
  if (projection.kind === "asset-text") return `Asset ${projection.field}`;
  if (projection.kind === "reference-id") return "Referenced record ID";
  if (projection.kind === "reference-list-ids") return "Referenced record IDs";
  return "Resolved route link";
}

export function firstCompatibleProjection(field: ContentFieldDefinition, target: MappingTargetDescriptor): MappingProjectionOption | null {
  return sourceProjectionOptions(field).find((projection) => compatibleTransformsForProjection(projection, target).length > 0) ?? null;
}

export function compatibleTransformsForProjection(projection: MappingProjectionOption, target: MappingTargetDescriptor): readonly MappingTransform["kind"][] {
  const candidates: readonly MappingTransform[] = [
    { kind: "identity" }, { kind: "date-medium" }, { kind: "truncate-160" }, { kind: "prefix", prefix: "" },
  ];
  return candidates.filter((transform) => isMappingCompatible(projection.kind, target.kind, transform)).map((transform) => transform.kind);
}
