import { afterEach, expect, it } from "vitest";
import { computed, flush, For, signal, type Child, type Component, type ReadonlySignal } from "@takazudo/zfb/zudo-react";
import { mountOwned, type OwnedRoot } from "../../src/runtime/root";

const roots: OwnedRoot[] = [];
afterEach(() => { for (const root of roots.splice(0)) root.stop(); });

const setups: string[] = [];

function Heading(props: { text: ReadonlySignal<string> }) {
  setups.push("Heading");
  return <h2>{props.text}</h2>;
}
function Paragraph(props: { text: ReadonlySignal<string> }) {
  setups.push("Paragraph");
  return <p>{props.text}</p>;
}
// Named slots are inert descriptions (or factories) passed as ordinary props.
function Card(props: { header: Child; children?: Child; tone: ReadonlySignal<string> }) {
  setups.push("Card");
  return (
    <article class={props.tone}>
      <header>{props.header}</header>
      <div class="body">{props.children}</div>
    </article>
  );
}

const registry: Record<string, Component<{ text: ReadonlySignal<string> }>> = { heading: Heading, paragraph: Paragraph };

it("(d) dynamic props update in place; a component-valued signal swaps the component; nested slots render", async () => {
  const kind = signal<keyof typeof registry>("heading");
  const text = signal("Hello");
  const tone = signal("tone-a");
  // Component replacement = one-item For keyed by the component id. The item
  // carries the component value itself (signals may hold any value).
  const selected = computed(() => [{ id: kind.value, render: registry[kind.value]! }]);

  function Host() {
    return (
      <Card tone={tone} header={<Card tone={tone} header={<span>inner</span>}>nested body</Card>}>
        <For each={selected} by={(item) => item.id}>
          {(item) => {
            const Selected = item.value.render;
            return <Selected text={text} />;
          }}
        </For>
      </Card>
    );
  }
  setups.length = 0;
  const root = mountOwned(Host, {});
  roots.push(root);
  expect(root.handle).not.toBeNull();
  expect(root.host.querySelector("header header span")!.textContent).toBe("inner");
  const h2 = root.host.querySelector("h2")!;
  const outer = root.host.querySelector("article")!;

  text.value = "World";
  tone.value = "tone-b";
  await flush();
  expect(root.host.querySelector("h2")).toBe(h2);
  expect(h2.textContent).toBe("World");
  expect(outer.className).toBe("tone-b");
  expect(root.host.querySelector("article article")!.className).toBe("tone-b");

  kind.value = "paragraph";
  await flush();
  expect(root.host.querySelector("h2")).toBeNull();
  expect(root.host.querySelector("p")!.textContent).toBe("World");
  expect(root.host.querySelector("article")).toBe(outer);
  expect(setups).toEqual(["Card", "Card", "Heading", "Paragraph"]);
});

it("(d) keyed reordering moves existing nodes and keeps focus and text selection", async () => {
  const items = signal<readonly { id: string; label: string }[]>([
    { id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" },
  ]);
  const itemSetups: string[] = [];
  function List() {
    return (
      <ol>
        <For each={items} by={(item) => item.id}>
          {(item) => {
            itemSetups.push(item.value.id);
            const label = computed(() => item.value.label);
            return <li data-id={item.value.id}><input aria-label={label} defaultValue={item.value.id} /></li>;
          }}
        </For>
      </ol>
    );
  }
  const root = mountOwned(List, {});
  roots.push(root);
  const before = new Map([...root.host.querySelectorAll("li")].map((li) => [li.dataset.id!, li]));
  const inputB = before.get("b")!.querySelector("input")!;
  inputB.value = "edited b";
  inputB.focus();
  inputB.setSelectionRange(2, 6);

  items.value = [{ id: "c", label: "C" }, { id: "a", label: "A2" }, { id: "b", label: "B" }];
  await flush();
  const after = [...root.host.querySelectorAll("li")];
  expect(after.map((li) => li.dataset.id)).toEqual(["c", "a", "b"]);
  for (const li of after) expect(li).toBe(before.get(li.dataset.id!));
  expect(document.activeElement).toBe(inputB);
  expect([inputB.selectionStart, inputB.selectionEnd]).toEqual([2, 6]);
  expect(inputB.value).toBe("edited b");
  expect(before.get("a")!.querySelector("input")!.getAttribute("aria-label")).toBe("A2");
  expect(itemSetups).toEqual(["a", "b", "c"]);
});
