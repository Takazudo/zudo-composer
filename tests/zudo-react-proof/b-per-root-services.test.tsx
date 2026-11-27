import { afterEach, expect, it } from "vitest";
import { computed, For, Show, signal, type ReadonlySignal, type Signal } from "@takazudo/zfb/zudo-react";
import { mountOwned, type OwnedRoot } from "../../src/runtime/root";

// Context replacement: one typed services object created per root and threaded
// as an explicit prop. Nothing is ambient, so nothing can leak between roots.
interface WorkspaceServices {
  readonly workspaceId: string;
  readonly theme: ReadonlySignal<"light" | "dark">;
  readonly log: string[];
}

function createServices(workspaceId: string, theme: ReadonlySignal<"light" | "dark">): WorkspaceServices {
  return { workspaceId, theme, log: [] };
}

function Leaf(props: { services: WorkspaceServices; name: string }) {
  props.services.log.push(`setup ${props.name}`);
  const text = computed(() => `${props.services.workspaceId}:${props.name}:${props.services.theme.value}`);
  return <li data-leaf={props.name}>{text}</li>;
}

function Shell(props: { services: WorkspaceServices; open: ReadonlySignal<boolean>; items: ReadonlySignal<readonly string[]> }) {
  const { services } = props;
  return (
    <section data-workspace={services.workspaceId}>
      <Show when={props.open}>
        {() => (
          <ul>
            <For each={props.items} by={(name) => name}>
              {(name) => <Leaf services={services} name={name.value} />}
            </For>
          </ul>
        )}
      </Show>
    </section>
  );
}

const roots: OwnedRoot[] = [];
afterEach(() => { for (const root of roots.splice(0)) root.stop(); });

it("(b) per-root services reach late-created descendants without leaking across roots", async () => {
  const themeA: Signal<"light" | "dark"> = signal("light");
  const themeB: Signal<"light" | "dark"> = signal("dark");
  const servicesA = createServices("A", themeA);
  const servicesB = createServices("B", themeB);
  const open = signal(false);
  const itemsA = signal<readonly string[]>(["x"]);
  const itemsB = signal<readonly string[]>(["y", "z"]);

  roots.push(mountOwned(Shell, { services: servicesA, open, items: itemsA }));
  roots.push(mountOwned(Shell, { services: servicesB, open, items: itemsB }));
  expect(roots.every((root) => root.handle !== null)).toBe(true);

  // Descendants are created after setup returned (Show branch + For items).
  open.value = true;
  await Promise.resolve();
  const { flush } = await import("@takazudo/zfb/zudo-react");
  await flush();
  const [a, b] = roots.map((root) => [...root.host.querySelectorAll("li")].map((li) => li.textContent));
  expect(a).toEqual(["A:x:light"]);
  expect(b).toEqual(["B:y:dark", "B:z:dark"]);

  itemsA.value = ["x", "w"];
  themeB.value = "light";
  await flush();
  expect([...roots[0]!.host.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["A:x:light", "A:w:light"]);
  expect([...roots[1]!.host.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["B:y:light", "B:z:light"]);
  expect(servicesA.log).toEqual(["setup x", "setup w"]);
  expect(servicesB.log).toEqual(["setup y", "setup z"]);
});
