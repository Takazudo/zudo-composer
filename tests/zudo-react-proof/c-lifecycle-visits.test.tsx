import { afterEach, expect, it } from "vitest";
import { computed, flush, For, getScope, signal } from "@takazudo/zfb/zudo-react";
import { mountOwned, type OwnedRoot } from "../../src/runtime/root";

const roots: OwnedRoot[] = [];
afterEach(() => { for (const root of roots.splice(0)) root.stop(); });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

it("(c) route visits mount, update, unmount and cancel late work exactly once per visit", async () => {
  const events: string[] = [];
  const loads = new Map<number, ReturnType<typeof deferred<string>>>();
  const route = signal<{ path: string; visit: number }>({ path: "/content", visit: 1 });
  const visits = computed(() => [route.value]);

  function RoutePage(props: { path: string; visit: number }) {
    const scope = getScope();
    const body = signal("loading");
    events.push(`setup ${props.visit}`);
    scope.onCleanup(() => events.push(`cleanup ${props.visit}`));
    scope.onActivate(() => {
      events.push(`activate ${props.visit}`);
      const load = deferred<string>();
      loads.set(props.visit, load);
      void load.promise.then((text) => {
        if (scope.abortSignal.aborted) { events.push(`ignored ${props.visit}`); return; }
        body.value = text;
      });
    });
    return <main data-visit={props.visit}>{body}</main>;
  }

  function Router() {
    return (
      <div>
        <For each={visits} by={(item) => `${item.path}#${item.visit}`}>
          {(item) => <RoutePage path={item.value.path} visit={item.value.visit} />}
        </For>
      </div>
    );
  }

  const root = mountOwned(Router, {});
  roots.push(root);
  expect(root.handle).not.toBeNull();
  loads.get(1)!.resolve("content page");
  await new Promise((r) => setTimeout(r));
  await flush();
  expect(root.host.querySelector("main")!.textContent).toBe("content page");

  // Leave before visit 2's load resolves, then revisit the same path.
  route.value = { path: "/mapping", visit: 2 };
  await flush();
  route.value = { path: "/content", visit: 3 };
  await flush();
  loads.get(2)!.resolve("stale mapping");
  loads.get(3)!.resolve("fresh content");
  await new Promise((r) => setTimeout(r));
  await flush();
  expect(root.host.querySelectorAll("main")).toHaveLength(1);
  expect(root.host.querySelector("main")!.textContent).toBe("fresh content");
  expect(events).toEqual([
    "setup 1", "activate 1",
    "setup 2", "cleanup 1", "activate 2",
    "setup 3", "cleanup 2", "activate 3",
    "ignored 2",
  ]);

  root.stop();
  roots.length = 0;
  expect(events.filter((e) => e === "cleanup 3")).toHaveLength(1);
});

it("(c) a pending root mount is cancelled through RootOptions.signal and a disposed root can be remounted", () => {
  function Panel() { return <p>panel</p>; }
  const controller = new AbortController();
  controller.abort();
  const cancelled = mountOwned(Panel, {}, { signal: controller.signal });
  roots.push(cancelled);
  expect(cancelled.handle).toBeNull();
  expect(cancelled.diagnostics.map((d) => d.code)).toContain("ZR_CANCELLED");
  expect(cancelled.host.childNodes).toHaveLength(0);

  const first = mountOwned(Panel, {});
  roots.push(first);
  first.handle!.dispose();
  expect(first.handle!.disposed).toBe(true);
  expect(first.host.textContent).toBe("panel");
  first.handle!.unmount();
  expect(first.host.textContent).toBe("");
});
