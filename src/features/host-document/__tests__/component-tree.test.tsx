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
