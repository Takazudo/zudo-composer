import "./cleanup";
import { signal } from "@takazudo/zfb/zudo-react";
import { fireEvent, render, screen, settle } from "../../../test/render";
import { describe, expect, it, vi } from "vitest";
import { OutlineTree } from "../index";
import type { OutlineInsertSession, OutlineNode } from "../types";

const leaf = (id: string): OutlineNode => ({ id, title: id, kind: "leaf" });

describe("workspace tree transactions", () => {
  it("rests after a visible inline insert while persistence is still pending or later fails", async () => {
    let rejectSave!: (error: Error) => void;
    const save = new Promise<void>((_resolve, reject) => { rejectSave = reject; });
    function Host() {
      const nodes = signal<OutlineNode[]>([leaf("First")]);
      const status = signal("idle");
      return <>
        <output aria-label="Persistence">{status}</output>
        <OutlineTree nodes={nodes} onAdd={({ title, index }) => {
          const before = nodes.value;
          nodes.value = [...before.slice(0, index), leaf(title), ...before.slice(index)];
          status.value = "pending";
          void save.then(() => { status.value = "saved"; }, () => { status.value = "failed"; });
        }} />
      </>;
    }
    const { container } = render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Insert before First" }));
    await settle();
    expect(container.querySelector(".cms-tree-insert.is-active")).not.toBeNull();
    const input = screen.getByRole("textbox");
    fireEvent.input(input, { target: { value: "Inserted" } });
    await settle();
    fireEvent.keyDown(input, { key: "Enter" });
    await settle();

    expect(screen.getByRole("treeitem", { name: "Inserted" })).toHaveFocus();
    expect(screen.getByLabelText("Persistence")).toHaveTextContent("pending");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(container.querySelector(".is-active")).toBeNull();

    rejectSave(new Error("Disk unavailable")); await save.catch(() => undefined);
    await settle();
    expect(screen.getByLabelText("Persistence")).toHaveTextContent("failed");
    expect(screen.getByRole("treeitem", { name: "Inserted" })).toBeInTheDocument();
    expect(container.querySelector(".is-active")).toBeNull();
  });

  it.each([
    ["root", "Escape"], ["root", "Cancel"], ["child", "Escape"], ["child", "Cancel"],
  ])("restores the remounted terminal %s control after %s", async (kind, action) => {
    const nodes: OutlineNode[] = kind === "root" ? [] : [{ id: "slot", title: "body", kind: "group" }];
    render(<OutlineTree nodes={nodes} onAdd={vi.fn()} />);
    const label = kind === "root" ? "Add root item" : "Add item";
    const origin = screen.getByRole("button", { name: label });
    fireEvent.click(origin);
    await settle();
    expect(origin.isConnected).toBe(false);
    if (action === "Escape") fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    else fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await settle();
    expect(screen.getByRole("button", { name: label })).toHaveFocus();
  });

  it("falls back to the tree when a terminal child origin disappears", async () => {
    const nodes = signal<OutlineNode[]>([{ id: "slot", title: "body", kind: "group" }]);
    const { container } = render(<OutlineTree nodes={nodes} onAdd={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    await settle();
    nodes.value = [];
    await settle();
    expect(container.querySelector(".cms-tree")).toHaveFocus();
  });

  it("keeps a chooser anchored to the sibling through reorder and restores its insertion button", async () => {
    let session!: OutlineInsertSession;
    const request = (_target: unknown, next: OutlineInsertSession) => { session = next; };
    const nodes = signal<OutlineNode[]>([leaf("A"), leaf("B")]);
    const { container } = render(<OutlineTree nodes={nodes} onRequestInsert={request} />);
    const origin = screen.getByRole("button", { name: "Insert before B" });
    fireEvent.click(origin);
    await settle();
    nodes.value = [leaf("B"), leaf("A")];
    await settle();
    expect(session.resolveTarget()).toEqual({ parentId: null, index: 0 });
    expect(container.querySelector(".is-active button")).toHaveAccessibleName("Insert before B");
    session.cancel();
    await settle();
    expect(origin).toHaveFocus();
    expect(container.querySelector(".is-active")).toBeNull();
  });

  it("invalidates removed anchors without stealing chooser draft focus; cancellation has a connected fallback", async () => {
    let session!: OutlineInsertSession;
    const request = (_target: unknown, next: OutlineInsertSession) => { session = next; };
    const nodes = signal<OutlineNode[]>([leaf("A")]);
    const { container } = render(<><input aria-label="Chooser draft" /><OutlineTree nodes={nodes} onRequestInsert={request} /></>);
    fireEvent.click(screen.getByRole("button", { name: "Insert before A" }));
    await settle();
    screen.getByRole("textbox").focus();
    await settle();
    nodes.value = [];
    await settle();
    expect(session.resolveTarget()).toBeNull();
    expect(screen.getByRole("textbox")).toHaveFocus();
    nodes.value = [leaf("A")];
    await settle();
    expect(session.resolveTarget()).toBeNull();
    session.cancel();
    await settle();
    expect(container.querySelector(".cms-tree")).toHaveFocus();
  });

  it("rejects locked or removed named slot targets and ignores old chooser completion", async () => {
    const sessions: OutlineInsertSession[] = [];
    const request = (_target: unknown, next: OutlineInsertSession) => { sessions.push(next); };
    const initial: OutlineNode[] = [{ id: "slot", title: "body", kind: "group", variant: "slot", children: [leaf("A")] }];
    const nodes = signal<OutlineNode[]>(initial);
    // A gate is fixed for the tree's lifetime; this one reads a flag the test flips.
    let locked = false;
    const { container } = render(<OutlineTree nodes={nodes} onRequestInsert={request} canInsert={() => !locked} />);
    fireEvent.click(screen.getByRole("button", { name: "Insert before A" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Insert before body" }));
    await settle();
    sessions[0].complete("A");
    await settle();
    expect(container.querySelector(".is-active button")).toHaveAccessibleName("Insert before body");
    locked = true;
    nodes.value = [...initial];
    await settle();
    expect(sessions[1].resolveTarget()).toBeNull();
    locked = false;
    nodes.value = [];
    await settle();
    expect(sessions[0].resolveTarget()).toBeNull();
  });

  it("focuses a newly inserted root from an empty tree", async () => {
    function Host() {
      const nodes = signal<OutlineNode[]>([]);
      return <OutlineTree nodes={nodes} onAdd={({ title }) => { nodes.value = [leaf(title)]; return title; }} />;
    }
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Add root item" }));
    await settle();
    const input = screen.getByRole("textbox");
    fireEvent.input(input, { target: { value: "First" } });
    await settle();
    fireEvent.keyDown(input, { key: "Enter" });
    await settle();
    expect(screen.getByRole("treeitem", { name: "First" })).toHaveFocus();
  });

  it("invalidates an empty named slot if the parent is removed or becomes a leaf", async () => {
    let session!: OutlineInsertSession;
    const request = (_target: unknown, next: OutlineInsertSession) => { session = next; };
    const nodes = signal<OutlineNode[]>([{ id: "slot", title: "body", kind: "group", variant: "slot" }]);
    render(<OutlineTree nodes={nodes} onRequestInsert={request} />);
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    await settle();
    expect(session.resolveTarget()).toEqual({ parentId: "slot", index: 0 });
    nodes.value = [leaf("slot")];
    await settle();
    expect(session.resolveTarget()).toBeNull();
    expect(screen.queryByRole("button", { name: "Add item" })).toBeNull();
  });

  it("focuses the single inserted child for synchronous void handlers", async () => {
    function Host() {
      const slot = (children: OutlineNode[]): OutlineNode[] => [{ id: "slot", kind: "group", title: "body", variant: "slot", children }];
      const nodes = signal<OutlineNode[]>(slot([]));
      return <OutlineTree nodes={nodes}
        onAdd={({ title }) => { nodes.value = slot([leaf(title)]); }} />;
    }
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    await settle();
    const input = screen.getByRole("textbox");
    fireEvent.input(input, { target: { value: "Child" } });
    await settle();
    fireEvent.keyDown(input, { key: "Enter" });
    await settle();
    expect(screen.getByRole("treeitem", { name: "Child" })).toHaveFocus();
  });

  it("invalidates chooser callbacks when the tree unmounts", async () => {
    let session!: OutlineInsertSession;
    const { unmount } = render(<OutlineTree nodes={[]} onRequestInsert={(_target, next) => { session = next; }} />);
    fireEvent.click(screen.getByRole("button", { name: "Add root item" }));
    await settle();
    unmount();
    expect(session.resolveTarget()).toBeNull();
    expect(() => session.cancel()).not.toThrow();
  });

  it("resolves terminal chooser points at the current list end and focuses the inserted row", async () => {
    let session!: OutlineInsertSession;
    const request = (_target: unknown, next: OutlineInsertSession) => { session = next; };
    const nodes = signal<OutlineNode[]>([leaf("A")]);
    render(<OutlineTree nodes={nodes} onRequestInsert={request} />);
    fireEvent.click(screen.getByRole("button", { name: "Add root item" }));
    await settle();
    nodes.value = [leaf("A"), leaf("B")];
    await settle();
    expect(session.resolveTarget()).toEqual({ parentId: null, index: 2 });
    session.complete("B");
    await settle();
    expect(screen.getByRole("treeitem", { name: "B" })).toHaveFocus();
  });

  it("does not submit or dismiss inline insertion during IME composition", async () => {
    const add = vi.fn();
    render(<OutlineTree nodes={[leaf("A")]} onAdd={add} />);
    fireEvent.click(screen.getByRole("button", { name: "Insert before A" }));
    await settle();
    const input = screen.getByRole("textbox");
    fireEvent.input(input, { target: { value: "日本語" } });
    await settle();
    fireEvent(input, new CompositionEvent("compositionstart", { bubbles: true }));
    await settle();
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    await settle();
    fireEvent.keyDown(input, { key: "Escape", keyCode: 229 });
    await settle();
    fireEvent.keyDown(input, { key: "Enter" });
    await settle();
    fireEvent.keyDown(input, { key: "Escape" });
    await settle();
    expect(input).toHaveFocus();
    expect(add).not.toHaveBeenCalled();
    fireEvent(input, new CompositionEvent("compositionend", { bubbles: true }));
    await settle();
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    await settle();
    fireEvent.keyDown(input, { key: "Escape", keyCode: 229 });
    await settle();
    expect(add).not.toHaveBeenCalled();
    const remove = vi.spyOn(input, "removeEventListener");
    fireEvent.keyDown(input, { key: "Enter" });
    await settle();
    expect(add).toHaveBeenCalledWith({ parentId: null, index: 0, title: "日本語" });
    expect(remove).toHaveBeenCalledWith("compositionstart", expect.any(Function));
    expect(remove).toHaveBeenCalledWith("compositionend", expect.any(Function));
  });

  it("renames with F2, preserves descendants and consumes Escape before outer surfaces", async () => {
    const rename = vi.fn();
    const outer = vi.fn();
    render(<div on:keydown={outer}><OutlineTree nodes={[{ id: "group", title: "Group", kind: "group", children: [leaf("A")] }]} onRename={rename} /></div>);
    const row = screen.getByRole("treeitem", { name: "Group" });
    fireEvent.keyDown(row, { key: "F2" });
    await settle();
    const input = screen.getByRole("textbox", { name: "Rename Group" });
    expect(input).toHaveFocus();
    expect(screen.getByRole("treeitem", { name: "A" })).toBeInTheDocument();
    fireEvent.input(input, { target: { value: "新しい" } });
    await settle();
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    await settle();
    expect(rename).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    await settle();
    expect(rename).toHaveBeenCalledWith("group", "新しい");
    expect(row).toHaveFocus();
    fireEvent.keyDown(row, { key: "F2" });
    await settle();
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    await settle();
    expect(row).toHaveFocus();
    expect(outer).not.toHaveBeenCalled();
  });
});
