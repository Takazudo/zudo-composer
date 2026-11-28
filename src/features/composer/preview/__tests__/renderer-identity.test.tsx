import { h, signal, type Child } from "@takazudo/zfb/zudo-react";
import { defineComponentPack } from "@zudo-composer/component-contract";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, settle } from "../../../../test/render";
import { createComposerComponentProvider } from "../../component-provider";
import { COMPOSITION_SCHEMA_VERSION, type CompositionDocument, type CompositionNode } from "../../headless-api";
import type { PreviewSession } from "../protocol";
import { CompositionCanvas } from "../renderer";

const setups: string[] = [];
let failing = false;

function Box(props: { title?: string; children?: Child }): Child {
  setups.push(`box:${props.title}`);
  return h("section", { class: "test-box" }, h("h2", null, props.title ?? ""), props.children as Child);
}
function Label(props: { children?: string }): Child {
  setups.push(`label:${props.children}`);
  return h("p", { class: "test-label" }, props.children ?? "");
}
function Raw(props: Record<string, unknown>): Child {
  return h("div", { ...props, class: "test-raw" });
}
function Fragile(): Child {
  setups.push("fragile");
  if (failing) throw new Error("fragile exploded");
  return h("p", { class: "test-fragile" }, "fragile ok");
}
function Source(props: { children?: string }): Child {
  return h("div", { class: "test-source" }, props.children ?? "");
}

const source = (exportName: string) => ({ module: "@test/identity", exportKind: "named" as const, exportName });
const provider = createComposerComponentProvider(defineComponentPack({
  packId: "@test/identity",
  packVersion: "1.0.0",
  components: [
    {
      id: "test.box", schemaVersion: 1, title: "Box", category: "Layout", description: "Container.",
      source: source("Box"), defaults: { title: "Box" },
      fields: [{ prop: "title", label: "Title", schema: { type: "string" }, editor: { kind: "text" } }],
      slots: [{ id: "content", prop: "children", label: "Content", cardinality: "many" }],
      component: Box,
    },
    {
      id: "test.label", schemaVersion: 1, title: "Label", category: "Content", description: "Text.",
      source: source("Label"), defaults: { children: "Label" },
      fields: [{ prop: "children", label: "Text", schema: { type: "string" }, editor: { kind: "text", multiline: false, mode: "plain" }, inlineEdit: true }],
      slots: [], component: Label,
      adapters: { inlineEditor: { field: "children", resolveElement: (root: unknown) => root as Element | null } },
    },
    {
      id: "test.raw", schemaVersion: 1, title: "Raw", category: "Content", description: "Spreads props.",
      source: source("Raw"), defaults: {},
      fields: [
        { prop: "title", label: "Title", schema: { type: "string" }, editor: { kind: "text" } },
        { prop: "rawHtml", label: "Raw", schema: { type: "string" }, editor: { kind: "text" } },
        { prop: "on:click", label: "Listener", schema: { type: "string" }, editor: { kind: "text" } },
      ],
      slots: [], component: Raw,
    },
    {
      id: "test.fragile", schemaVersion: 1, title: "Fragile", category: "Content", description: "Throws on demand.",
      source: source("Fragile"), defaults: {}, fields: [], slots: [], component: Fragile,
    },
    {
      id: "test.source", schemaVersion: 1, title: "Source", category: "Content", description: "Markdown source.",
      source: source("Source"), defaults: { children: "# Hi" },
      fields: [{ prop: "children", label: "Markdown", schema: { type: "string" }, editor: { kind: "text", multiline: true, mode: "markdown-source" }, inlineEdit: true }],
      slots: [], component: Source,
      adapters: { inlineEditor: { field: "children", resolveElement: (root: unknown) => root as Element | null } },
    },
  ],
}));

const node = (id: string, componentId: string, props: Record<string, unknown>, slots: Record<string, CompositionNode[]> = {}): CompositionNode =>
  ({ id, componentId, componentVersion: 1, props: props as CompositionNode["props"], slots });

function doc(title: string, first: string, second = "Second"): CompositionDocument {
  return {
    schemaVersion: COMPOSITION_SCHEMA_VERSION,
    id: "identity",
    name: "Identity",
    root: [node("box", "test.box", { title }, { content: [node("one", "test.label", { children: first }), node("two", "test.label", { children: second })] })],
  };
}

function mount(initial: CompositionDocument, initialSession: PreviewSession, extra: Partial<Parameters<typeof CompositionCanvas>[0]> = {}) {
  const document = signal(initial);
  const session = signal(initialSession);
  const revision = signal(1);
  const callbacks = { onSelect: vi.fn(), onRequestAdd: vi.fn(), onRequestNodeMenu: vi.fn(), onRequestInsertMenu: vi.fn(), onCommitInlineEdit: vi.fn(), onNodeError: vi.fn() };
  const view = render(h(CompositionCanvas, { document, localRecordId: "identity", provider, session, revision, ...callbacks, ...extra }));
  return { view, document, session, revision, ...callbacks };
}

const preview: PreviewSession = { mode: "preview", theme: "light", selectedId: null };
const edit: PreviewSession = { mode: "edit", theme: "light", selectedId: null };

describe("CompositionCanvas keyed node identity", () => {
  it("keeps every component node through selection and Edit ⇄ Preview, touching only the chrome", async () => {
    const { view, session, onSelect } = mount(doc("Title", "First"), preview);
    const box = view.container.querySelector(".test-box")!;
    const first = view.container.querySelectorAll(".test-label")[0]!;
    expect(view.container.querySelector(".zc-chrome")).toBeNull();

    session.value = edit;
    await settle();
    expect(view.container.querySelector(".test-box")).toBe(box);
    expect(view.container.querySelectorAll(".test-label")[0]).toBe(first);
    expect(view.container.querySelectorAll(".zc-chrome").length).toBe(3);
    expect(screen.getAllByRole("button", { name: /Add component to/ }).length).toBeGreaterThan(0);

    fireEvent.click(first);
    expect(onSelect).toHaveBeenCalledWith("one");
    session.value = { ...edit, selectedId: "one" };
    await settle();
    expect(view.container.querySelector("[data-zc-node-id='one']")).toHaveAttribute("data-zc-selected", "");
    expect(screen.getByRole("button", { name: "Open menu for Label" })).toHaveAttribute("data-zc-focus-token", "node-menu:one");
    expect(view.container.querySelectorAll(".test-label")[0]).toBe(first);

    session.value = preview;
    await settle();
    expect(view.container.querySelector(".zc-chrome")).toBeNull();
    expect(view.container.querySelector(".test-box")).toBe(box);
    expect(view.container.querySelectorAll(".test-label")[0]).toBe(first);
  });

  it("remounts only the node whose props changed; its container and siblings keep their DOM", async () => {
    const { view, document } = mount(doc("Title", "First"), preview);
    const box = view.container.querySelector(".test-box")!;
    const [first, second] = [...view.container.querySelectorAll(".test-label")];
    setups.length = 0;

    document.value = doc("Title", "First edited");
    await settle();
    const [nextFirst, nextSecond] = [...view.container.querySelectorAll(".test-label")];
    expect(view.container.querySelector(".test-box")).toBe(box);
    expect(nextFirst).not.toBe(first);
    expect(nextFirst).toHaveTextContent("First edited");
    expect(nextSecond).toBe(second);
    expect(setups).toEqual(["label:First edited"]);

    document.value = doc("Retitled", "First edited");
    await settle();
    expect(view.container.querySelector(".test-box")).not.toBe(box);
    expect(view.container.querySelector("h2")).toHaveTextContent("Retitled");
  });

  it("commits a plain inline edit with the session-start revision and remounts the body afterwards", async () => {
    const { view, revision, onCommitInlineEdit } = mount(doc("Title", "First"), { ...edit, selectedId: "one" });
    const label = view.container.querySelector<HTMLElement>("[data-zc-node-id='one'] .test-label")!;
    fireEvent.dblClick(label);
    await settle();
    const editing = view.container.querySelector<HTMLElement>("[data-zc-node-id='one'] [data-zc-inline-editing]")!;
    expect(editing).not.toBeNull();
    expect(editing).not.toBe(label);
    expect(editing.getAttribute("contenteditable")).toBe("plaintext-only");
    expect(editing.textContent).toBe("First");
    revision.value = 7;
    editing.textContent = "Typed";
    fireEvent.keyDown(editing, { key: "Enter" });
    await settle();
    expect(onCommitInlineEdit).toHaveBeenCalledWith("one", "children", "Typed", 1);
    expect(view.container.querySelector("[data-zc-inline-editing]")).toBeNull();
    expect(view.container.querySelectorAll("[data-zc-node-id='one'] .test-label")).toHaveLength(1);
  });

  it("keeps the explicit-save prose session parallel: its own editable, Done discards a clean draft", async () => {
    const document = doc("Title", "First");
    document.root[0]!.slots.content!.push(node("md", "test.source", { children: "# Hi" }));
    const { view, onCommitInlineEdit } = mount(document, { ...edit, selectedId: "md" });
    fireEvent.dblClick(view.container.querySelector("[data-zc-node-id='md'] .test-source")!);
    await settle();
    const editor = view.container.querySelector<HTMLElement>("[data-zc-node-id='md'] [data-zc-prose-editing]")!;
    expect(editor).toHaveAttribute("role", "textbox");
    expect(editor.textContent).toBe("# Hi");
    expect(view.container.querySelector(".test-source")).toBeNull();
    const done = screen.getByRole("button", { name: "Done" });
    editor.textContent = "# Changed";
    fireEvent.input(editor);
    await settle();
    expect(done).toHaveTextContent("Save");
    expect(screen.getByRole("status")).toHaveTextContent("Unsaved changes");
    fireEvent.click(done);
    await settle();
    expect(onCommitInlineEdit).toHaveBeenCalledWith("md", "children", "# Changed", 1);
    expect(view.container.querySelector("[data-zc-prose-editing]")).toBeNull();
    expect(view.container.querySelector(".test-source")).not.toBeNull();
  });

  it("isolates a throwing node; Retry and a new document recreate only that subtree", async () => {
    failing = true;
    const initial = doc("Title", "First");
    initial.root[0]!.slots.content!.push(node("frag", "test.fragile", {}));
    const { view, document, onNodeError } = mount(initial, preview);
    try {
      expect(view.container.querySelector(".zc-node-error")).toHaveTextContent("fragile exploded");
      expect(onNodeError).toHaveBeenCalledWith("frag", "fragile exploded");
      const first = view.container.querySelector(".test-label")!;
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      await settle();
      expect(onNodeError).toHaveBeenCalledTimes(2);
      expect(view.container.querySelector(".test-label")).toBe(first);

      failing = false;
      document.value = { ...initial, name: "Same nodes, new document" };
      await settle();
      expect(view.container.querySelector(".zc-node-error")).toBeNull();
      expect(view.container.querySelector(".test-fragile")).toHaveTextContent("fragile ok");
      expect(view.container.querySelector(".test-label")).toBe(first);
    } finally {
      failing = false;
    }
  });

  it("never lets a declared document prop reach zudo-react's raw HTML sink", () => {
    const document = doc("Title", "First");
    document.root.push(node("raw", "test.raw", { rawHtml: "<img src=x onerror=alert(1)>", title: "kept" }));
    const { view } = mount(document, preview);
    const raw = view.container.querySelector(".test-raw")!;
    expect(raw.innerHTML).toBe("");
    expect(raw.getAttribute("title")).toBe("kept");
  });

  it("never lets a declared document prop bind a zudo-react `on:*` listener", () => {
    const document = doc("Title", "First");
    document.root.push(node("listener", "test.raw", { "on:click": "alert(1)", title: "kept" }));
    const { view } = mount(document, preview);
    const raw = view.container.querySelector(".test-raw") as HTMLElement;
    expect(raw).not.toBeNull();
    expect(raw.getAttribute("title")).toBe("kept");
    expect(raw.getAttribute("on:click")).toBeNull();
    expect(raw.onclick).toBeNull();
    expect(() => raw.click()).not.toThrow();
  });
});
