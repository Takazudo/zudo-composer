import { flush, type Component } from "@takazudo/zfb/zudo-react";
import { within } from "@testing-library/dom";
import { mountOwned, type OwnedRoot } from "./root";

const mounted = new Set<OwnedRoot>();

/**
 * Drop-in for @testing-library/preact's render(): same container/queries/unmount
 * shape. There is no rerender — pass signals and assign them, then `await settle()`.
 */
export function render<P extends Record<string, unknown>>(component: Component<P>, props: P) {
  const root = mountOwned(component, props);
  if (!root.handle) throw new Error(`mount failed: ${root.diagnostics.map((d) => d.code).join(", ")}`);
  mounted.add(root);
  return {
    container: root.host,
    diagnostics: root.diagnostics,
    ...within(root.host),
    unmount() { root.stop(); mounted.delete(root); },
  };
}

/** Replacement for act(): wait until the scheduler's DOM and effect queues are quiet. */
export const settle = flush;

export function cleanup() {
  for (const root of mounted) root.stop();
  mounted.clear();
}
