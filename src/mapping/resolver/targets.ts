import type { ComponentCatalog, CompositionDocument, CompositionNode } from "../../composer/model/types";
import type { MappingTargetDescriptor } from "../model";

export interface MappingTargetDiscovery { targets: readonly MappingTargetDescriptor[]; diagnostics: readonly { code: "component-missing" | "component-version-mismatch"; nodeId: string; message: string }[] }

export function discoverMappingTargets(document: CompositionDocument, manifest: ComponentCatalog): MappingTargetDiscovery {
  const targets: MappingTargetDescriptor[] = []; const diagnostics: MappingTargetDiscovery["diagnostics"][number][] = [];
  const visit = (node: CompositionNode) => {
    const component = manifest.get(node.componentId);
    if (!component) diagnostics.push({ code: "component-missing", nodeId: node.id, message: `Component "${node.componentId}" is unavailable for node "${node.id}".` });
    else if (component.schemaVersion !== node.componentVersion) diagnostics.push({ code: "component-version-mismatch", nodeId: node.id, message: `Node "${node.id}" uses ${node.componentId} v${node.componentVersion}, but the manifest provides v${component.schemaVersion}.` });
    else for (const field of component.fields) targets.push({ target: { nodeId: node.id, prop: field.prop }, nodeLabel: `${component.title} (${node.id})`, componentId: component.id, componentVersion: component.schemaVersion, componentLabel: component.title, fieldLabel: field.label, kind: field.kind, required: field.required ?? false, ...(field.kind === "select" ? { options: field.options } : {}) });
    for (const children of Object.values(node.slots)) for (const child of children) visit(child);
  };
  for (const node of document.root) visit(node);
  return { targets, diagnostics };
}
