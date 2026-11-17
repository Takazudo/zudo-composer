import type { ComponentPackManifest } from "@zudo-composer/component-contract";
import type { AuthoringWorkspaceSnapshot, compileAuthoringWorkspaceSnapshot } from "../authoring-workspace/capture";
import type { AssistantContentFieldPolicy } from "../config/assistant";
import type { HostSelection, InspectedOwner, AffectedUse } from "../../src/shared/host-review-types";
import { createHostSourceBindings } from "./field-sources";
import type { HostDocumentTarget } from "./types";
import { hostDocumentTargets } from "./render";
import { describeHostDocumentTargets } from "./capabilities";

/** Resolve only captured compiler provenance. Browser labels/capabilities never authorize an edit. */
export function resolveHostOwnership({ snapshot, compiled, selection, manifest, contentFields }: {
  snapshot: AuthoringWorkspaceSnapshot; compiled: Awaited<ReturnType<typeof compileAuthoringWorkspaceSnapshot>>;
  selection: HostSelection; manifest: ComponentPackManifest; contentFields?: readonly AssistantContentFieldPolicy[];
}): Omit<InspectedOwner, "capabilityId"> {
  if (selection.revision !== snapshot.digest) throw Object.assign(new Error("The selected saved page changed. Refresh and select it again."), { code: "stale-plan" });
  const route = compiled.build.routes.find(route => route.pathname === selection.pathname);
  const target = route && hostDocumentTargets(route).find(target => Object.entries(selection.target).every(([key, value]) => target[key as keyof HostDocumentTarget] === value));
  if (!route || !target) throw Object.assign(new Error("The qualified selection is not on this captured route."), { code: "unsupported-target" });
  const qualified = (target: HostDocumentTarget) => ({ renderedNodeId: target.renderedNodeId, providerId: target.providerId, recordId: target.recordId, nodeId: target.nodeId });
  const component = manifest.components.find(component => component.id === target.componentId);
  const field = selection.prop ? component?.fields.find(field => field.prop === selection.prop) : undefined;
  const base = { baseDigest: snapshot.digest, pathname: route.pathname, target: qualified(target), ...(field ? { field: { prop: field.prop, label: field.label, current: target.props[field.prop] } } : {}) };
  const unsupported = (reason: string): Omit<InspectedOwner, "capabilityId"> => ({ ...base, owner: { domain: "unsupported", reason }, capabilities: { fields: [], insertSlots: [] }, affectedUses: [] });
  if (selection.prop && !field) return unsupported("The selected property is not a declared editable component field.");
  const sourceBindings = createHostSourceBindings(snapshot.project);
  const bindings = selection.prop ? sourceBindings(target, route, selection.prop) : [];
  if (bindings.length) {
    if (bindings.length !== 1) return unsupported("This rendered property has multiple owning sources. Select a single supported Content field.");
    const { binding, entry } = bindings[0]!;
    if (binding.source) return unsupported("Entry identity is read-only metadata; it cannot be edited.");
    if (binding.transform.kind !== "identity" || binding.projection?.kind !== "value") return unsupported("Transformed or structured Mapping values require editing their source through a separately supported workflow.");
    const provider = snapshot.project.providers.content.find(provider => provider.id === entry.providerId);
    const record = provider?.entries.find(record => record.id === entry.recordId && record.modelId === entry.modelId);
    const model = provider?.models.find(model => model.id === entry.modelId);
    const sourceField = model?.document.fields.find(field => field.id === binding.sourceFieldId);
    if (!record || !sourceField || !["text", "long-text", "markdown"].includes(sourceField.kind)) return unsupported("This Content source is unavailable or is not a supported textual field.");
    const policy = contentFields?.find(policy => policy.providerId === entry.providerId && policy.modelId === entry.modelId);
    if (!policy?.fieldIds.includes(sourceField.id)) return unsupported("The host has not allowed Assistant edits to this Content field.");
    const affectedUses: AffectedUse[] = compiled.build.routes.flatMap(currentRoute => hostDocumentTargets(currentRoute).flatMap(node => (manifest.components.find(component => component.id === node.componentId)?.fields ?? []).flatMap(prop => sourceBindings(node, currentRoute, prop.prop).some(source => !source.binding.source && source.binding.sourceFieldId === sourceField.id && source.entry.providerId === entry.providerId && source.entry.modelId === entry.modelId && source.entry.recordId === entry.recordId) ? [{ pathname: currentRoute.pathname, target: qualified(node), prop: prop.prop }] : [])));
    return { ...base, field: { prop: selection.prop!, label: sourceField.label, current: record.values[sourceField.id] }, owner: { domain: "content", entry, fieldIds: [sourceField.id] }, capabilities: { fields: [{ id: sourceField.id, label: sourceField.label, kind: sourceField.kind }], insertSlots: [] }, affectedUses };
  }
  const described = describeHostDocumentTargets([target], snapshot.project, manifest)[0]!;
  if (!described.capabilities?.fields.allowed || target.providerId !== route.composition.local.providerId || target.recordId !== route.composition.local.recordId || route.source.kind !== "composition") return unsupported(described.capabilities?.fields.reason ?? "Select the local page owner or a bound Content property. Shared sources are not local overrides.");
  return { ...base, owner: { domain: "composition", page: { sitemapId: compiled.build.activeSitemap.recordId, pageId: route.sitemapNode.id }, recordId: target.recordId, nodeId: target.nodeId }, capabilities: { fields: (field ? [field] : component?.fields ?? []).map(field => ({ id: field.prop, label: field.label, kind: field.schema.type })), insertSlots: described.capabilities.insertSlots.filter(slot => !slot.reason).map(slot => ({ slotId: slot.slotId, components: slot.components.map(component => component.id) })) }, affectedUses: [{ pathname: route.pathname, target: qualified(target), prop: selection.prop ?? "" }] };
}
