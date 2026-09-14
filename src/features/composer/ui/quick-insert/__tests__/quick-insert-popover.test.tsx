/** @jsxRuntime automatic */
/** @jsxImportSource preact */
import "../../../test-support/cleanup";

import { describe, expect, it, vi } from "vitest";
import { useRef } from "preact/hooks";
import { act, fireEvent, render, screen, within } from "@testing-library/preact";
import { Menu, useMenu } from "../../../../../components/overlay";
import type { SlotRule } from "../../slot-rules";
import { offersQuickInsert, QUICK_INSERT_MAX_KINDS, QuickInsertPopover } from "../quick-insert-popover";

function accepted(count: number): SlotRule["accepts"] {
  return Array.from({ length: count }, (_, index) => ({
    id: `kind-${index}`,
    title: `Kind ${index}`,
    category: "Content",
    hasOwnRule: false,
  }));
}

function restrictedRule(overrides: Partial<SlotRule> = {}): SlotRule {
  return {
    kind: "restricted",
    accepts: accepted(2),
    hiddenByRule: [{ id: "other", title: "Other", category: "Layout" }],
    cardinality: "many",
    count: 0,
    full: false,
    origin: { componentId: "shop.category-body", componentTitle: "Category body", slotId: "content", slotLabel: "Content" },
    blockedReason: null,
    ...overrides,
  };
}

function Harness(props: { rule: SlotRule; onInsert: (id: string) => void; onOpenChooser: () => void; onOpenPatterns: () => void }) {
  const trigger = useRef<HTMLButtonElement | null>(null);
  const menu = useMenu(trigger);
  return (
    <>
      <button ref={trigger} type="button" {...menu.triggerProps}>Add</button>
      <Menu controller={menu} label="Content accepts">
        <QuickInsertPopover {...props} />
      </Menu>
    </>
  );
}

function setup(rule = restrictedRule()) {
  const handlers = { onInsert: vi.fn(), onOpenChooser: vi.fn(), onOpenPatterns: vi.fn() };
  render(<Harness rule={rule} {...handlers} />);
  const trigger = screen.getByRole("button", { name: "Add" });
  act(() => trigger.focus());
  fireEvent.click(trigger);
  return { ...handlers, trigger, menu: () => screen.queryByRole("menu") };
}

describe("QuickInsertPopover", () => {
  it("renders the header, one chip per allowed kind in rule order, Pattern…, the rule origin and More…", () => {
    const s = setup();
    const menu = s.menu()!;
    expect(menu).toHaveTextContent("Content accepts");
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Kind 0",
      "Kind 1",
      "Pattern…",
      "More… (search, 1 hidden)",
    ]);
    expect(menu).toHaveTextContent("rule: Category body › Content");
  });

  it("a chip click inserts that kind", () => {
    const s = setup();
    fireEvent.click(screen.getByRole("menuitem", { name: "Kind 1" }));
    expect(s.onInsert).toHaveBeenCalledWith("kind-1");
  });

  it("More… opens the full chooser and Pattern… the Patterns tab", () => {
    const s = setup();
    fireEvent.click(screen.getByRole("menuitem", { name: /^More…/ }));
    expect(s.onOpenChooser).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("menuitem", { name: "Pattern…" }));
    expect(s.onOpenPatterns).toHaveBeenCalledTimes(1);
  });

  it("Escape closes the popover and restores focus to its trigger", () => {
    const s = setup();
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Kind 0" }));
    fireEvent.keyDown(s.menu()!, { key: "Escape" });
    expect(s.menu()).toBeNull();
    expect(document.activeElement).toBe(s.trigger);
  });
});

describe("offersQuickInsert", () => {
  it("offers chips only for a restricted, non-full slot with one to six kinds", () => {
    expect(offersQuickInsert(restrictedRule())).toBe(true);
    expect(offersQuickInsert(restrictedRule({ accepts: accepted(QUICK_INSERT_MAX_KINDS) }))).toBe(true);
    expect(offersQuickInsert(restrictedRule({ accepts: accepted(QUICK_INSERT_MAX_KINDS + 1) }))).toBe(false);
    expect(offersQuickInsert(restrictedRule({ accepts: [] }))).toBe(false);
    expect(offersQuickInsert(restrictedRule({ full: true, blockedReason: "This slot is full." }))).toBe(false);
    expect(offersQuickInsert(restrictedRule({ kind: "open" }))).toBe(false);
    expect(offersQuickInsert(restrictedRule({ kind: "unavailable", accepts: [], blockedReason: "No." }))).toBe(false);
  });
});
