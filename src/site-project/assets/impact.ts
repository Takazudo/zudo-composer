import { compareUnicodeCodePoints } from "../model/canonical";
import type { JsonValue, ValueDefinition } from "@zudo-composer/component-contract";
import type { ComponentCatalog, CompositionDocument, CompositionNode } from "../../composer/model/types";
import type { ContentValueSchema } from "../../content/model";
import type { SiteProject } from "../model";
import type { SiteCompiledRoute } from "../compiler/types";
import { validateAssetAssetRef, type AssetSnapshot, type AssetAssetRef } from "../../assets/model";
import { isImmutableAssetUrl, parseManagedAssetUrl, resolvePinnedAsset, type AssetReferenceLock } from "../../assets/references";
import { markdownAssetDestinations, rewriteMarkdownDestinations } from "./markdown";
import type { AssetImpactIndex, AssetImpactLocation } from "./types";

const URL_PROPERTIES = new Set(["src", "href", "poster", "url"]);
const managedHint = (value: string) => value.includes("/uploaded-assets/asset-") || value.includes("/uploaded-assets/sha256-");
export interface AssetImpactOptions { snapshot?: AssetSnapshot; lock?: AssetReferenceLock; providerId?: string; routes?: readonly SiteCompiledRoute[]; preservePinnedUrls?: boolean }
function collector(options: AssetImpactOptions = {}) {
  const index: AssetImpactIndex = { complete: true, references: [], advisory: [] };
  const advisory = (location: AssetImpactLocation, reason: string, value: string, unknown = false) => { index.advisory.push({ location, reason, value }); if (unknown) index.complete = false; };
  const url = (value: string, location: AssetImpactLocation): string => {
    // Preview consumers may already receive compiled exact output. Such URLs
    // are not mutable authoring references and must never resolve a latest head.
    if (options.preservePinnedUrls && isImmutableAssetUrl(value)) return value;
    const providerId = options.providerId ?? options.lock?.providerId;
    if (!providerId && managedHint(value)) { advisory(location, "Managed URL requires an available Assets provider identity.", value, true); return value; }
    const ref = providerId ? parseManagedAssetUrl(value, providerId) : undefined;
    if (ref) { index.references.push({ ref, location }); return options.lock ? resolvePinnedAsset(ref, options.lock)?.url ?? value : value; }
    if (isImmutableAssetUrl(value)) {
      const matches = options.lock?.pins.filter((pin) => pin.url === value).map(({ providerId, assetId, versionId }) => ({ providerId, assetId, versionId }))
        ?? options.snapshot?.records.flatMap((record) => record.document.versions.filter((version) => version.url === value).map((version) => ({ providerId: providerId!, assetId: record.id, versionId: version.id })));
      if (matches?.length) for (const exact of matches) index.references.push({ ref: exact, location });
      else advisory(location, "Immutable Assets URL has no known asset/version association.", value, true);
      return value;
    }
    advisory(location, managedHint(value) ? "Unrecognized managed URL; it was not rewritten." : "External or unmanaged URL preserved verbatim.", value, managedHint(value));
    return value;
  };
  const markdown = (value: string, location: AssetImpactLocation): string => {
    const destinations = markdownAssetDestinations(value);
    for (const destination of destinations) url(destination.value, { ...location, markdown: { from: destination.from, to: destination.to, useFrom: destination.useFrom, useTo: destination.useTo } });
    const covered = new Set(destinations.map(({ from, to }) => `${from}:${to}`));
    let offset = value.indexOf("/uploaded-assets/");
    while (offset >= 0) {
      if (!destinations.some(({ from, to }) => offset >= from && offset < to)) advisory(location, "Managed-looking text outside a parsed Markdown destination is advisory only.", value.slice(offset, offset + 120), true);
      offset = value.indexOf("/uploaded-assets/", offset + 1);
    }
    return options.lock ? rewriteMarkdownDestinations(value, (destination) => {
      if (!covered.has(`${destination.from}:${destination.to}`)) return undefined;
      const ref = parseManagedAssetUrl(destination.value, options.providerId ?? options.lock!.providerId);
      return ref ? resolvePinnedAsset(ref, options.lock!)?.url : undefined;
    }) : value;
  };
  const arbitrary = (value: JsonValue | undefined, location: AssetImpactLocation) => {
    if (typeof value === "string" && managedHint(value)) advisory(location, "Managed-looking value has no supported URL/Markdown declaration.", value, true);
    else if (validateAssetAssetRef(value)) { index.references.push({ ref: value, location }); }
    else if (Array.isArray(value)) value.forEach((item, i) => arbitrary(item, { ...location, valuePath: [...location.valuePath, i] }));
    else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) arbitrary(item, { ...location, valuePath: [...location.valuePath, key] });
  };
  const content = (schema: ContentValueSchema, value: JsonValue | undefined, location: AssetImpactLocation): JsonValue | undefined => {
    if (value === undefined) return value;
    if (schema.kind === "media-use" && value && typeof value === "object" && !Array.isArray(value) && validateAssetAssetRef((value as Record<string, JsonValue>).asset)) { index.references.push({ ref: (value as Record<string, JsonValue>).asset as unknown as AssetAssetRef, location: { ...location, selectionPath: location.valuePath, valuePath: [...location.valuePath, "asset"] } }); return value; }
    if (schema.kind === "url" && typeof value === "string") return url(value, location);
    if (schema.kind === "markdown" && typeof value === "string") return markdown(value, location);
    if (schema.kind === "object" && value && typeof value === "object" && !Array.isArray(value)) {
      for (const field of schema.fields) { const next = content(field, (value as Record<string, JsonValue>)[field.id], { ...location, valuePath: [...location.valuePath, field.id] }); if (next !== undefined) (value as Record<string, JsonValue>)[field.id] = next; }
    } else if (schema.kind === "list" && Array.isArray(value)) value.forEach((item, i) => { value[i] = content(schema.item, item, { ...location, valuePath: [...location.valuePath, i] })!; });
    else arbitrary(value, location);
    return value;
  };
  const property = (schema: ValueDefinition, value: JsonValue | undefined, location: AssetImpactLocation, key: string): JsonValue | undefined => {
    if (typeof value === "string" && schema.schema.type === "string") {
      if (schema.editor.kind === "text" && schema.editor.mode === "markdown-source") return markdown(value, location);
      if (URL_PROPERTIES.has(key)) return url(value, location);
    }
    if (schema.schema.type === "object" && value && typeof value === "object" && !Array.isArray(value)) {
      if (validateAssetAssetRef(value)) index.references.push({ ref: value, location });
      else for (const field of schema.schema.fields) { const next = property(field, (value as Record<string, JsonValue>)[field.key], { ...location, valuePath: [...location.valuePath, field.key] }, field.key); if (next !== undefined) (value as Record<string, JsonValue>)[field.key] = next; }
    } else if (schema.schema.type === "array" && Array.isArray(value)) value.forEach((item, i) => { value[i] = property(schema.schema.type === "array" ? schema.schema.items : schema, item, { ...location, valuePath: [...location.valuePath, i] }, key)!; });
    else if (schema.schema.type === "tuple" && Array.isArray(value)) schema.schema.items.forEach((field, i) => { if (value[i] !== undefined) value[i] = property(field, value[i], { ...location, valuePath: [...location.valuePath, i] }, key)!; });
    else arbitrary(value, location);
    return value;
  };
  const composition = (document: CompositionDocument, catalog: ComponentCatalog, location: Omit<AssetImpactLocation, "valuePath">) => {
    const walk = (nodes: readonly CompositionNode[]) => { for (const node of nodes) {
      const component = catalog.get(node.componentId);
      if (component) node.props = { ...structuredClone(component.defaults), ...node.props };
      if (!component) { index.complete = false; index.advisory.push({ location: { ...location, nodeId: node.id, valuePath: [] }, reason: "Component declaration is unavailable; usage cannot be proven complete." }); }
      for (const [key, value] of Object.entries(node.props)) {
        const at = { ...location, nodeId: node.id, property: key, valuePath: [key] };
        const field = component?.fields.find((field) => field.prop === key);
        if (field) node.props[key] = property(field, value, at, key)!; else arbitrary(value, at);
      }
      for (const children of Object.values(node.slots)) walk(children);
    } };
    walk(document.root);
  };
  return { index, content, composition };
}
export function resolveCompositionAsset(document: CompositionDocument, catalog: ComponentCatalog, options: AssetImpactOptions = {}) {
  const output = structuredClone(document), scan = collector(options);
  scan.composition(output, catalog, { domain: "compositions", providerId: "preview", recordId: document.id });
  return { document: output, index: scan.index };
}
export function resolveSiteProjectAsset(project: SiteProject, catalog: ComponentCatalog, options: AssetImpactOptions = {}) {
  const output = structuredClone(project), scan = collector(options);
  for (const provider of output.providers.content) for (const entry of provider.entries) {
    const model = provider.models.find(({ id }) => id === entry.modelId);
    if (!model) { scan.index.complete = false; continue; }
    for (const field of model.document.fields) {
      const value = scan.content(field, entry.values[field.id], { domain: "content", providerId: provider.id, modelId: model.id, recordId: entry.id, fieldId: field.id, valuePath: [] });
      if (value !== undefined) entry.values[field.id] = value;
    }
  }
  for (const provider of output.providers.compositions) for (const record of provider.records) scan.composition(record.document, catalog, { domain: "compositions", providerId: provider.id, recordId: record.id });
  for (const route of options.routes ?? []) {
    const start = scan.index.references.length;
    const document = structuredClone(route.composition.document);
    scan.composition(document, catalog, { domain: "materialization", providerId: route.composition.local.providerId, recordId: route.composition.local.recordId, sourceRecordId: route.composition.local.recordId, pathname: route.pathname });
    if (route.composition.linkedSource) scan.composition(structuredClone(route.composition.linkedSource.document), catalog, { domain: "materialization", providerId: route.composition.linkedSource.ref.providerId, recordId: route.composition.linkedSource.ref.recordId, sourceRecordId: route.composition.linkedSource.ref.recordId, pathname: route.pathname });
    for (const impact of scan.index.references.slice(start)) {
      const source = route.materializationSources?.find((source) => source.renderedNodeId === impact.location.nodeId);
      if (source) impact.location = { ...impact.location, providerId: source.providerId, recordId: source.recordId, sourceRecordId: source.recordId, nodeId: source.nodeId, attachmentId: source.attachmentId, entries: source.entries };
    }
  }
  scan.index.references.sort((a, b) => compareUnicodeCodePoints(JSON.stringify([a.ref, a.location]), JSON.stringify([b.ref, b.location])));
  return { project: output, index: scan.index };
}
