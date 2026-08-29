/** @jsxRuntime automatic */
/** @jsxImportSource preact */
import "../../test-support/cleanup";
// Tests the context-menu orchestration hook (issue #256): item derivation per
// context, disabled-paste + clipboard-name label, opaque-node item hiding,
// the Delete subtree-removal confirmation hand-off (reusing #250's own
// component), and which close path invokes `restoreFocus`.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/preact";
import { VIRTUAL_ROOT_SLOT_ID } from "../../../../composer/browser";
import { fixtureComponentProvider, FIXTURE_IDS, makeAbcDocument, resetFixtureIds } from "../../ui/tree/__tests__/fixtures";
import { useComposerIntegration } from "../use-composer-integration";
import { useComposerMenus } from "../use-composer-menus";
import { controllerOptions } from "../test-support/controller-fixtures";

const RECT = { x: 10, y: 20, width: 80, height: 24 };

function setup(sample = makeAbcDocument()) {
  resetFixtureIds();
  const options = controllerOptions(sample);
  return renderHook(() => {
    const api = useComposerIntegration({
      componentProvider: fixtureComponentProvider,
      controllerOptions: options,
    });
    const menus = useComposerMenus(api);
    return { api, menus };
  });
}

beforeEach(() => localStorage.clear());

describe("useComposerMenus — node menu (issue #256)", () => {
  it("openNodeMenu on a normal node offers Copy/Cut/Duplicate/Delete, Delete danger-styled", () => {
    const { result } = setup();
    act(() => result.current.menus.openNodeMenu("B", RECT, vi.fn()));

    expect(result.current.menus.open).toBe(true);
    expect(result.current.menus.anchor).toEqual({ x: RECT.x, y: RECT.y + RECT.height + 4 });
    const ids = result.current.menus.items!.map((i) => i.id);
    expect(ids).toEqual(["copy", "cut", "duplicate", "delete"]);
    expect(result.current.menus.items!.find((i) => i.id === "delete")!.danger).toBe(true);
  });

  it("hides Copy/Cut/Duplicate for an opaque node — Delete remains", () => {
    const document = makeAbcDocument();
    document.root.push({ id: "ghost", componentId: "ghost.unknown", componentVersion: 1, props: {}, slots: {} });
    const { result } = setup(document);
    act(() => result.current.menus.openNodeMenu("ghost", RECT, vi.fn()));
    expect(result.current.menus.items!.map((i) => i.id)).toEqual(["delete"]);
  });

  it("Delete on a LEAF (no descendants) removes immediately and restores focus", () => {
    const { result } = setup();
    const restoreFocus = vi.fn();
    act(() => result.current.menus.openNodeMenu("B", RECT, restoreFocus));
    act(() => result.current.menus.items!.find((i) => i.id === "delete")!.onSelect());

    expect(result.current.api.controller.state.document.root[0]!.slots.right).toHaveLength(1);
    expect(result.current.menus.open).toBe(false);
    expect(restoreFocus).toHaveBeenCalledTimes(1);
  });

  it("Delete on a POPULATED subtree shows the confirmation instead of removing, and stays open", () => {
    const { result } = setup();
    const restoreFocus = vi.fn();
    act(() => result.current.menus.openNodeMenu("split", RECT, restoreFocus));
    act(() => result.current.menus.items!.find((i) => i.id === "delete")!.onSelect());

    expect(result.current.menus.open).toBe(true);
    expect(result.current.menus.items).toBeNull();
    expect(result.current.menus.confirm).toEqual({ nodeTitle: "Split Layout", descendantCount: 3 });
    expect(restoreFocus).not.toHaveBeenCalled();
    // No mutation yet.
    expect(result.current.api.controller.state.document.root).toHaveLength(1);
  });

  it("confirming removal removes the subtree and restores focus", () => {
    const { result } = setup();
    const restoreFocus = vi.fn();
    act(() => result.current.menus.openNodeMenu("split", RECT, restoreFocus));
    act(() => result.current.menus.items!.find((i) => i.id === "delete")!.onSelect());
    act(() => result.current.menus.onConfirmDelete());

    expect(result.current.api.controller.state.document.root).toHaveLength(0);
    expect(result.current.menus.open).toBe(false);
    expect(restoreFocus).toHaveBeenCalledTimes(1);
  });

  it("cancelling the confirmation makes NO mutation but still restores focus", () => {
    const { result } = setup();
    const restoreFocus = vi.fn();
    act(() => result.current.menus.openNodeMenu("split", RECT, restoreFocus));
    act(() => result.current.menus.items!.find((i) => i.id === "delete")!.onSelect());
    act(() => result.current.menus.onCancelConfirm());

    expect(result.current.api.controller.state.document.root).toHaveLength(1);
    expect(result.current.menus.open).toBe(false);
    expect(restoreFocus).toHaveBeenCalledTimes(1);
  });

  it("Copy/Cut/Duplicate route exclusively through the controller and close (restoring focus)", () => {
    const { result } = setup();
    const restoreFocus = vi.fn();
    act(() => result.current.menus.openNodeMenu("B", RECT, restoreFocus));
    act(() => result.current.menus.items!.find((i) => i.id === "copy")!.onSelect());
    expect(result.current.api.controller.state.clipboard).toMatchObject({ id: "B" });
    expect(result.current.menus.open).toBe(false);
    expect(restoreFocus).toHaveBeenCalledTimes(1);

    restoreFocus.mockClear();
    act(() => result.current.menus.openNodeMenu("C", RECT, restoreFocus));
    act(() => result.current.menus.items!.find((i) => i.id === "duplicate")!.onSelect());
    const rightIds = result.current.api.controller.state.document.root[0]!.slots.right.map(
      (n: { id: string }) => n.id,
    );
    expect(rightIds).toContain("C");
    expect(rightIds.length).toBe(3);
    expect(restoreFocus).toHaveBeenCalledTimes(1);
  });
});

describe("useComposerMenus — insert menu (issue #256)", () => {
  it("always offers BOTH 'Add component…' and 'Paste here'; paste disabled while clipboard is empty", () => {
    const { result } = setup();
    act(() => result.current.menus.openInsertMenu({ parentId: null, slotId: VIRTUAL_ROOT_SLOT_ID, index: 0 }, RECT, vi.fn()));
    const items = result.current.menus.items!;
    expect(items.map((i) => i.id)).toEqual(["add", "paste"]);
    expect(items.find((i) => i.id === "paste")!.disabled).toBe(true);
    expect(items.find((i) => i.id === "paste")!.label).toBe("Paste here");
  });

  it("shows the clipboard component's display name when filled, and enables paste", () => {
    const { result } = setup();
    act(() => result.current.api.handleCopy("B"));
    act(() => result.current.menus.openInsertMenu({ parentId: null, slotId: VIRTUAL_ROOT_SLOT_ID, index: 0 }, RECT, vi.fn()));
    const paste = result.current.menus.items!.find((i) => i.id === "paste")!;
    expect(paste.disabled).toBe(false);
    expect(paste.label).toBe('Paste "Box" here');
  });

  it("'Paste here' pastes at the exact target and restores focus", () => {
    const { result } = setup();
    act(() => result.current.api.handleCopy("B"));
    const restoreFocus = vi.fn();
    const target = { parentId: null, slotId: VIRTUAL_ROOT_SLOT_ID, index: 0 };
    act(() => result.current.menus.openInsertMenu(target, RECT, restoreFocus));
    act(() => result.current.menus.items!.find((i) => i.id === "paste")!.onSelect());

    const doc = result.current.api.controller.state.document;
    expect(doc.root).toHaveLength(2);
    expect(doc.root[0]!.componentId).toBe(FIXTURE_IDS.box);
    expect(result.current.menus.open).toBe(false);
    expect(restoreFocus).toHaveBeenCalledTimes(1);
  });

  it("'Add component…' closes WITHOUT restoreFocus and opens the shared chooser by default", () => {
    const { result } = setup();
    const restoreFocus = vi.fn();
    const target = { parentId: null, slotId: VIRTUAL_ROOT_SLOT_ID, index: 0 };
    act(() => result.current.menus.openInsertMenu(target, RECT, restoreFocus));
    act(() => result.current.menus.items!.find((i) => i.id === "add")!.onSelect());

    expect(result.current.menus.open).toBe(false);
    expect(restoreFocus).not.toHaveBeenCalled();
    expect(result.current.api.chooser).toEqual({ open: true, target });
  });

  it("'Add component…' calls a supplied override instead of the default chooser open (canvas relay)", () => {
    const { result } = setup();
    const target = { parentId: null, slotId: VIRTUAL_ROOT_SLOT_ID, index: 0 };
    const addComponent = vi.fn();
    act(() => result.current.menus.openInsertMenu(target, RECT, vi.fn(), addComponent));
    act(() => result.current.menus.items!.find((i) => i.id === "add")!.onSelect());

    expect(addComponent).toHaveBeenCalledTimes(1);
    expect(result.current.api.chooser.open).toBe(false);
  });
});

describe("useComposerMenus — tree convenience wrappers", () => {
  it("handleTreeOpenNodeMenu derives the anchor from the trigger's rect and restores focus to the trigger itself", () => {
    const { result } = setup();
    const trigger = document.createElement("button");
    document.body.append(trigger);
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
      x: 5,
      y: 6,
      width: 20,
      height: 10,
      top: 6,
      left: 5,
      right: 25,
      bottom: 16,
      toJSON: () => ({}),
    });
    const focusSpy = vi.spyOn(trigger, "focus");

    act(() => result.current.menus.handleTreeOpenNodeMenu("B", trigger));
    expect(result.current.menus.anchor).toEqual({ x: 5, y: 6 + 10 + 4 });

    act(() => result.current.menus.onClose());
    expect(focusSpy).toHaveBeenCalledTimes(1);
    trigger.remove();
  });

  it("handleTreeOpenInsertMenu behaves the same way for the insert menu", () => {
    const { result } = setup();
    const trigger = document.createElement("button");
    document.body.append(trigger);
    const focusSpy = vi.spyOn(trigger, "focus");

    act(() =>
      result.current.menus.handleTreeOpenInsertMenu(
        { parentId: null, slotId: VIRTUAL_ROOT_SLOT_ID, index: 0 },
        trigger,
      ),
    );
    expect(result.current.menus.open).toBe(true);
    act(() => result.current.menus.onClose());
    expect(focusSpy).toHaveBeenCalledTimes(1);
    trigger.remove();
  });
});
