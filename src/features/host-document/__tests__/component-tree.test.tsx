import { cleanup, fireEvent, render, waitFor } from "@testing-library/preact";
import { afterEach, expect, it, vi } from "vitest";
import { HostComponentTree } from "../component-tree";
import type { HostDocumentTarget } from "../../../../server/host-document/types";

afterEach(cleanup);
const target = (id: string, parent: string | null, componentId: string, recordId = "page"): HostDocumentTarget => ({ renderedNodeId: id, parentRenderedNodeId: parent, componentId, providerId: "files", recordId, nodeId: "same-canonical-id", slotId: parent ? "content" : null, props: {}, entries: [] });
const targets = [target("root", null, "page"), target("group", "root", "group"), target("consultation", "group", "consultation", "shared-course"), target("price", "consultation", "price", "shared-course")];
const titles = new Map([["page", "Lessons"], ["group", "Section"], ["consultation", "Consultation"], ["price", "Price"]]);
it("keeps nested wrappers contextual and exposes exact owners through keyboard selection", async () => {
  const onSelect = vi.fn();
  const view = render(<HostComponentTree targets={targets} titles={titles} disabled={false} onSelect={onSelect} />);
  const root = await view.findByRole("treeitem", { name: "Lessons" });
  const group = await view.findByRole("treeitem", { name: "Section" });
  expect(group.getAttribute("aria-level")).toBe("2");
  expect(view.queryByRole("treeitem", { name: "Consultation" })).toBeNull();
  root.focus(); fireEvent.keyDown(root, { key: "ArrowDown" }); expect(document.activeElement).toBe(group);
  fireEvent.keyDown(group, { key: "ArrowRight" });
  const consultation = await view.findByRole("treeitem", { name: "Consultation" });
  fireEvent.keyDown(group, { key: "ArrowRight" }); expect(document.activeElement).toBe(consultation);
  fireEvent.keyDown(consultation, { key: "Enter" }); expect(onSelect).toHaveBeenCalledWith(targets[2]);
  expect(consultation.textContent).toContain("Slot: content");
  fireEvent.keyDown(consultation, { key: "ArrowLeft" }); expect(document.activeElement).toBe(group);
  fireEvent.keyDown(group, { key: "ArrowLeft" }); expect(view.queryByRole("treeitem", { name: "Consultation" })).toBeNull();
  expect(root.tabIndex).toBe(-1); expect(group.tabIndex).toBe(0);
});
it("reveals every collapsed ancestor for iframe selection without stealing focus", async () => {
  const onSelect = vi.fn();
  const view = render(<><button>Outside tree</button><HostComponentTree targets={targets} titles={titles} disabled={false} onSelect={onSelect} /></>);
  const outside = view.getByRole("button", { name: "Outside tree" }); outside.focus();
  view.rerender(<><button>Outside tree</button><HostComponentTree targets={targets} titles={titles} selectedId="price" disabled={false} onSelect={onSelect} /></>);
  const price = await view.findByRole("treeitem", { name: "Price" });
  await waitFor(() => expect(price.getAttribute("aria-selected")).toBe("true"));
  expect(view.getByRole("treeitem", { name: "Section" }).getAttribute("aria-expanded")).toBe("true");
  expect(price.getAttribute("aria-level")).toBe("4"); expect(price.tabIndex).toBe(0); expect(document.activeElement).toBe(outside);
  fireEvent.keyDown(price, { key: " " }); expect(onSelect).toHaveBeenCalledWith(targets[3]);
});

it("flattens only declared nonempty wrappers and preserves exact owner selection and visible keyboard parent", async () => {
  const wrapper = { ...targets[1]!, presentation: { label: "Wrapper", kindTitle: "Group", transparent: true } };
  const semantic = { ...targets[2]!, presentation: { label: "Consultation label", kindTitle: "Section", transparent: false } };
  const empty = { ...target("empty", "root", "group"), presentation: { label: "Empty group", kindTitle: "Group", transparent: true } };
  const items = [targets[0]!, wrapper, semantic, targets[3]!, empty];
  const onSelect = vi.fn(), view = render(<HostComponentTree targets={items} titles={titles} disabled={false} onSelect={onSelect} />);
  const section = await view.findByRole("treeitem", { name: "Consultation label" });
  expect(view.queryByRole("treeitem", { name: "Wrapper" })).toBeNull();
  expect(section.getAttribute("aria-level")).toBe("2");
  expect(view.getByRole("treeitem", { name: "Empty group" })).toBeTruthy();
  fireEvent.keyDown(section, { key: "Enter" }); expect(onSelect).toHaveBeenCalledWith(semantic);
  expect(semantic.parentRenderedNodeId).toBe("group");
  fireEvent.keyDown(section, { key: "ArrowLeft" }); expect(document.activeElement).toBe(view.getByRole("treeitem", { name: "Lessons" }));
  view.rerender(<HostComponentTree targets={items} titles={titles} selectedId="group" disabled={false} onSelect={onSelect} />);
  expect(await view.findByRole("treeitem", { name: "Wrapper" })).toBeTruthy();
  fireEvent.click(view.getByRole("checkbox", { name: "Show structural wrappers" }));
  fireEvent.click(view.getByRole("button", { name: "Expand Wrapper" }));
  expect(view.getByRole("treeitem", { name: "Consultation label" }).getAttribute("aria-level")).toBe("3");
});

it("projects nested wrappers without changing placement, repeated owners, duplicate labels or canonical slots", async () => {
  const { projectHostTree } = await import("../tree-presentation");
  const hidden = (id: string, parent: string | null) => ({ ...target(id, parent, "group"), presentation: { label: "Group", kindTitle: "Group", transparent: true } });
  const placement = { providerId: "files", recordId: "page", nodeId: "placement", parentNodeId: "layout", slotId: "items" };
  const a = { ...target("instance-a", "nested", "section", "shared"), placement, presentation: { label: "Same label", kindTitle: "Section", transparent: false } };
  const b = { ...a, renderedNodeId: "instance-b" };
  const input = [hidden("outer", null), hidden("nested", "outer"), a, b];
  const before = structuredClone(input), tree = projectHostTree(input, false);
  expect(tree.roots).toEqual([a, b]);
  expect(tree.byId.get("instance-a")).toBe(a);
  expect(tree.byId.get("instance-a")!.placement).toBe(placement);
  expect(tree.parentOf.get("instance-a")).toBeNull();
  expect(input).toEqual(before);
  const advanced = projectHostTree(input, true);
  expect(advanced.parentOf.get("instance-a")).toBe("nested");
});
