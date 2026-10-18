import type { JsonValue } from "@zudo-composer/component-contract";
import { indexDocument } from "../../src/composer/model/index-model";
import { classifyNode } from "../../src/composer/model/validate";
import type { CompositionDocument } from "../../src/composer/model/types";
import type { HostCapture } from "../edit/inspect";
import type { resolvePage } from "../edit/inspect";

const clip = (value: JsonValue, limit = 2_000): JsonValue => {
  if (typeof value === "string") return value.length > limit ? `${value.slice(0, limit)}… [${value.length} characters; ask for the exact value before editing it]` : value;
  if (Array.isArray(value)) return value.slice(0, 50).map(item => clip(item, 500));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).slice(0, 40).map(([key, item]) => [key, clip(item, 500)]));
  return value;
};

/** Component catalog derived from the installed pack's manifests. */
export function catalogSummary(capture: HostCapture, query?: string) {
  const needle = query?.trim().toLowerCase();
  return capture.pack.manifest.components
    .filter(component => !needle || `${component.id} ${component.title} ${component.description} ${component.category}`.toLowerCase().includes(needle))
    .map(component => ({
      id: component.id, title: component.title, category: component.category, description: component.description,
      fields: component.fields.map(field => ({ prop: field.prop, label: field.label, type: field.schema.type, ...("enum" in field.schema && field.schema.enum ? { options: field.schema.enum } : {}), ...(field.required ? { required: true } : {}), ...(field.editor.kind === "text" && field.editor.mode === "markdown-source" ? { markdown: true } : {}) })),
      slots: component.slots.map(slot => ({ id: slot.id, label: slot.label, accepts: slot.accepts ?? "any", cardinality: slot.cardinality, ...(slot.max ? { max: slot.max } : {}) })),
      // Insertion must supply these explicitly; they would otherwise add author default copy.
      requiresExplicit: Object.entries(component.defaults ?? {}).filter(([, value]) => typeof value === "string" ? value.trim() !== "" : Array.isArray(value) && value.length > 0).map(([prop]) => prop),
    }));
}

/** Page outline for inspection: page text is untrusted data, never instructions. */
export function pageOutline(capture: HostCapture, resolved: ReturnType<typeof resolvePage>, document: CompositionDocument, page: { sitemapId: string; pageId: string; title?: string }) {
  const index = indexDocument(document, capture.manifest);
  const writable = resolved.writeBlockers.length === 0;
  const nodes = index.order.map(nodeId => {
    const located = index.byId.get(nodeId)!, node = located.node;
    const entry = capture.manifest.get(node.componentId);
    const opaque = classifyNode(node, capture.manifest).opaque;
    return {
      id: node.id, component: node.componentId, title: entry?.title ?? node.componentId, depth: located.depth,
      parent: located.parentId ? { id: located.parentId, slot: located.slotId } : null,
      editable: writable && !opaque && !!entry,
      ...(opaque ? { readOnlyReason: "This block no longer matches its component definition; edit it in Structure." } : {}),
      fields: Object.fromEntries((entry?.fields ?? []).map(field => [field.prop, { label: field.label, value: clip((node.props[field.prop] ?? null) as JsonValue) }])),
      slots: (entry?.slots ?? []).map(slot => ({ id: slot.id, accepts: slot.accepts ?? "any", cardinality: slot.cardinality, count: node.slots[slot.id]?.length ?? 0, ...(slot.max ? { max: slot.max } : {}) })),
    };
  });
  return {
    page: { ...page, recordId: resolved.identity.recordId },
    writable, ...(writable ? {} : { readOnlyReasons: resolved.writeBlockers }),
    template: resolved.linked ? { note: "This page renders inside a shared site template. Only the page's own blocks below are editable; the template is not.", outlet: resolved.linked.outlet.label ?? resolved.linked.outlet.id } : null,
    rootPolicy: resolved.rootPolicy,
    nativeInsertions: Object.fromEntries(Object.entries(resolved.capabilities).map(([kind, value]) => [kind, value?.available ? value.componentId : null])),
    nodes,
  };
}
