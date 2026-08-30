import type { FieldDefinition } from "@zudo-composer/component-contract";
import type { ComponentCatalog, CompositionDocument, CompositionNode } from "../../composer/model/types";
import type { MappingTarget, MappingTargetDescriptor, ScalarMappingTargetField } from "../model";

export interface UnsupportedStructuredTarget {
  target: MappingTarget;
  nodeLabel: string;
  fieldLabel: string;
  message: string;
}

export interface MappingTargetDiscovery { targets: readonly MappingTargetDescriptor[]; unsupportedStructuredTargets: readonly UnsupportedStructuredTarget[]; diagnostics: readonly { code: "component-missing" | "component-version-mismatch"; nodeId: string; message: string }[] }

function isStructuredField(field: FieldDefinition): boolean {
  return "items" in field.schema || "fields" in field.schema;
}

function scalarTarget(node: CompositionNode, component: NonNullable<ReturnType<ComponentCatalog["get"]>>, field: ScalarMappingTargetField): MappingTargetDescriptor {
  const base = { target: { nodeId: node.id, prop: field.prop }, nodeLabel: `${component.title} (${node.id})`, componentId: component.id, componentVersion: component.schemaVersion, componentLabel: component.title, fieldLabel: field.label, required: field.required ?? false };
  if ("enum" in field.schema) return { ...base, kind: field.editor.kind, options: field.schema.enum } as MappingTargetDescriptor;
  return { ...base, kind: field.editor.kind } as MappingTargetDescriptor;
}

export function discoverMappingTargets(document: CompositionDocument, manifest: ComponentCatalog): MappingTargetDiscovery {
  const targets: MappingTargetDescriptor[] = []; const unsupportedStructuredTargets: UnsupportedStructuredTarget[] = []; const diagnostics: MappingTargetDiscovery["diagnostics"][number][] = [];
  const visit = (node: CompositionNode) => {
    const component = manifest.get(node.componentId);
    if (!component) diagnostics.push({ code: "component-missing", nodeId: node.id, message: `Component "${node.componentId}" is unavailable for node "${node.id}".` });
    else if (component.schemaVersion !== node.componentVersion) diagnostics.push({ code: "component-version-mismatch", nodeId: node.id, message: `Node "${node.id}" uses ${node.componentId} v${node.componentVersion}, but the manifest provides v${component.schemaVersion}.` });
    else for (const field of component.fields) {
      if (isStructuredField(field)) unsupportedStructuredTargets.push({ target: { nodeId: node.id, prop: field.prop }, nodeLabel: `${component.title} (${node.id})`, fieldLabel: field.label, message: `Structured component field "${node.id}.${field.prop}" cannot be used as a scalar mapping target.` });
      else targets.push(scalarTarget(node, component, field as ScalarMappingTargetField));
    }
    for (const children of Object.values(node.slots)) for (const child of children) visit(child);
  };
  for (const node of document.root) visit(node);
  return { targets, unsupportedStructuredTargets, diagnostics };
}
