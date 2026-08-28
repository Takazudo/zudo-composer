import type {
  ComponentResolution,
  PersistedComponentNode,
  TrustedComponentPack,
} from './types.js';

export function resolveComponentNode<TRuntime>(
  node: PersistedComponentNode,
  pack: TrustedComponentPack<TRuntime>,
): ComponentResolution<TRuntime> {
  const component = pack.manifest.components.find((candidate) => candidate.id === node.componentId);
  if (component === undefined) return { status: 'opaque', reason: 'unknown-component', node };
  if (component.schemaVersion !== node.componentVersion) {
    return { status: 'opaque', reason: 'component-version-mismatch', node };
  }
  // validateRuntimeParity guarantees this entry exists at the same schema version.
  const entry = pack.runtime.components[component.id];
  if (entry === undefined) {
    throw new Error(`Component pack invariant violated: missing runtime entry for ${JSON.stringify(component.id)}`);
  }
  return { status: 'resolved', node, component, runtime: entry.runtime };
}
