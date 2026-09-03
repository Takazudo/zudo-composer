import { Fragment, render, type ComponentChildren } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";

// Body-level portal for the CMS overlays (issue #159). Menus open from row
// action cells inside scrolling, `overflow`-clipped tables; painting them from
// their trigger's own subtree makes them hostage to that subtree's stacking
// context. Rendering into a host appended to `<body>` — combined with fixed
// positioning and `computeMenuPosition`'s clamping — takes them out of it.
//
// Preact's own `createPortal` ships only in `preact/compat`, and importing that
// anywhere rewires option hooks for the WHOLE bundle (React-flavoured
// `onChange` among them, which this app uses in ~80 places with native
// semantics). So the portal is a second Preact root over a host element
// instead: these overlays take no context from their ancestors, which is the
// only thing a separate root gives up.

export interface OverlayPortalProps {
  /** Class applied to the host element, so the portal is identifiable in the DOM. */
  hostClass: string;
  children: ComponentChildren;
}

export function OverlayPortal({ hostClass, children }: OverlayPortalProps): null {
  const hostRef = useRef<HTMLDivElement | null>(null);
  // Overlays are client-only; without a document there is nothing to portal to.
  if (hostRef.current === null && typeof document !== "undefined") {
    hostRef.current = document.createElement("div");
    hostRef.current.className = hostClass;
  }

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    document.body.appendChild(host);
    return () => {
      render(null, host);
      host.remove();
    };
  }, []);

  // No dependency array: the host mirrors whatever this render produced.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (host) render(<Fragment>{children}</Fragment>, host);
  });

  return null;
}
