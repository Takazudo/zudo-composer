import type { SiteProject } from "../../src/site-project/model/types";
import type { SiteCompiledRoute } from "../../src/site-project/compiler/types";
import type { ComponentPackManifest } from "@zudo-composer/component-contract";
import type { HostDocumentTarget, HostFieldSource } from "./types";

/** Captured provenance only: unused Mappings never establish a rendered value's owner. */
export function createHostSourceBindings(project: SiteProject) {
  const mappings = project.providers.mappings.flatMap(provider => provider.records.map(record => ({ providerId: provider.id, ...record })));
  return (node: HostDocumentTarget, currentRoute: SiteCompiledRoute, prop: string) => mappings.flatMap(record => {
    if (record.document.composition.providerId !== node.providerId || record.document.composition.recordId !== node.recordId) return [];
    const renderedId = currentRoute.composition.linkedSource ? node.renderedNodeId.replace(/^host-(?:local|source)-/, "") : node.renderedNodeId;
    const materialized = currentRoute.materializationSources?.find(source => source.renderedNodeId === renderedId && source.providerId === node.providerId && source.recordId === node.recordId && source.nodeId === node.nodeId);
    const attachments = materialized ? project.collectionAttachments.filter(attachment => attachment.id === materialized.attachmentId) : [];
    const mappingRef = materialized ? attachments.length === 1 ? attachments[0]!.mapping : undefined : currentRoute.source.kind === "mapping" && node.providerId === currentRoute.composition.local.providerId && node.recordId === currentRoute.composition.local.recordId ? currentRoute.source.ref : undefined;
    if (!mappingRef || mappingRef.providerId !== record.providerId || mappingRef.recordId !== record.id) return [];
    const entries = node.entries;
    return record.document.bindings.filter(binding => binding.target.nodeId === node.nodeId && binding.target.prop === prop).flatMap(binding => entries.filter(entry => entry.providerId === record.document.contentModel.providerId && entry.modelId === record.document.contentModel.recordId).map(entry => ({ binding, entry })));
  });
}

/** Human source discovery is independent of Assistant policy and field edit support. */
export function describeHostFieldSources(project: SiteProject, manifest: ComponentPackManifest, routes: readonly { route: SiteCompiledRoute; targets: readonly HostDocumentTarget[] }[]) {
  const bindings = createHostSourceBindings(project);
  const uses = routes.flatMap(({ route, targets }) => targets.flatMap(target =>
    (manifest.components.find(component => component.id === target.componentId)?.fields ?? []).flatMap(field =>
      bindings(target, route, field.prop).map(source => ({ ...source, pathname: route.pathname, renderedNodeId: target.renderedNodeId, prop: field.prop })))));
  return (route: SiteCompiledRoute, target: HostDocumentTarget): HostFieldSource[] =>
    (manifest.components.find(component => component.id === target.componentId)?.fields ?? []).flatMap(field => {
      const sources = bindings(target, route, field.prop);
      if (!sources.length) return [];
      return [{ prop: field.prop, label: field.label,
        ...(sources.length > 1 ? { reason: "Multiple captured sources contribute to this field; inspect each source before editing." } : {}),
        sources: sources.map(({ binding, entry }) => {
          const provider = project.providers.content.find(provider => provider.id === entry.providerId);
          const record = provider?.entries.find(record => record.id === entry.recordId && record.modelId === entry.modelId);
          const sourceField = !binding.source ? provider?.models.find(model => model.id === entry.modelId)?.document.fields.find(field => field.id === binding.sourceFieldId) : undefined;
          const reason = binding.source ? "Entry identity is read-only metadata." : !record || !sourceField ? "The captured Content source is unavailable." : binding.transform.kind !== "identity" || binding.projection?.kind !== "value" ? "This value is transformed or structured by Mapping; edit its Content source, not the rendered value." : undefined;
          const affected = uses.filter(use => use.entry.providerId === entry.providerId && use.entry.modelId === entry.modelId && use.entry.recordId === entry.recordId && (binding.source ? !!use.binding.source : !use.binding.source && use.binding.sourceFieldId === binding.sourceFieldId));
          const unique = new Map(affected.map(use => [JSON.stringify([use.pathname, use.renderedNodeId, use.prop]), { pathname: use.pathname, renderedNodeId: use.renderedNodeId, prop: use.prop }]));
          return { entry, ...(!binding.source ? { fieldId: binding.sourceFieldId } : {}), fieldLabel: binding.source ? "Entry identity" : sourceField?.label ?? binding.sourceFieldId, ...(reason ? { reason } : {}), affectedUses: [...unique.values()] };
        }),
      }];
    });
}
