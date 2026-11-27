import { type Component, type Scope } from "@takazudo/zfb/zudo-react";
import { mountOwned, type OwnedRoot } from "./root";

/**
 * Portal replacement: an overlay layer is a separate caller-owned root mounted
 * at document.body, created on the owner's activation and unmounted with the
 * owner's scope. Signals passed in props keep both roots live (one runtime).
 */
export function ownLayer<P extends Record<string, unknown>>(
  scope: Scope,
  component: Component<P>,
  props: P,
): { readonly root: () => OwnedRoot | null } {
  let root: OwnedRoot | null = null;
  scope.onActivate(() => {
    root = mountOwned(component, props, { build: "composer-layer" });
    root.host.setAttribute("data-composer-layer", "");
    return () => { root?.stop(); root = null; };
  });
  return { root: () => root };
}
