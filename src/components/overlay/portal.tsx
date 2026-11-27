import { getScope, type Child } from "@takazudo/zfb/zudo-react";
import { ownLayer } from "../../runtime";

// Body-level layer for the CMS overlays (issue #159). Menus open from row
// action cells inside scrolling, `overflow`-clipped tables; painting them from
// their trigger's own subtree makes them hostage to that subtree's stacking
// context. Rendering into a host appended to `<body>` — combined with fixed
// positioning and `computeMenuPosition`'s clamping — takes them out of it.
//
// zudo-react has no portals: this is `ownLayer`, a second root owned by the
// component's scope. There is one runtime, so signals in `children` stay live
// across both roots; nothing ambient crosses, so what the layer needs travels
// in its props.

export interface OverlayPortalProps {
  /** Keep native-modal descendants in their owning top-layer subtree. */
  container?: Element | null;
  /** Class applied to the host element, so the layer is identifiable in the DOM. */
  hostClass: string;
  children: Child;
}

function OverlayLayer(props: { content: Child }): Child {
  return props.content;
}

/**
 * Mounts `children` in a layer root at `container` (default `document.body`)
 * while this component's scope is active; render it inside a `Show` to tie the
 * layer to a condition. It renders nothing in place.
 */
export function OverlayPortal({ hostClass, children, container }: OverlayPortalProps): null {
  const scope = getScope();
  const layer = ownLayer(scope, OverlayLayer, { content: children }, { name: "OverlayLayer", ...(container ? { parent: container } : {}) });
  scope.onActivate(() => {
    layer.root()?.host.classList.add(hostClass);
  });
  return null;
}
