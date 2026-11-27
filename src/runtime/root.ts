import { h, isDescription, type Child, type Component, type Diagnostic, type IslandIdentity, type Reporter } from "@takazudo/zfb/zudo-react";
import { mount, type RootHandle } from "@takazudo/zfb/zudo-react/client";

/** The build half of every root identity Composer mounts in the browser. */
export const COMPOSER_ROOT_BUILD = "zudo-composer";

/**
 * A connected host element carrying the zudo-react/1 caller-owned (skip-SSR)
 * wrapper contract: the four attributes come from zfb's hydration docs,
 * "Mount from a host you own", and `mount` refuses a host without them.
 */
export function createOwnedRootHost(identity: IslandIdentity, parent: Element = document.body): HTMLElement {
  const host = parent.ownerDocument.createElement("div");
  host.setAttribute("data-zfb-island-skip-ssr", identity.component);
  host.setAttribute("data-zfb-transport", "json/1");
  host.setAttribute("data-zfb-protocol", "zudo-react/1");
  host.setAttribute("data-zfb-build", identity.build);
  parent.append(host);
  return host;
}

export interface OwnedRoot {
  /** The wrapper the root renders into; removed by `stop()`. */
  readonly host: HTMLElement;
  /** `null` when the mount was refused or cancelled; `diagnostics` says why. */
  readonly handle: RootHandle | null;
  readonly diagnostics: readonly Diagnostic[];
  /** Unmounts the root and removes its host. Idempotent. */
  stop(): void;
}

export interface MountOwnedChildOptions {
  identity: IslandIdentity;
  /** Element the host is appended to. Defaults to `document.body`. */
  parent?: Element;
  /** Aborting before commit cancels the mount (`ZR_CANCELLED`, `handle === null`). */
  signal?: AbortSignal;
  /** Receives each diagnostic as well as `OwnedRoot.diagnostics`. */
  report?: Reporter;
}

type NamedComponent = Component<Record<string, never>> & { displayName?: string };

// `mount` refuses (ZR_IDENTITY) a root that is not a component description
// whose `displayName ?? name` equals `identity.component`; wrap anything else.
function asIdentityRoot(node: Child, component: string): Child {
  if (isDescription(node) && typeof node.type === "function" && ((node.type as NamedComponent).displayName ?? node.type.name) === component) return node;
  const Root: NamedComponent = () => node;
  Root.displayName = component;
  return h(Root, null);
}

/** Mount any `Child` as a caller-owned root, named `identity.component`, under a fresh wrapper host. */
export function mountOwnedChild(node: Child, options: MountOwnedChildOptions): OwnedRoot {
  const host = createOwnedRootHost(options.identity, options.parent);
  const diagnostics: Diagnostic[] = [];
  const handle = mount(asIdentityRoot(node, options.identity.component), host, {
    identity: options.identity,
    signal: options.signal,
    report: (diagnostic) => {
      diagnostics.push(diagnostic);
      options.report?.(diagnostic);
    },
  });
  let stopped = false;
  return {
    host,
    handle,
    diagnostics,
    stop() {
      if (stopped) return;
      stopped = true;
      handle?.unmount();
      host.remove();
    },
  };
}

export interface MountOwnedOptions extends Omit<MountOwnedChildOptions, "identity"> {
  /** Defaults to {@link COMPOSER_ROOT_BUILD}. */
  build?: string;
  /** Root component identity. Defaults to the function name (production bundles set `keepNames`). */
  name?: string;
}

/** Replacement for Preact's `render(<Component {...props} />, element)`. */
export function mountOwned<P extends Record<string, unknown>>(component: Component<P>, props: P, options: MountOwnedOptions = {}): OwnedRoot {
  const name = options.name ?? component.name;
  if (!name) throw new Error("mountOwned needs a named component or an explicit `name` for the root identity.");
  return mountOwnedChild(h(component, props), { ...options, identity: { component: name, build: options.build ?? COMPOSER_ROOT_BUILD } });
}
