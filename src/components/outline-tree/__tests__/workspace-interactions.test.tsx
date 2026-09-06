import "./cleanup";
import { act, fireEvent, render, screen } from "@testing-library/preact";
import { useState } from "preact/hooks";
import { describe, expect, it, vi } from "vitest";
import { OutlineTree } from "../index";
import type { OutlineInsertSession, OutlineNode } from "../types";

const leaf = (id: string): OutlineNode => ({ id, title: id, kind: "leaf" });

describe("workspace tree transactions", () => {
  it.each([
    ["root", "Escape"], ["root", "Cancel"], ["child", "Escape"], ["child", "Cancel"],
  ])("restores the remounted terminal %s control after %s", (kind, action) => {
    const nodes: OutlineNode[] = kind === "root" ? [] : [{ id: "slot", title: "body", kind: "group" }];
    render(<OutlineTree nodes={nodes} onAdd={vi.fn()} />);
    const label = kind === "root" ? "Add root item" : "Add item";
    const origin = screen.getByRole("button", { name: label });
    fireEvent.click(origin);
    expect(origin.isConnected).toBe(false);
    if (action === "Escape") fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    else fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: label })).toHaveFocus();
  });

  it("falls back to the tree when a terminal child origin disappears", () => {
    const { rerender, container } = render(<OutlineTree nodes={[{ id: "slot", title: "body", kind: "group" }]} onAdd={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    rerender(<OutlineTree nodes={[]} onAdd={vi.fn()} />);
    expect(container.querySelector(".cms-tree")).toHaveFocus();
  });

  it("keeps a chooser anchored to the sibling through reorder and restores its insertion button", () => {
    let session!: OutlineInsertSession;
    const request = (_target: unknown, next: OutlineInsertSession) => { session = next; };
    const { rerender, container } = render(<OutlineTree nodes={[leaf("A"), leaf("B")]} onRequestInsert={request} />);
    const origin = screen.getByRole("button", { name: "Insert before B" });
    fireEvent.click(origin);
    rerender(<OutlineTree nodes={[leaf("B"), leaf("A")]} onRequestInsert={request} />);
    expect(session.resolveTarget()).toEqual({ parentId: null, index: 0 });
    expect(container.querySelector(".is-active button")).toHaveAccessibleName("Insert before B");
    act(() => session.cancel());
    expect(origin).toHaveFocus();
    expect(container.querySelector(".is-active")).toBeNull();
  });

  it("invalidates removed anchors without stealing chooser draft focus; cancellation has a connected fallback", () => {
    let session!: OutlineInsertSession;
    const request = (_target: unknown, next: OutlineInsertSession) => { session = next; };
    const view = (nodes: OutlineNode[]) => <><input aria-label="Chooser draft" /><OutlineTree nodes={nodes} onRequestInsert={request} /></>;
    const { rerender, container } = render(view([leaf("A")]));
    fireEvent.click(screen.getByRole("button", { name: "Insert before A" }));
    act(() => screen.getByRole("textbox").focus());
    rerender(view([]));
    expect(session.resolveTarget()).toBeNull();
    expect(screen.getByRole("textbox")).toHaveFocus();
    rerender(view([leaf("A")]));
    expect(session.resolveTarget()).toBeNull();
    act(() => session.cancel());
    expect(container.querySelector(".cms-tree")).toHaveFocus();
  });

  it("rejects locked or removed named slot targets and ignores old chooser completion", () => {
    const sessions: OutlineInsertSession[] = [];
    const request = (_target: unknown, next: OutlineInsertSession) => { sessions.push(next); };
    const nodes: OutlineNode[] = [{ id: "slot", title: "body", kind: "group", variant: "slot", children: [leaf("A")] }];
    const { rerender, container } = render(<OutlineTree nodes={nodes} onRequestInsert={request} />);
    fireEvent.click(screen.getByRole("button", { name: "Insert before A" }));
    fireEvent.click(screen.getByRole("button", { name: "Insert before body" }));
    act(() => sessions[0].complete("A"));
    expect(container.querySelector(".is-active button")).toHaveAccessibleName("Insert before body");
    rerender(<OutlineTree nodes={nodes} onRequestInsert={request} canInsert={() => false} />);
    expect(sessions[1].resolveTarget()).toBeNull();
    rerender(<OutlineTree nodes={[]} onRequestInsert={request} />);
    expect(sessions[0].resolveTarget()).toBeNull();
  });

  it("focuses a newly inserted root from an empty tree", () => {
    function Host() {
      const [nodes, setNodes] = useState<OutlineNode[]>([]);
      return <OutlineTree nodes={nodes} onAdd={({ title }) => { setNodes([leaf(title)]); return title; }} />;
    }
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Add root item" }));
    const input = screen.getByRole("textbox");
    fireEvent.input(input, { target: { value: "First" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("treeitem", { name: "First" })).toHaveFocus();
  });

  it("invalidates an empty named slot if the parent is removed or becomes a leaf", () => {
    let session!: OutlineInsertSession;
    const request = (_target: unknown, next: OutlineInsertSession) => { session = next; };
    const { rerender } = render(<OutlineTree nodes={[{ id: "slot", title: "body", kind: "group", variant: "slot" }]} onRequestInsert={request} />);
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    expect(session.resolveTarget()).toEqual({ parentId: "slot", index: 0 });
    rerender(<OutlineTree nodes={[leaf("slot")]} onRequestInsert={request} />);
    expect(session.resolveTarget()).toBeNull();
    expect(screen.queryByRole("button", { name: "Add item" })).toBeNull();
  });

  it("focuses the single inserted child for synchronous void handlers", () => {
    function Host() {
      const [children, setChildren] = useState<OutlineNode[]>([]);
      return <OutlineTree nodes={[{ id: "slot", kind: "group", title: "body", variant: "slot", children }]}
        onAdd={({ title }) => { setChildren([leaf(title)]); }} />;
    }
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    const input = screen.getByRole("textbox");
    fireEvent.input(input, { target: { value: "Child" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("treeitem", { name: "Child" })).toHaveFocus();
  });

  it("invalidates chooser callbacks when the tree unmounts", () => {
    let session!: OutlineInsertSession;
    const { unmount } = render(<OutlineTree nodes={[]} onRequestInsert={(_target, next) => { session = next; }} />);
    fireEvent.click(screen.getByRole("button", { name: "Add root item" }));
    unmount();
    expect(session.resolveTarget()).toBeNull();
    expect(() => session.cancel()).not.toThrow();
  });

  it("resolves terminal chooser points at the current list end and focuses the inserted row", () => {
    let session!: OutlineInsertSession;
    const request = (_target: unknown, next: OutlineInsertSession) => { session = next; };
    const { rerender } = render(<OutlineTree nodes={[leaf("A")]} onRequestInsert={request} />);
    fireEvent.click(screen.getByRole("button", { name: "Add root item" }));
    rerender(<OutlineTree nodes={[leaf("A"), leaf("B")]} onRequestInsert={request} />);
    expect(session.resolveTarget()).toEqual({ parentId: null, index: 2 });
    act(() => session.complete("B"));
    expect(screen.getByRole("treeitem", { name: "B" })).toHaveFocus();
  });

  it("does not submit or dismiss inline insertion during IME composition", () => {
    const add = vi.fn();
    render(<OutlineTree nodes={[leaf("A")]} onAdd={add} />);
    fireEvent.click(screen.getByRole("button", { name: "Insert before A" }));
    const input = screen.getByRole("textbox");
    fireEvent.input(input, { target: { value: "日本語" } });
    fireEvent(input, new CompositionEvent("compositionstart", { bubbles: true }));
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    fireEvent.keyDown(input, { key: "Escape", keyCode: 229 });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveFocus();
    expect(add).not.toHaveBeenCalled();
    fireEvent(input, new CompositionEvent("compositionend", { bubbles: true }));
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    fireEvent.keyDown(input, { key: "Escape", keyCode: 229 });
    expect(add).not.toHaveBeenCalled();
    const remove = vi.spyOn(input, "removeEventListener");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(add).toHaveBeenCalledWith({ parentId: null, index: 0, title: "日本語" });
    expect(remove).toHaveBeenCalledWith("compositionstart", expect.any(Function));
    expect(remove).toHaveBeenCalledWith("compositionend", expect.any(Function));
  });

  it("renames with F2, preserves descendants and consumes Escape before outer surfaces", () => {
    const rename = vi.fn();
    const outer = vi.fn();
    render(<div onKeyDown={outer}><OutlineTree nodes={[{ id: "group", title: "Group", kind: "group", children: [leaf("A")] }]} onRename={rename} /></div>);
    const row = screen.getByRole("treeitem", { name: "Group" });
    fireEvent.keyDown(row, { key: "F2" });
    const input = screen.getByRole("textbox", { name: "Rename Group" });
    expect(input).toHaveFocus();
    expect(screen.getByRole("treeitem", { name: "A" })).toBeInTheDocument();
    fireEvent.input(input, { target: { value: "新しい" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(rename).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(rename).toHaveBeenCalledWith("group", "新しい");
    expect(row).toHaveFocus();
    fireEvent.keyDown(row, { key: "F2" });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(row).toHaveFocus();
    expect(outer).not.toHaveBeenCalled();
  });
});
