import type {
  ComponentResolution,
  PersistedComponentNode,
  TrustedComponentPack,
} from './types.js';

export function resolveComponentNode<TComponent, TRenderOutput = unknown, TElement = unknown>(
  node: PersistedComponentNode,
  pack: TrustedComponentPack<TComponent, TRenderOutput, TElement>,
): ComponentResolution<TComponent, TRenderOutput, TElement> {
  const definition = pack.manifest.components.find((candidate) => candidate.id === node.componentId);
  if (definition === undefined) return { status: 'opaque', reason: 'unknown-component', node };
  if (definition.schemaVersion !== node.componentVersion) {
    return { status: 'opaque', reason: 'component-version-mismatch', node };
  }
  // validateRuntimeParity guarantees this entry exists at the same schema version.
  const entry = pack.runtime.components[definition.id];
  if (entry === undefined) {
    throw new Error(`Component pack invariant violated: missing runtime entry for ${JSON.stringify(definition.id)}`);
  }
  return { status: 'resolved', node, definition, runtime: entry };
}
