import type { ComponentCatalog, CompositionNode } from "../../composer/model/types";
import { cloneJson } from "../../shared";
import type { ContentCatalog } from "../../content/catalog";
import type { ContentEntryRecord } from "../../content/model";
import { isValueValidForField } from "../../content/model";
import type { CompositionCatalog } from "../catalog";
import type { AppliedMappingBinding, MappingDefinitionDiagnostic, MappingDefinitionResolution, MappingEntryDiagnostic, MappingEvaluationResult, MappingRecord, ResolvedMappingBinding } from "../model";
import { validateMappingTransform } from "../model";
import { applyMappingTransform, isCanonicalDate, isMappingCompatible } from "./compatibility";
import { discoverMappingTargets } from "./targets";

function targetKey(target: { nodeId: string; prop: string }): string { return `${target.nodeId}\u0000${target.prop}`; }

export async function resolveMappingDefinition(mapping: MappingRecord, catalogs: { content: ContentCatalog; compositions: CompositionCatalog }, manifest: ComponentCatalog): Promise<MappingDefinitionResolution> {
  const diagnostics: MappingDefinitionDiagnostic[] = [];
  const [content, composition] = await Promise.all([catalogs.content.resolveModel(mapping.document.contentModel), catalogs.compositions.resolve(mapping.document.composition)]);
  if (content.status !== "resolved") diagnostics.push({ scope: "definition", severity: "blocking", code: content.status === "not-found" ? "content-model-not-found" : content.status === "provider-error" ? "content-provider-error" : "content-model-invalid", message: content.status === "not-found" ? "The referenced Content model was not found." : content.reason });
  if (composition.status !== "resolved") diagnostics.push({ scope: "definition", severity: "blocking", code: composition.status === "not-found" ? "composition-not-found" : composition.status === "provider-error" ? "composition-provider-error" : "composition-invalid", message: composition.status === "not-found" ? "The referenced Composition was not found." : composition.reason });
  if (content.status !== "resolved" || composition.status !== "resolved") return { status: "blocked", mapping, targets: [], bindings: [], diagnostics, ...(content.status === "resolved" ? { contentModel: content.record } : {}), ...(composition.status === "resolved" ? { composition: composition.record } : {}) };
  const discovery = discoverMappingTargets(composition.record.document, manifest);
  for (const issue of discovery.diagnostics) diagnostics.push({ scope: "definition", severity: "blocking", code: issue.code, message: issue.message, target: { nodeId: issue.nodeId, prop: "" } });
  const sourceById = new Map(content.record.document.fields.map((field) => [field.id, field])); const targetByKey = new Map(discovery.targets.map((target) => [targetKey(target.target), target])); const seenTargets = new Set<string>(); const bindings: ResolvedMappingBinding[] = [];
  for (const binding of mapping.document.bindings) {
    const source = sourceById.get(binding.sourceFieldId); const key = targetKey(binding.target); const target = targetByKey.get(key);
    if (!source) diagnostics.push({ scope: "definition", severity: "blocking", code: "source-field-missing", bindingId: binding.id, sourceFieldId: binding.sourceFieldId, message: `Source field "${binding.sourceFieldId}" no longer exists.` });
    if (seenTargets.has(key)) diagnostics.push({ scope: "definition", severity: "blocking", code: "duplicate-target", bindingId: binding.id, target: binding.target, message: `Target "${binding.target.nodeId}.${binding.target.prop}" is bound more than once.` }); else seenTargets.add(key);
    if (!target) {
      const nodeExists = findNode(composition.record.document.root, binding.target.nodeId);
      diagnostics.push({ scope: "definition", severity: "blocking", code: nodeExists ? "target-field-missing" : "target-node-missing", bindingId: binding.id, target: binding.target, message: nodeExists ? `Target field "${binding.target.prop}" no longer exists on node "${binding.target.nodeId}".` : `Target node "${binding.target.nodeId}" no longer exists.` });
    }
    if (!validateMappingTransform(binding.transform)) diagnostics.push({ scope: "definition", severity: "blocking", code: "invalid-transform-config", bindingId: binding.id, message: `Binding "${binding.id}" has an invalid transform configuration.` });
    else if (source && target && !isMappingCompatible(source.kind, target.kind, binding.transform)) diagnostics.push({ scope: "definition", severity: "blocking", code: "incompatible-binding", bindingId: binding.id, sourceFieldId: source.id, target: binding.target, message: `${source.kind} cannot map to ${target.kind} with ${binding.transform.kind}.` });
    else if (source && target && !seenTargets.has(`accepted:${key}`)) { bindings.push({ binding, source, target }); seenTargets.add(`accepted:${key}`); }
  }
  return { status: diagnostics.length ? "blocked" : "ready", mapping, contentModel: content.record, composition: composition.record, targets: discovery.targets, bindings, diagnostics };
}

function findNode(nodes: readonly CompositionNode[], id: string): CompositionNode | undefined { for (const node of nodes) { if (node.id === id) return node; for (const children of Object.values(node.slots)) { const found = findNode(children, id); if (found) return found; } } return undefined; }

export async function evaluateMapping(mapping: MappingRecord, entry: ContentEntryRecord, catalogs: { content: ContentCatalog; compositions: CompositionCatalog }, manifest: ComponentCatalog): Promise<MappingEvaluationResult> {
  const definition = await resolveMappingDefinition(mapping, catalogs, manifest);
  return evaluateResolvedMapping(definition, entry);
}

/**
 * Evaluates transient Entry data against an already-resolved Mapping.
 *
 * Resolution may involve provider I/O, while evaluation is deliberately pure
 * and synchronous so authoring surfaces can render every current draft
 * revision without rereading either Content or Mapping storage.
 */
export function evaluateResolvedMapping(definition: MappingDefinitionResolution, entry: ContentEntryRecord): MappingEvaluationResult {
  const mapping = definition.mapping;
  const document = definition.composition ? cloneJson(definition.composition.document) : undefined;
  if (definition.status === "blocked" || !document) return { status: "blocked", ...(document ? { document } : {}), definitionDiagnostics: definition.diagnostics, entryDiagnostics: [], appliedBindings: [], appliedBindingCount: 0, unchangedStaticCount: mapping.document.bindings.length };
  const entryDiagnostics: MappingEntryDiagnostic[] = []; const appliedBindings: AppliedMappingBinding[] = [];
  if (!definition.contentModel || entry.modelId !== definition.contentModel.id) return { status: "blocked", document, definitionDiagnostics: definition.diagnostics, entryDiagnostics: [{ scope: "entry", severity: "blocking", code: "entry-model-mismatch", entryId: entry.id, message: `Entry "${entry.id}" belongs to Content model "${entry.modelId}", not "${definition.contentModel?.id ?? "unresolved"}".` }], appliedBindings, appliedBindingCount: 0, unchangedStaticCount: mapping.document.bindings.length };
  for (const resolved of definition.bindings) {
    const { binding, source, target } = resolved; const value = entry.values[source.id];
    if (value === undefined || (typeof value === "string" && value.trim().length === 0)) { const blocking = source.required; entryDiagnostics.push({ scope: "entry", severity: blocking ? "blocking" : "nonblocking", code: blocking ? "required-value-missing" : "optional-value-missing", entryId: entry.id, bindingId: binding.id, sourceFieldId: source.id, target: binding.target, message: `${blocking ? "Required" : "Optional"} source field "${source.label}" has no value; the static target value is unchanged.` }); continue; }
    if (!isValueValidForField(source, value)) { entryDiagnostics.push({ scope: "entry", severity: "blocking", code: "invalid-source-value", entryId: entry.id, bindingId: binding.id, sourceFieldId: source.id, target: binding.target, message: `Source value for "${source.label}" does not match ${source.kind}.` }); continue; }
    if (source.kind === "date" && !isCanonicalDate(value as string)) { entryDiagnostics.push({ scope: "entry", severity: "blocking", code: "invalid-canonical-date", entryId: entry.id, bindingId: binding.id, sourceFieldId: source.id, target: binding.target, message: `Source date for "${source.label}" is not canonical YYYY-MM-DD.` }); continue; }
    const transformed = applyMappingTransform(value as string | number | boolean, binding.transform);
    if (target.kind === "select" && !target.options?.includes(transformed as string)) { entryDiagnostics.push({ scope: "entry", severity: "blocking", code: "select-option-invalid", entryId: entry.id, bindingId: binding.id, sourceFieldId: source.id, target: binding.target, message: `Value "${String(transformed)}" is not a current option for "${target.fieldLabel}".` }); continue; }
    const node = findNode(document.root, target.target.nodeId); if (node) { node.props[target.target.prop] = transformed; appliedBindings.push({ bindingId: binding.id, sourceFieldId: source.id, target: { ...target.target }, value: transformed }); }
  }
  return { status: entryDiagnostics.some((item) => item.severity === "blocking") ? "blocked" : "ready", document, definitionDiagnostics: definition.diagnostics, entryDiagnostics, appliedBindings, appliedBindingCount: appliedBindings.length, unchangedStaticCount: mapping.document.bindings.length - appliedBindings.length };
}
