/** @jsxRuntime automatic */
/** @jsxImportSource preact */
import "../../../test-support/cleanup";
// Focus/caret-retention regression coverage for the inspector's controlled
// fields (issue #249). The concrete bug this guards against: a text/number
// input whose `value` is re-derived straight from the document on every
// render loses its in-progress edit (or gets reset mid-type) the instant a
// SIBLING field's commit — or an external document change (another tab, a
// reload) — causes a rerender while this field is still focused.
//
// Assertions center on the DRAFT text / validity staying put while focused
// (the `focusedRef` guard in use-text-field.ts / use-numeric-field.ts is
// driven by explicit focus/blur DOM events, not by `document.activeElement`
// bookkeeping, so that's what these tests exercise directly rather than
// relying on a test environment's synthetic-click-to-focus behavior).

import { useState } from "preact/hooks";
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/preact";
import type { CompositionDocument, JsonObject } from "../../../../../composer/browser";
import { TEST_COMPONENT_IDS, makeDocument, makeNode, resetTestIds, testManifest } from "../../test-support/composer-fixtures";
import { InspectorPanel } from "../inspector-panel";

function widgetDocument(): CompositionDocument {
  return makeDocument([
    makeNode(
      TEST_COMPONENT_IDS.widget,
      { title: "Untitled", note: "n", enabled: true, count: 3, variant: "solid", tint: "#336699" },
      {},
      "w",
    ),
  ]);
}

/** Test harness: a stateful parent that can apply BOTH a field's own commit
 * (via InspectorPanel's onUpdateProps) and an "external" patch that bypasses
 * the field entirely — simulating another tab / a reload changing the same
 * document out from under the currently-focused field. */
function Harness() {
  const [doc, setDoc] = useState<CompositionDocument>(widgetDocument);

  function patch(nodeId: string, props: JsonObject): void {
    setDoc((prev) => ({
      ...prev,
      root: prev.root.map((n) => (n.id === nodeId ? { ...n, props: { ...n.props, ...props } } : n)),
    }));
  }

  return (
    <div>
      <button type="button" onClick={() => patch("w", { count: 7 })}>
        simulate external count change
      </button>
      <InspectorPanel
        document={doc}
        manifest={testManifest}
        selectedId="w"
        mode="edit"
        onUpdateProps={patch}
        onRemove={() => {}}
      />
    </div>
  );
}

beforeEach(() => {
  resetTestIds();
});

describe("Inspector field focus retention", () => {
  it("focusing a field is reflected as the active element", () => {
    render(<Harness />);
    const titleInput = screen.getByLabelText("Title") as HTMLInputElement;
    titleInput.focus();
    expect(document.activeElement).toBe(titleInput);
  });

  it("keeps a text field's in-progress draft intact across a sibling field's commit-triggered rerender", () => {
    render(<Harness />);
    const titleInput = screen.getByLabelText("Title") as HTMLInputElement;
    titleInput.focus();
    fireEvent.input(titleInput, { target: { value: "Draft in progress" } });
    expect(titleInput.value).toBe("Draft in progress");

    // A DIFFERENT field's commit rebuilds the whole document tree (new
    // `document`/`props` object identity) while Title is still focused.
    fireEvent.click(screen.getByLabelText("Enabled"));

    expect(titleInput.value).toBe("Draft in progress");
  });

  it("does not clobber an in-progress invalid numeric draft when the underlying value changes externally while focused", () => {
    render(<Harness />);
    const countInput = screen.getByLabelText("Count") as HTMLInputElement;
    countInput.focus();
    // 12 is above the field's max (10) — invalid, held locally, never committed.
    fireEvent.input(countInput, { target: { value: "12" } });
    expect(countInput).toHaveAttribute("aria-invalid", "true");
    expect(countInput.value).toBe("12");

    // Someone else changes `count` to 7 while this field is still focused.
    fireEvent.click(screen.getByText("simulate external count change"));

    // The user's in-progress (invalid) draft is NOT stomped while focused.
    expect(countInput.value).toBe("12");
    expect(countInput).toHaveAttribute("aria-invalid", "true");

    // Only once the user disengages does the field resync — to the LATEST value.
    fireEvent.blur(countInput);
    expect(countInput.value).toBe("7");
    expect(countInput).not.toHaveAttribute("aria-invalid", "true");
  });

  it("resyncs a text field to an externally-changed document while it is NOT focused", () => {
    render(<Harness />);
    const titleInput = screen.getByLabelText("Title") as HTMLInputElement;
    expect(titleInput.value).toBe("Untitled");
    fireEvent.click(screen.getByText("simulate external count change"));
    // Title itself didn't change, but the whole document object did — this
    // proves the unfocused sync effect tolerates an unrelated document swap
    // without erroring or clearing the field.
    expect(titleInput.value).toBe("Untitled");
  });
});
