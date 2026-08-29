/** @jsxRuntime automatic */
/** @jsxImportSource preact */
import "../../test-support/cleanup";
// Tests the clipboard/duplicate seam `useComposerIntegration` exposes for
// wave 7 (#256) menus (issue #255): `handleCopy` / `handleCut` / `handlePaste`
// / `handleDuplicate` composed against the ONE controller. The reducer- and
// hook-level clipboard behavior itself is exhaustively covered in
// `chrome/__tests__/controller-model-clipboard.test.ts` and
// `chrome/__tests__/use-composer-controller-clipboard.test.tsx`; this file
// only proves the integration hook wires straight through to it.

import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/preact";
import { VIRTUAL_ROOT_SLOT_ID } from "../../../../composer/browser";
import { fixturePackManifest, FIXTURE_IDS, makeAbcDocument, resetFixtureIds } from "../../ui/tree/__tests__/fixtures";
import { useComposerIntegration } from "../use-composer-integration";
import { controllerOptions } from "../test-support/controller-fixtures";

function setup(document = makeAbcDocument()) {
  resetFixtureIds();
  // Stable across re-renders — see the sibling chrome-level clipboard test
  // files for why an idFactory literal created inline in the render callback
  // would reset its counter on every re-render.
  const options = controllerOptions(document);
  return renderHook(() =>
    useComposerIntegration({
      manifest: fixturePackManifest,
      controllerOptions: options,
    }),
  );
}

beforeEach(() => localStorage.clear());

describe("useComposerIntegration — clipboard/duplicate seam (#255)", () => {
  it("handleCopy fills the controller's clipboard without touching the document", () => {
    const { result } = setup();
    act(() => result.current.handleCopy("B"));
    expect(result.current.controller.state.clipboard).toMatchObject({ id: "B", componentId: FIXTURE_IDS.box });
    expect(result.current.controller.state.document.root[0]!.slots.right).toHaveLength(2);
  });

  it("handleCut removes the node, fills the clipboard, and repairs selection", () => {
    const { result } = setup();
    act(() => result.current.handleCut("B"));
    expect(result.current.controller.state.document.root[0]!.slots.right.map((n: { id: string }) => n.id)).toEqual([
      "C",
    ]);
    expect(result.current.controller.state.clipboard).toMatchObject({ id: "B" });
  });

  it("handlePaste inserts a freshly-id'd clone at the target, selects, and reveals it", () => {
    const { result } = setup();
    act(() => result.current.handleCopy("B"));
    act(() =>
      result.current.handlePaste({ parentId: null, slotId: VIRTUAL_ROOT_SLOT_ID, index: 0 }),
    );
    const doc = result.current.controller.state.document;
    expect(doc.root).toHaveLength(2);
    const pastedId = doc.root[0]!.id;
    expect(pastedId).not.toBe("B");
    expect(doc.root[0]!.componentId).toBe(FIXTURE_IDS.box);
    expect(result.current.controller.state.selectedId).toBe(pastedId);
  });

  it("handleDuplicate inserts a sibling clone immediately after the source and selects it", () => {
    const { result } = setup();
    act(() => result.current.handleDuplicate("B"));
    const rightIds = result.current.controller.state.document.root[0]!.slots.right.map(
      (n: { id: string }) => n.id,
    );
    expect(rightIds[0]).toBe("B");
    expect(rightIds[2]).toBe("C");
    expect(result.current.controller.state.selectedId).toBe(rightIds[1]);
  });

  it("an incompatible paste target surfaces via controller.lastError, not a silent no-op", () => {
    const { result } = setup();
    act(() => result.current.handleCopy("B"));
    const before = result.current.controller.state.document;
    act(() => result.current.handlePaste({ parentId: "split", slotId: "left", index: 1 })); // single, occupied
    expect(result.current.controller.lastError).toMatch(/single-child/i);
    expect(result.current.controller.state.document).toBe(before);
  });

  it("copy/cut/duplicate are refused for an opaque node via controller.lastError", () => {
    const document = makeAbcDocument();
    document.root.push({ id: "ghost", componentId: "ghost.unknown", componentVersion: 1, props: {}, slots: {} });
    const { result } = setup(document);
    act(() => result.current.handleCopy("ghost"));
    expect(result.current.controller.lastError).toMatch(/unavailable/i);
    act(() => result.current.handleCut("ghost"));
    expect(result.current.controller.lastError).toMatch(/unavailable/i);
    act(() => result.current.handleDuplicate("ghost"));
    expect(result.current.controller.lastError).toMatch(/unavailable/i);
  });
});
