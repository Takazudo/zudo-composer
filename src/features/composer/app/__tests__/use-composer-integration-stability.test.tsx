/** @jsxRuntime automatic */
/** @jsxImportSource preact */
import "../../test-support/cleanup";
// Referential-stability regression test (issue #286): `useComposerExport`
// used to return a fresh object literal every render, and `handleEscape`
// closed over that whole object — so every unrelated re-render of
// `useComposerIntegration` produced a new `handleEscape` identity, which in
// turn made `useComposerKeyboard`'s effect (deps include `onEscape`) tear
// down and re-add the global `keydown` listener on every render. This file
// proves `exportState` and `handleEscape` now stay referentially stable
// across a rerender triggered by unrelated state (a canvas selection change,
// or opening/closing the chooser).

import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/preact";
import { VIRTUAL_ROOT_SLOT_ID } from "../../../../composer";
import { fixturePackManifest, makeAbcDocument, resetFixtureIds } from "../../ui/tree/__tests__/fixtures";
import { useComposerIntegration } from "../use-composer-integration";
import { controllerOptions } from "../test-support/controller-fixtures";

function setup() {
  resetFixtureIds();
  // Stable across re-renders — see the sibling clipboard test file for why an
  // idFactory literal created inline in the render callback would reset its
  // counter on every re-render.
  const options = controllerOptions(makeAbcDocument());
  return renderHook(() =>
    useComposerIntegration({
      manifest: fixturePackManifest,
      controllerOptions: options,
    }),
  );
}

beforeEach(() => localStorage.clear());

describe("useComposerIntegration — referential stability (#286)", () => {
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
    act(() => result.current.exportState.closeExport());
    expect(result.current.exportState.open).toBe(false);
    expect(result.current.exportState).not.toBe(exportStateWhileOpen); // `open` itself changed — expected
    expect(result.current.handleEscape).toBe(handleEscapeBefore);
  });
});
