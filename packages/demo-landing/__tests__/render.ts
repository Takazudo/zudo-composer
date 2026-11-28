// Mounts zudo-react descriptions for this host's DOM tests: a caller-owned
// root under a wrapper carrying the zudo-react/1 skip-SSR contract, with
// @testing-library/dom queries bound to it. Unmounted after each test.
import { flush, h, type Child } from "@takazudo/zfb/zudo-react";
import { mount, type RootHandle } from "@takazudo/zfb/zudo-react/client";
import { within } from "@testing-library/dom";
import { afterEach } from "vitest";

export { fireEvent, screen, within } from "@testing-library/dom";

const IDENTITY = { component: "DemoTestRoot", build: "demo-test" } as const;
const mounted = new Set<{ handle: RootHandle; host: HTMLElement }>();

export function render(child: Child) {
  const host = document.createElement("div");
  host.setAttribute("data-zfb-island-skip-ssr", IDENTITY.component);
  host.setAttribute("data-zfb-transport", "json/1");
  host.setAttribute("data-zfb-protocol", "zudo-react/1");
  host.setAttribute("data-zfb-build", IDENTITY.build);
  document.body.append(host);
  const Root = Object.assign(() => child, { displayName: IDENTITY.component });
  const codes: string[] = [];
  const handle = mount(h(Root, null), host, { identity: IDENTITY, report: (diagnostic) => codes.push(diagnostic.code) });
  if (!handle) {
    host.remove();
    throw new Error(`render: mount refused (${codes.join(", ") || "no diagnostic"})`);
  }
  mounted.add({ handle, host });
  return { container: host, ...within(host) };
}

/** Resolves once zudo-react's DOM and effect queues are quiet (replaces `act`). */
export function settle(): Promise<void> {
  return flush();
}

afterEach(() => {
  for (const { handle, host } of mounted) {
    handle.unmount();
    host.remove();
  }
  mounted.clear();
});
