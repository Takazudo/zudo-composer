// Renders persisted composition nodes the way the tool's delivery runtime
// does: manifest defaults under node props, and each slot's rendered children
// projected onto the slot's prop (a `single` slot gets the child itself).
import { h, type ComponentType, type VNode } from "preact";
import { componentPack } from "../components/pack";

export interface TestNode {
  id: string;
  componentId: string;
  props?: Record<string, unknown>;
  slots?: Record<string, TestNode[]>;
}

export function manifestOf(componentId: string) {
  const manifest = componentPack.manifest.components.find((component) => component.id === componentId);
  if (!manifest) throw new Error(`No component ${componentId} in the pack`);
  return manifest;
}

export function renderNode(node: TestNode): VNode {
  const manifest = manifestOf(node.componentId);
  const Component = componentPack.runtime.components[node.componentId]!.component as ComponentType<Record<string, unknown>>;
  const props: Record<string, unknown> = { ...manifest.defaults, ...node.props };
  for (const slot of manifest.slots) {
    const children = (node.slots?.[slot.id] ?? []).map(renderNode);
    props[slot.prop] = slot.cardinality === "single" ? children[0] : children;
  }
  return h(Component, { ...props, key: node.id });
}
