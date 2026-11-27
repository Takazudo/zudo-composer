import { h, type Component, type Diagnostic } from "@takazudo/zfb/zudo-react";
import { mount, type RootHandle } from "@takazudo/zfb/zudo-react/client";

export interface OwnedRoot {
  readonly host: HTMLElement;
  readonly handle: RootHandle | null;
  readonly diagnostics: Diagnostic[];
  stop(): void;
}

// Caller-owned client mount: the four wrapper attributes are the documented
// zudo-react/1 skip-SSR contract (zfb docs: hydration.mdx "Mount from a host you own").
export function mountOwned<P extends Record<string, unknown>>(
  component: Component<P>,
  props: P,
  options: { parent?: Element; build?: string; signal?: AbortSignal } = {},
): OwnedRoot {
  const identity = { component: component.name, build: options.build ?? "composer-proof" };
  const host = document.createElement("div");
  host.setAttribute("data-zfb-island-skip-ssr", identity.component);
  host.setAttribute("data-zfb-transport", "json/1");
  host.setAttribute("data-zfb-protocol", "zudo-react/1");
  host.setAttribute("data-zfb-build", identity.build);
  (options.parent ?? document.body).append(host);
  const diagnostics: Diagnostic[] = [];
  const handle = mount(h(component, props), host, {
    identity,
    signal: options.signal,
    report: (diagnostic) => diagnostics.push(diagnostic),
  });
  return {
    host,
    handle,
    diagnostics,
    stop() {
      handle?.unmount();
      host.remove();
    },
  };
}
