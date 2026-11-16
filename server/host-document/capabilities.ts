import type { ComponentPackManifest } from "@zudo-composer/component-contract";
import type { SiteProject } from "../../src/site-project/model/types";
import type { SitemapNode } from "../../src/sitemapper/model/types";
import { createComponentCatalog, type CompositionNode } from "../../src/composer/model/types";
import { addNode } from "../../src/composer/model/commands";
import { diagnoseDocument, describeSlotCompleteness } from "../../src/composer/model/validate";
import type { HostDocumentTarget } from "./types";
import { validateHostComponentPresentation, type HostComponentPresentation } from "../config/host-document";

export function localOwnerReason(project: SiteProject, owner: { providerId: string; recordId: string } | undefined): string | undefined {
  if (!owner || owner.providerId !== "files") return "No supported local Composition owner is available.";
  const record = project.providers.compositions.find(provider => provider.id === owner.providerId)?.records.find(record => record.id === owner.recordId);
  if (!record) return "The owning Composition is unavailable.";
  if (record.document.binding || record.document.publication?.kind === "global-template") return "Linked/global structure belongs to its source editor.";
  if (project.providers.mappings.some(provider => provider.records.some(mapping => mapping.document.composition.providerId === owner.providerId && mapping.document.composition.recordId === owner.recordId))) return "This is a shared Mapping presentation. Edit its shared Content sources; local prop overrides are not supported.";
  const flatten = (nodes: readonly SitemapNode[]): SitemapNode[] => nodes.flatMap(node => [node, ...flatten(node.children)]);
  if (project.providers.sitemaps.flatMap(provider => provider.records.flatMap(record => flatten(record.document.root))).filter(node => node.source.kind === "composition" && node.source.ref.providerId === owner.providerId && node.source.ref.recordId === owner.recordId).length > 1) return "This Composition is shared by multiple pages. Review affected uses in its source editor.";
}
export function mappedSlot(project: SiteProject, owner: { providerId: string; recordId: string; nodeId: string }, slotId: string): boolean {
  return project.collectionAttachments.some(attachment => attachment.composition.providerId === owner.providerId && attachment.composition.recordId === owner.recordId && attachment.target.nodeId === owner.nodeId && attachment.target.slotId === slotId);
}
export function describeHostDocumentTargets(targets: readonly HostDocumentTarget[], project: SiteProject, manifest: ComponentPackManifest, presentation?: HostComponentPresentation, uses: ReadonlyMap<string, readonly string[]> = new Map()): HostDocumentTarget[] {
  validateHostComponentPresentation(presentation, manifest);
  const catalog = createComponentCatalog(manifest);
  const flatten = (nodes: readonly CompositionNode[]): CompositionNode[] => nodes.flatMap(node => [node, ...Object.values(node.slots).flatMap(flatten)]);
  return targets.map(target => {
    const component = catalog.get(target.componentId), display = presentation?.[target.componentId];
    const rawLabel = display?.labelProp ? target.props[display.labelProp] : undefined;
    const kindTitle = component?.title ?? target.componentId;
    const label = typeof rawLabel === "string" && rawLabel.trim() ? rawLabel.trim().slice(0, 160) : kindTitle;
    const reason = localOwnerReason(project, target), placementReason = localOwnerReason(project, target.placement);
    const record = project.providers.compositions.find(provider => provider.id === target.providerId)?.records.find(record => record.id === target.recordId);
    const nodes = record ? flatten(record.document.root) : [];
    const node = nodes.find(node => node.id === target.nodeId);
    let candidateId = "host-palette-candidate";
    while (nodes.some(node => node.id === candidateId)) candidateId += "-next";
    const insertSlots = (component?.slots ?? []).map(slot => {
      const slotReason = reason ?? (mappedSlot(project, target, slot.id) ? "This slot is populated by Mapping/Content." : undefined);
      const components = slotReason || !record || !node ? [] : manifest.components.filter(candidate => {
        const result = addNode(record.document, catalog, { parentId: node.id, slotId: slot.id, index: 0 }, candidate.id, () => candidateId);
        return result.ok && diagnoseDocument(result.document, catalog).canExport && describeSlotCompleteness(result.document, catalog).length === 0;
      }).map(candidate => ({ id: candidate.id, title: candidate.title }));
      return { slotId: slot.id, label: slot.label ?? slot.id, components, ...(slotReason ? { reason: slotReason } : components.length ? {} : { reason: "No component with complete defaults fits this slot." }) };
    });
    const capability = (reason: string | undefined) => ({ allowed: !reason, ...(reason ? { reason } : {}) });
    return { ...target, presentation: { label, kindTitle, transparent: display?.transparent === true }, capabilities: { fields: capability(reason), structure: capability(reason), placement: capability(placementReason), insertSlots, uses: uses.get(`${target.providerId}/${target.recordId}`) ?? [] } };
  });
}
