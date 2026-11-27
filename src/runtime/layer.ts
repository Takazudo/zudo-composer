import type { Component, Scope } from "@takazudo/zfb/zudo-react";
import { mountOwned, type MountOwnedOptions, type OwnedRoot } from "./root";

export const COMPOSER_LAYER_BUILD = "zudo-composer-layer";

export interface OwnedLayer {
  /** The mounted layer root while its owner is active, otherwise `null`. */
  root(): OwnedRoot | null;
}

/**
 * Replacement for `createPortal`: a separate caller-owned root (by default at
 * `document.body`), mounted when `scope` activates and stopped with it. There is
 * one runtime, so signals passed in `props` stay live across both roots.
 */
export function ownLayer<P extends Record<string, unknown>>(scope: Scope, component: Component<P>, props: P, options: MountOwnedOptions = {}): OwnedLayer {
  let root: OwnedRoot | null = null;
  scope.onActivate(() => {
    root = mountOwned(component, props, { build: COMPOSER_LAYER_BUILD, ...options });
    root.host.setAttribute("data-composer-layer", "");
    return () => {
      root?.stop();
      root = null;
    };
  });
  return { root: () => root };
}
