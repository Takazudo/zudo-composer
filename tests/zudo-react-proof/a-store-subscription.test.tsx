import { afterEach, expect, it } from "vitest";
import { computed, getScope, type ReadonlySignal } from "@takazudo/zfb/zudo-react";
import { createIslandTest, type IslandTest } from "@takazudo/zfb/zudo-react/testing";
import { createCounterStore, storeSignal } from "./support/store-signal";

const active: IslandTest[] = [];
afterEach(() => { for (const test of active.splice(0)) test.dispose(); });

it("(a) controller snapshot subscription drives signal bindings and unsubscribes on unmount", async () => {
  const store = createCounterStore(1);
  let setups = 0;
  function CounterView() {
    setups++;
    const snapshot = storeSignal(getScope(), store);
    const label: ReadonlySignal<string> = computed(() => `count ${snapshot.value.count}`);
    return <output>{label}</output>;
  }

  const test = createIslandTest(CounterView, {}, { document });
  active.push(test);
  const output = test.host.querySelector("output")!;
  expect(output.textContent).toBe("count 1");
  // A change after SSR but before activation is picked up at activation.
  store.increment();
  const handle = test.hydrate();
  expect(test.diagnostics).toEqual([]);
  expect(handle).not.toBeNull();
  expect(store.listeners.size).toBe(1);
  await test.flush();
  expect(test.host.querySelector("output")).toBe(output);
  expect(output.textContent).toBe("count 2");

  store.increment();
  store.increment();
  await test.flush();
  expect(output.textContent).toBe("count 4");
  // Server setup + client setup; updates never re-run the component.
  expect(setups).toBe(2);

  test.dispose();
  expect(store.listeners.size).toBe(0);
  store.increment();
  await test.flush();
  expect(output.textContent).toBe("count 4");
});
