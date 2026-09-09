import { assetDownloadMarkdown } from "../../assets/integration/download";
import type { JsonValue } from "@zudo-composer/component-contract";
import type { ContentEntryRecord, ContentFieldDefinition, ContentFieldKind, ContentAssetUse } from "../../content/model";
import { isValueValidForField } from "../../content/model";
import type { MappingSourceProjection } from "../model";
import { validateMappingSourceProjection } from "../model";

export interface MappingRouteProjectionResolver {
  resolve(ref: { providerId: string; modelId: string; recordId: string }):
    | { status: "resolved"; href: string }
    | { status: "unavailable" }
    | { status: "ambiguous" };
}

export type MappingProjectionOutcome =
  | { status: "projected"; value: JsonValue }
  | { status: "invalid"; message: string }
  | { status: "route-context-unavailable" | "route-context-ambiguous"; message: string };

export type MappingProjectionDefinition =
  | { status: "ready"; kind: ContentFieldKind }
  | { status: "invalid"; message: string };

export function resolveMappingProjectionDefinition(field: ContentFieldDefinition, projection: MappingSourceProjection): MappingProjectionDefinition {
  if (!validateMappingSourceProjection(projection)) return { status: "invalid", message: "Source projection is malformed." };
  if (projection.kind === "value") return { status: "ready", kind: field.kind };
  if (projection.kind === "object-field") {
    let current: ContentFieldDefinition | undefined = field;
    for (const fieldId of projection.fieldIds) current = current?.kind === "object" ? current.fields.find((candidate) => candidate.id === fieldId) : undefined;
    return current ? { status: "ready", kind: current.kind } : { status: "invalid", message: `Structured source projection ${JSON.stringify(projection.fieldIds)} is stale.` };
  }
  if (projection.kind === "asset-download") return field.kind === "asset-use" && field.use === "download" ? { status: "ready", kind: "markdown" } : { status: "invalid", message: "asset-download requires a download use." };
  if (projection.kind === "asset-ref") return field.kind === "asset-use" ? { status: "ready", kind: "object" } : { status: "invalid", message: "asset-ref requires an asset-use field." };
  if (projection.kind === "asset-text") {
    const supported = field.kind === "asset-use" && ({ image: ["alt", "caption"], link: ["label"], download: ["label"], card: ["title", "description"] } as const)[field.use].includes(projection.field as never);
    return supported ? { status: "ready", kind: "text" } : { status: "invalid", message: `asset-text ${projection.field} is unavailable for this field.` };
  }
  if (projection.kind === "reference-list-ids") return field.kind === "reference-list" ? { status: "ready", kind: "list" } : { status: "invalid", message: "reference-list-ids requires a reference-list field." };
  return field.kind === "reference" ? { status: "ready", kind: "text" } : { status: "invalid", message: `${projection.kind} requires a reference field.` };
}

/** Projects typed Content values without stringifying structured data. */
export function projectContentValue(options: {
  field: ContentFieldDefinition;
  entry: ContentEntryRecord;
  projection: MappingSourceProjection;
  routeResolver?: MappingRouteProjectionResolver;
  providerId: string;
}): MappingProjectionOutcome {
  const value = options.entry.values[options.field.id];
  const projection = options.projection;
  if (!validateMappingSourceProjection(projection)) return { status: "invalid", message: "Source projection is malformed." };
  if (value === undefined) return { status: "invalid", message: `Source field "${options.field.id}" has no value.` };
  if (!isValueValidForField(options.field, value)) return { status: "invalid", message: `Source field "${options.field.id}" has an invalid value.` };
  if (projection.kind === "value") return { status: "projected", value };
  if (projection.kind === "asset-download") {
    const use = value as unknown as ContentAssetUse;
    return options.field.kind === "asset-use" && use.kind === "download" ? { status: "projected", value: assetDownloadMarkdown(use) } : { status: "invalid", message: "asset-download requires a download use." };
  }
  if (projection.kind === "object-field") {
    let current: JsonValue = value;
    let fields = options.field.kind === "object" ? options.field.fields : undefined;
    for (const fieldId of projection.fieldIds) {
      const field = fields?.find((candidate) => candidate.id === fieldId);
      if (!field || current === null || Array.isArray(current) || typeof current !== "object") return { status: "invalid", message: `Structured field projection "${fieldId}" is stale.` };
      current = (current as Record<string, JsonValue>)[field.id]!;
      fields = field.kind === "object" ? field.fields : undefined;
    }
    return current === undefined ? { status: "invalid", message: "Structured field projection has no value." } : { status: "projected", value: current };
  }
  if (projection.kind === "asset-ref" || projection.kind === "asset-text") {
    if (options.field.kind !== "asset-use" || value === null || Array.isArray(value) || typeof value !== "object") return { status: "invalid", message: "Asset projection requires an asset-use value." };
    const asset = value as unknown as ContentAssetUse;
    if (projection.kind === "asset-ref") return { status: "projected", value: asset.asset as unknown as JsonValue };
    const text = projection.field in asset ? (asset as unknown as Record<string, JsonValue>)[projection.field] : undefined;
    return typeof text === "string" ? { status: "projected", value: text } : { status: "invalid", message: `Asset ${projection.field} is unavailable for this use.` };
  }
  if (projection.kind === "reference-id" || projection.kind === "route-link") {
    if (options.field.kind !== "reference") return { status: "invalid", message: `${projection.kind} requires a reference field.` };
  } else if (options.field.kind !== "reference-list") return { status: "invalid", message: "reference-list-ids requires a reference-list field." };
  const refs = Array.isArray(value) ? value : [value];
  const parsed = refs.filter((item): item is { providerId: string; modelId: string; recordId: string } => item !== null && !Array.isArray(item) && typeof item === "object" && typeof item.providerId === "string" && typeof item.modelId === "string" && typeof item.recordId === "string");
  if (parsed.length !== refs.length) return { status: "invalid", message: "Reference projection requires provider-qualified reference values." };
  if (projection.kind === "reference-id") return parsed.length === 1 ? { status: "projected", value: parsed[0]!.recordId } : { status: "invalid", message: "reference-id requires one reference." };
  if (projection.kind === "reference-list-ids") return { status: "projected", value: parsed.map((ref) => ref.recordId) };
  if (!options.routeResolver) return { status: "route-context-unavailable", message: "Route-link projection requires a route resolver." };
  if (parsed.length !== 1) return { status: "route-context-ambiguous", message: "Route-link projection requires exactly one reference." };
  const resolved = options.routeResolver.resolve(parsed[0]!);
  return resolved.status === "resolved" ? { status: "projected", value: resolved.href } : { status: resolved.status === "ambiguous" ? "route-context-ambiguous" : "route-context-unavailable", message: `Route context is ${resolved.status}.` };
}
