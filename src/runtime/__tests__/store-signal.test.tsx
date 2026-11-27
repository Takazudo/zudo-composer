import { describe, expect, it } from "vitest";
import { computed, getScope } from "@takazudo/zfb/zudo-react";
import { createIslandTest } from "@takazudo/zfb/zudo-react/testing";
import { render, settle } from "../../test/render";
import { storeSignal, type ExternalStore } from "../store-signal";

function counterStore(initial = 0) {
  const server = { count: initial };
  let snapshot = server;
  const listeners = new Set<() => void>();
  const store = {
    listeners,
    getSnapshot: () => snapshot,
    getServerSnapshot: () => server,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    increment() {
      snapshot = { count: snapshot.count + 1 };
      for (const listener of [...listeners]) listener();
    },
  } satisfies ExternalStore<{ count: number }> & Record<string, unknown>;
  return store;
}

describe("storeSignal", () => {
  it("subscribes on activation, catches a change made before it, and unsubscribes with the scope", async () => {
    const store = counterStore(1);
    let setups = 0;
    function Counter() {
      setups++;
      const snapshot = storeSignal(getScope(), store);
      return <output>{computed(() => `count ${snapshot.value.count}`)}</output>;
    }
    const view = render(<Counter />);
    const output = view.container.querySelector("output")!;
    expect(store.listeners.size).toBe(1);
    expect(output.textContent).toBe("count 1");
    store.increment();
    store.increment();
    await settle();
    expect(output.textContent).toBe("count 3");
    expect(setups).toBe(1);
    view.unmount();
    expect(store.listeners.size).toBe(0);
  });

  it("hydrates from the server snapshot, then resyncs to the live one", async () => {
    const store = counterStore(5);
    function Counter() {
      const snapshot = storeSignal(getScope(), store);
      return <output>{computed(() => String(snapshot.value.count))}</output>;
    }
    const island = createIslandTest(Counter, {}, { document });
    try {
      store.increment();
      expect(island.hydrate()).not.toBeNull();
      expect(island.diagnostics).toEqual([]);
      await island.flush();
      expect(island.host.querySelector("output")!.textContent).toBe("6");
    } finally {
      island.dispose();
    }
    expect(store.listeners.size).toBe(0);
  });

  it("reads getSnapshot with the store as receiver when there is no server snapshot", () => {
    const store = {
      value: "live",
      getSnapshot(this: { value: string }) { return this.value; },
      subscribe: () => () => {},
    };
    function Reader() {
      return <p>{storeSignal(getScope(), store)}</p>;
    }
    expect(render(<Reader />).container.textContent).toBe("live");
  });
});
