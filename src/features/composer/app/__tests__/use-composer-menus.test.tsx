import "../../test-support/cleanup";
// Tests the context-menu orchestration hook: item derivation per context,
// disabled-paste + clipboard-name label, opaque-node item hiding, the
// single-action Delete, sibling reorder bounds, and which close path invokes
// `restoreFocus`. Positioning belongs to the shared `Menu`, which measures the
// trigger this hook points it at.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { getScope } from "@takazudo/zfb/zudo-react";
import { render } from "../../../../test/render";
import { VIRTUAL_ROOT_SLOT_ID } from "../../../../composer/browser";
import { fixtureComponentProvider, FIXTURE_IDS, makeAbcDocument, resetFixtureIds } from "../../ui/tree/__tests__/fixtures";
import { createComposerIntegration, type ComposerIntegrationApi } from "../use-composer-integration";
import { createComposerMenus, type ComposerMenusApi } from "../use-composer-menus";
import { controllerOptions } from "../test-support/controller-fixtures";

const RECT = { x: 10, y: 20, width: 80, height: 24 };

function setup(sample = makeAbcDocument()) {
  resetFixtureIds();
  const options = controllerOptions(sample);
  let current: { api: ComposerIntegrationApi; menus: ComposerMenusApi } | null = null;
  function Host() {
    const scope = getScope();
    const api = createComposerIntegration(scope, {
      componentProvider: fixtureComponentProvider,
      controllerOptions: options,
    });
    current = { api, menus: createComposerMenus(scope, api) };
    return null;
  }
  render(<Host />);
  return { result: { current: current! } };
}

beforeEach(() => localStorage.clear());

describe("createComposerMenus — node menu", () => {
  it("openNodeMenu on a normal node offers Copy/Cut/Duplicate/Move/Delete, Delete danger-styled", () => {
    const { result } = setup();
    result.current.menus.openNodeMenu("B", RECT, vi.fn());

    expect(result.current.menus.controller.open.value).toBe(true);
    const ids = result.current.menus.items.value.map((i) => i.id);
    expect(ids).toEqual(["copy", "cut", "duplicate", "move-up", "move-down", "delete"]);
    expect(result.current.menus.items.value.find((i) => i.id === "delete")!.danger).toBe(true);
  });

  it("hides Copy/Cut/Duplicate for an opaque node — reorder and Delete remain", () => {
    const document = makeAbcDocument();
    document.root.push({ id: "ghost", componentId: "ghost.unknown", componentVersion: 1, props: {}, slots: {} });
    const { result } = setup(document);
    result.current.menus.openNodeMenu("ghost", RECT, vi.fn());
    expect(result.current.menus.items.value.map((i) => i.id)).toEqual(["move-up", "move-down", "delete"]);
  });

  it("Delete on a leaf removes immediately and restores focus", () => {
    const { result } = setup();
    const restoreFocus = vi.fn();
    result.current.menus.openNodeMenu("B", RECT, restoreFocus);
    result.current.menus.items.value.find((i) => i.id === "delete")!.onSelect();

    expect(result.current.api.controller.state.value.document.root[0]!.slots.right).toHaveLength(1);
    expect(result.current.menus.controller.open.value).toBe(false);
    expect(restoreFocus).toHaveBeenCalledTimes(1);
  });

  it("Delete on a populated subtree removes immediately, closes, and restores focus", () => {
    const { result } = setup();
    const restoreFocus = vi.fn();
    result.current.menus.openNodeMenu("split", RECT, restoreFocus);
    result.current.menus.items.value.find((i) => i.id === "delete")!.onSelect();

    expect(result.current.api.controller.state.value.document.root).toHaveLength(0);
    expect(result.current.menus.controller.open.value).toBe(false);
    expect(restoreFocus).toHaveBeenCalledTimes(1);
  });

  it("Copy/Cut/Duplicate route exclusively through the controller and close (restoring focus)", () => {
    const { result } = setup();
    const restoreFocus = vi.fn();
    result.current.menus.openNodeMenu("B", RECT, restoreFocus);
    result.current.menus.items.value.find((i) => i.id === "copy")!.onSelect();
    expect(result.current.api.controller.state.value.clipboard).toMatchObject({ id: "B" });
    expect(result.current.menus.controller.open.value).toBe(false);
    expect(restoreFocus).toHaveBeenCalledTimes(1);

    restoreFocus.mockClear();
    result.current.menus.openNodeMenu("C", RECT, restoreFocus);
    result.current.menus.items.value.find((i) => i.id === "duplicate")!.onSelect();
    const rightIds = result.current.api.controller.state.value.document.root[0]!.slots.right.map(
      (n: { id: string }) => n.id,
    );
    expect(rightIds).toContain("C");
    expect(rightIds.length).toBe(3);
    expect(restoreFocus).toHaveBeenCalledTimes(1);
  });
});

describe("createComposerMenus — insert menu", () => {
  it("always offers BOTH 'Add component…' and 'Paste here'; paste disabled while clipboard is empty", () => {
    const { result } = setup();
    result.current.menus.openInsertMenu({ parentId: null, slotId: VIRTUAL_ROOT_SLOT_ID, index: 0 }, RECT, vi.fn());
    const items = result.current.menus.items.value;
    expect(items.map((i) => i.id)).toEqual(["add", "paste"]);
    expect(items.find((i) => i.id === "paste")!.disabled).toBe(true);
    expect(items.find((i) => i.id === "paste")!.label).toBe("Paste here");
  });

  it("shows the clipboard component's display name when filled, and enables paste", () => {
    const { result } = setup();
    result.current.api.handleCopy("B");
    result.current.menus.openInsertMenu({ parentId: null, slotId: VIRTUAL_ROOT_SLOT_ID, index: 0 }, RECT, vi.fn());
    const paste = result.current.menus.items.value.find((i) => i.id === "paste")!;
    expect(paste.disabled).toBe(false);
    expect(paste.label).toBe('Paste "Box" here');
  });

  it("'Paste here' pastes at the exact target and restores focus", () => {
    const { result } = setup();
    result.current.api.handleCopy("B");
    const restoreFocus = vi.fn();
    const target = { parentId: null, slotId: VIRTUAL_ROOT_SLOT_ID, index: 0 };
    result.current.menus.openInsertMenu(target, RECT, restoreFocus);
    result.current.menus.items.value.find((i) => i.id === "paste")!.onSelect();

    const doc = result.current.api.controller.state.value.document;
    expect(doc.root).toHaveLength(2);
    expect(doc.root[0]!.componentId).toBe(FIXTURE_IDS.box);
    expect(result.current.menus.controller.open.value).toBe(false);
    expect(restoreFocus).toHaveBeenCalledTimes(1);
  });

  it("'Add component…' closes WITHOUT restoreFocus and opens the shared chooser by default", () => {
    const { result } = setup();
    const restoreFocus = vi.fn();
    const target = { parentId: null, slotId: VIRTUAL_ROOT_SLOT_ID, index: 0 };
    result.current.menus.openInsertMenu(target, RECT, restoreFocus);
    result.current.menus.items.value.find((i) => i.id === "add")!.onSelect();

    expect(result.current.menus.controller.open.value).toBe(false);
    expect(restoreFocus).not.toHaveBeenCalled();
    expect(result.current.api.chooser.value).toEqual({ open: true, target });
  });

  it("'Add component…' calls a supplied override instead of the default chooser open (canvas relay)", () => {
    const { result } = setup();
    const target = { parentId: null, slotId: VIRTUAL_ROOT_SLOT_ID, index: 0 };
    const addComponent = vi.fn();
    result.current.menus.openInsertMenu(target, RECT, vi.fn(), addComponent);
    result.current.menus.items.value.find((i) => i.id === "add")!.onSelect();

    expect(addComponent).toHaveBeenCalledTimes(1);
    expect(result.current.api.chooser.value.open).toBe(false);
  });
});

describe("createComposerMenus — structure-row wrappers", () => {
  it("handleTreeOpenNodeMenu points the menu at the trigger and restores focus to it", () => {
    const { result } = setup();
    const trigger = document.createElement("button");
    document.body.append(trigger);
    const focusSpy = vi.spyOn(trigger, "focus");

    result.current.menus.handleTreeOpenNodeMenu("B", trigger);
    expect(result.current.menus.controller.open.value).toBe(true);
    expect(result.current.menus.controller.triggerRef.current).toBe(trigger);

    result.current.menus.close();
    expect(focusSpy).toHaveBeenCalledTimes(1);
    trigger.remove();
  });

  it("handleTreeOpenInsertMenu behaves the same way for the insert menu", () => {
    const { result } = setup();
    const trigger = document.createElement("button");
    document.body.append(trigger);
    const focusSpy = vi.spyOn(trigger, "focus");

    result.current.menus.handleTreeOpenInsertMenu( { parentId: null, slotId: VIRTUAL_ROOT_SLOT_ID, index: 0 }, trigger, );
    expect(result.current.menus.controller.open.value).toBe(true);
    result.current.menus.close();
    expect(focusSpy).toHaveBeenCalledTimes(1);
    trigger.remove();
  });
});
