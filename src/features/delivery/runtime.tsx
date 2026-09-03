import { resolveComponentNode, type ComponentManifest, type JsonObject, type JsonValue, type TrustedComponentPack } from "@zudo-composer/component-contract";
import { Component, h, type ComponentChildren, type JSX } from "preact";
import type { CompositionDocument, CompositionNode } from "../../composer/model/types";
import { validateNodeProps } from "../../composer/model/node-props";
import type { SiteCompiledRouteComposition } from "../../site-project/compiler";
import { safeDeliveryHref } from "./routing";

export interface DeliveryComponentError { nodeId: string; componentId: string; error: unknown }
export interface DeliveryRuntimeProps {
  composition: SiteCompiledRouteComposition;
  pack: TrustedComponentPack;
  onComponentError?: (detail: DeliveryComponentError) => void;
}

type Schema = { type?: string; schema?: Schema; fields?: readonly { key: string; schema: Schema }[]; items?: Schema | readonly Schema[] };

function schemaValue(schema: Schema): Schema { return schema.schema ?? schema; }

function rewriteSchemaValue(value: JsonValue, schema: Schema, key?: string): JsonValue | undefined {
  schema = schemaValue(schema);
  if (key === "href" && schema.type === "string" && typeof value === "string") return safeDeliveryHref(value);
  if (schema.type === "object" && value !== null && !Array.isArray(value) && typeof value === "object") {
    const source = value as JsonObject;
    const result: Record<string, JsonValue> = {};
    for (const field of schema.fields ?? []) if (Object.hasOwn(source, field.key)) {
      const next = rewriteSchemaValue(source[field.key]!, field.schema, field.key);
      if (next !== undefined) result[field.key] = next;
    }
    return result;
  }
  if (schema.type === "array" && Array.isArray(value) && schema.items && !Array.isArray(schema.items)) {
    return value.flatMap((item) => { const next = rewriteSchemaValue(item, schemaValue(schema.items as Schema)); return next === undefined ? [] : [next]; });
  }
  if (schema.type === "tuple" && Array.isArray(value) && Array.isArray(schema.items)) {
    const items = schema.items;
    return value.flatMap((item, index) => { const next = rewriteSchemaValue(item, items[index] as Schema); return next === undefined ? [] : [next]; });
  }
  return value;
}

export function projectTrustedProps(node: CompositionNode, definition: ComponentManifest): Record<string, unknown> | null {
  if (!validateNodeProps(node, definition).ok) return null;
  const props: Record<string, unknown> = { ...definition.defaults };
  const fields = new Map(definition.fields.map((field) => [field.prop, field]));
  const statics = new Set((definition.staticProps ?? []).map(({ prop }) => prop));
  for (const field of definition.fields) if (Object.hasOwn(props, field.prop)) {
    const next = rewriteSchemaValue(props[field.prop] as JsonValue, field.schema as Schema, field.prop);
    if (next === undefined) delete props[field.prop]; else props[field.prop] = next;
  }
  for (const [key, value] of Object.entries(node.props)) {
    const field = fields.get(key);
    if (field) {
      const next = rewriteSchemaValue(value, field.schema as Schema, key);
      if (next === undefined) delete props[key]; else props[key] = next;
    } else if (statics.has(key) && Object.hasOwn(definition.defaults, key)) props[key] = definition.defaults[key];
  }
  return props;
}

class NodeErrorBoundary extends Component<{ detail: Omit<DeliveryComponentError, "error">; report?: (detail: DeliveryComponentError) => void; children: ComponentChildren }, { failed: boolean }> {
  state = { failed: false };
  componentDidCatch(error: unknown): void { this.props.report?.({ ...this.props.detail, error }); this.setState({ failed: true }); }
  render(): ComponentChildren { return this.state.failed ? <div class="site-delivery__component-error" role="status">This part of the page could not be displayed.</div> : this.props.children; }
}

function BlockedNode({ message }: { message: string }): JSX.Element {
  return <div class="site-delivery__component-error" role="status">{message}</div>;
}

interface RuntimeNodeProps {
  node: CompositionNode;
  owner: string;
  pack: TrustedComponentPack;
  outlet?: { parentId: string; slotId: string; children: readonly CompositionNode[]; localOwner: string };
  report?: (detail: DeliveryComponentError) => void;
}

function RuntimeInvocation({ runtime, props }: { runtime: ReturnType<typeof resolveComponentNode> extends infer T ? T : never; props: Record<string, unknown> }): ComponentChildren {
  if (runtime.status !== "resolved") return null;
  return runtime.runtime.adapters?.render ? runtime.runtime.adapters.render(props) as ComponentChildren : h(runtime.runtime.component as never, props);
}

function RuntimeNode({ node, owner, pack, outlet, report }: RuntimeNodeProps): JSX.Element {
  const resolved = resolveComponentNode(node, pack);
  if (resolved.status !== "resolved") return <BlockedNode message="An unavailable page component was blocked." />;
  const props = projectTrustedProps(node, resolved.definition);
  if (!props) return <BlockedNode message="An invalid page component was blocked." />;
  const slots = new Map(resolved.definition.slots.map((slot) => [slot.id, slot]));
  if (Object.keys(node.slots).some((slotId) => !slots.has(slotId))) return <BlockedNode message="An invalid page component was blocked." />;
  for (const [slotId, children] of Object.entries(node.slots)) {
    const slot = slots.get(slotId)!;
    if ((slot.cardinality === "single" && children.length > 1) || (slot.accepts && children.some((child) => !slot.accepts!.includes(child.componentId)))) return <BlockedNode message="An invalid page component was blocked." />;
  }
  for (const slot of resolved.definition.slots) {
    const projected = outlet?.parentId === node.id && outlet.slotId === slot.id;
    const source = projected ? outlet.children : node.slots[slot.id] ?? [];
    if ((slot.cardinality === "single" && source.length > 1) || (slot.accepts && source.some((child) => !slot.accepts!.includes(child.componentId)))) return <BlockedNode message="An invalid page component was blocked." />;
    const childOwner = projected ? outlet.localOwner : owner;
    const children = source.map((child) => <RuntimeNode key={`${childOwner}:${child.id}`} node={child} owner={childOwner} pack={pack} outlet={projected ? undefined : outlet} report={report} />);
    props[slot.prop] = slot.cardinality === "single" ? children[0] : children;
  }
  return <NodeErrorBoundary detail={{ nodeId: node.id, componentId: node.componentId }} report={report}><RuntimeInvocation runtime={resolved} props={props} /></NodeErrorBoundary>;
}

function verifiedLinkedView(composition: SiteCompiledRouteComposition, pack: TrustedComponentPack): { document: CompositionDocument; outlet?: RuntimeNodeProps["outlet"] } | null {
  if (!composition.linkedSource) return { document: composition.document };
  const linked = composition.linkedSource;
  const publication = linked.document.publication;
  const binding = composition.document.binding;
  const owners: CompositionNode[] = [];
  const visit = (nodes: readonly CompositionNode[]): void => { for (const node of nodes) { if (node.id === linked.outlet.target.parentId) owners.push(node); Object.values(node.slots).forEach(visit); } };
  visit(linked.document.root);
  const target = owners[0];
  const targetResolution = target ? resolveComponentNode(target, pack) : undefined;
  if (publication?.kind !== "global-template"
    || publication.outlet.id !== linked.outlet.id
    || publication.outlet.target.parentId !== linked.outlet.target.parentId
    || publication.outlet.target.slotId !== linked.outlet.target.slotId
    || binding?.sourceRecordId !== linked.ref.recordId
    || binding.outletId !== linked.outlet.id
    || owners.length !== 1
    || targetResolution?.status !== "resolved"
    || !targetResolution.definition.slots.some(({ id }) => id === linked.outlet.target.slotId)
    || composition.local.providerId !== linked.ref.providerId) return null;
  return { document: linked.document, outlet: { ...linked.outlet.target, children: composition.document.root, localOwner: `${composition.local.providerId}:${composition.routeRecordId}` } };
}

export function DeliveryRuntime({ composition, pack, onComponentError }: DeliveryRuntimeProps): JSX.Element {
  const view = verifiedLinkedView(composition, pack);
  if (!view) return <BlockedNode message="This page template could not be verified." />;
  const owner = composition.linkedSource ? `${composition.linkedSource.ref.providerId}:${composition.linkedSource.ref.recordId}` : `${composition.local.providerId}:${composition.routeRecordId}`;
  return <>{view.document.root.map((node) => <RuntimeNode key={`${owner}:${node.id}`} node={node} owner={owner} pack={pack} outlet={view.outlet} report={onComponentError} />)}</>;
}
