import "../../test-support/cleanup";
// Referential-stability regression test (issue #286): a fresh export object
// or `handleEscape` identity per update made the keyboard binding tear down
// and re-add the global `keydown` listener. This file proves `exportState`
// and `handleEscape` stay referentially stable across unrelated state changes
// (a canvas selection change, or opening/closing the chooser).

import { beforeEach, describe, expect, it } from "vitest";
import { act, renderIntegration } from "../test-support/integration-harness";
import { VIRTUAL_ROOT_SLOT_ID } from "../../../../composer/browser";
import { fixtureComponentProvider, makeAbcDocument, resetFixtureIds } from "../../ui/tree/__tests__/fixtures";
import { controllerOptions } from "../test-support/controller-fixtures";

function setup() {
  resetFixtureIds();
  // Stable across re-renders — see the sibling clipboard test file for why an
  // idFactory literal created inline in the render callback would reset its
  // counter on every re-render.
  const options = controllerOptions(makeAbcDocument());
  return renderIntegration({
      componentProvider: fixtureComponentProvider,
      controllerOptions: options,
    });
}

beforeEach(() => localStorage.clear());

describe("createComposerIntegration — referential stability (#286)", () => {
  it("passes the authoritative provider catalog to the controller by identity", () => {
    const { result } = setup();
    expect(result.current.controller.manifest).toBe(fixtureComponentProvider.catalog);
  });

  it("exportState and handleEscape keep identity across an unrelated rerender (canvas selection change)", () => {
    const { result } = setup();
    const exportStateBefore = result.current.exportState;
    const handleEscapeBefore = result.current.handleEscape;

    act(() => result.current.handleCanvasSelect("B"));

    expect(result.current.controller.state.selectedId).toBe("B"); // the rerender actually happened
    expect(result.current.exportState).toBe(exportStateBefore);
    expect(result.current.handleEscape).toBe(handleEscapeBefore);
  });

  it("opening and closing the chooser does not change handleEscape's identity", () => {
    const { result } = setup();
    const handleEscapeBefore = result.current.handleEscape;

    act(() =>
      result.current.openChooser({ parentId: null, slotId: VIRTUAL_ROOT_SLOT_ID, index: 0 }),
    );
    expect(result.current.chooser.open).toBe(true);
    expect(result.current.handleEscape).toBe(handleEscapeBefore);

    act(() => result.current.closeChooser());
    expect(result.current.chooser.open).toBe(false);
    expect(result.current.handleEscape).toBe(handleEscapeBefore);
  });

  it("opening and closing export does not change handleEscape's identity, and exportState only changes when its own state does", () => {
    const { result } = setup();
    const handleEscapeBefore = result.current.handleEscape;

    act(() => result.current.exportState.openExport());
    expect(result.current.exportState.open).toBe(true);
    expect(result.current.handleEscape).toBe(handleEscapeBefore);

    const exportStateWhileOpen = result.current.exportState;
    const openWhileOpen = result.current.exportState.open;
    act(() => result.current.exportState.closeExport());
    expect(result.current.exportState.open).toBe(false);
    // The export controller is one stable object; what changes is its own `open` state.
    expect(result.current.exportState).toBe(exportStateWhileOpen);
    expect(result.current.exportState.open).not.toBe(openWhileOpen);
    expect(result.current.handleEscape).toBe(handleEscapeBefore);
  });
});
