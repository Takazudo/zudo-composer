/** @jsxRuntime automatic */
/** @jsxImportSource preact */
import "../../../test-support/cleanup";
// Inspector wiring for the debounced commit channel (issue #291).
//
// The panel/field layer itself never debounces — it ROUTES: keystream fields
// (text / color / number) commit through `onUpdatePropsDebounced`, discrete
// controls (checkbox / select) stay on the immediate `onUpdateProps` (a click
// is already a commit point, per the resizer's live-vs-commit philosophy),
// and blurring a keystream field calls `onFlushPendingProps` so a pending
// commit lands deterministically. Without the optional #291 props everything
// falls back to `onUpdateProps` — pinned here because focus-retention.test.tsx
// and inspector-panel.test.tsx rely on that presentational default.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/preact";
import type { CompositionDocument } from "../../../../../composer";
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

function renderPanel({ withDebouncedChannel = true } = {}) {
  const onUpdateProps = vi.fn();
  const onUpdatePropsDebounced = vi.fn();
  const onFlushPendingProps = vi.fn();
  render(
    <InspectorPanel
      document={widgetDocument()}
      manifest={testManifest}
      selectedId="w"
      mode="edit"
      onUpdateProps={onUpdateProps}
      onUpdatePropsDebounced={withDebouncedChannel ? onUpdatePropsDebounced : undefined}
      onFlushPendingProps={withDebouncedChannel ? onFlushPendingProps : undefined}
      onReorder={() => {}}
      onRemove={() => {}}
    />,
  );
  return { onUpdateProps, onUpdatePropsDebounced, onFlushPendingProps };
}

beforeEach(() => {
  resetTestIds();
});

describe("InspectorPanel — keystream vs discrete commit routing (#291)", () => {
  it("text keystrokes go through the debounced channel, never the immediate one", () => {
    const { onUpdateProps, onUpdatePropsDebounced } = renderPanel();
    fireEvent.input(screen.getByLabelText("Title"), { target: { value: "New title" } });
    expect(onUpdatePropsDebounced).toHaveBeenCalledWith("w", { title: "New title" });
    expect(onUpdateProps).not.toHaveBeenCalled();
  });

  it("color keystrokes go through the debounced channel", () => {
    const { onUpdateProps, onUpdatePropsDebounced } = renderPanel();
    fireEvent.input(screen.getByLabelText("Tint"), { target: { value: "#ff0000" } });
    expect(onUpdatePropsDebounced).toHaveBeenCalledWith("w", { tint: "#ff0000" });
    expect(onUpdateProps).not.toHaveBeenCalled();
  });

  it("valid numeric keystrokes go through the debounced channel", () => {
    const { onUpdateProps, onUpdatePropsDebounced } = renderPanel();
    fireEvent.input(screen.getByLabelText("Count"), { target: { value: "7" } });
    expect(onUpdatePropsDebounced).toHaveBeenCalledWith("w", { count: 7 });
    expect(onUpdateProps).not.toHaveBeenCalled();
  });

  it("a checkbox toggle is a discrete commit point — immediate channel, no debounce", () => {
    const { onUpdateProps, onUpdatePropsDebounced } = renderPanel();
    fireEvent.click(screen.getByLabelText("Enabled"));
    expect(onUpdateProps).toHaveBeenCalledWith("w", { enabled: false });
    expect(onUpdatePropsDebounced).not.toHaveBeenCalled();
  });

  it("a select change is a discrete commit point — immediate channel, no debounce", () => {
    const { onUpdateProps, onUpdatePropsDebounced } = renderPanel();
    fireEvent.change(screen.getByLabelText("Variant"), { target: { value: "ghost" } });
    expect(onUpdateProps).toHaveBeenCalledWith("w", { variant: "ghost" });
    expect(onUpdatePropsDebounced).not.toHaveBeenCalled();
  });

  it("blurring a text field lands the pending commit via onFlushPendingProps", () => {
    const { onFlushPendingProps } = renderPanel();
    const title = screen.getByLabelText("Title");
    fireEvent.input(title, { target: { value: "Half typed" } });
    expect(onFlushPendingProps).not.toHaveBeenCalled();
    fireEvent.blur(title);
    expect(onFlushPendingProps).toHaveBeenCalledTimes(1);
  });

  it("blurring a numeric field lands the pending commit via onFlushPendingProps", () => {
    const { onFlushPendingProps } = renderPanel();
    const count = screen.getByLabelText("Count");
    fireEvent.input(count, { target: { value: "7" } });
    fireEvent.blur(count);
    expect(onFlushPendingProps).toHaveBeenCalledTimes(1);
  });

  it("without the #291 props, keystream fields fall back to the immediate onUpdateProps", () => {
    const { onUpdateProps, onUpdatePropsDebounced } = renderPanel({ withDebouncedChannel: false });
    fireEvent.input(screen.getByLabelText("Title"), { target: { value: "Fallback" } });
    expect(onUpdateProps).toHaveBeenCalledWith("w", { title: "Fallback" });
    expect(onUpdatePropsDebounced).not.toHaveBeenCalled();
  });
});

describe("Numeric field dedupe inside the debounce window (#291)", () => {
  it("re-commits a correction that equals the STALE prop value (dedupes against the in-flight value instead)", () => {
    // The debounced channel means the `value` prop lags the keystream: the
    // harness never applies commits, exactly like mid-debounce-window state.
    const { onUpdatePropsDebounced } = renderPanel();
    const count = screen.getByLabelText("Count");

    fireEvent.input(count, { target: { value: "1" } });
    expect(onUpdatePropsDebounced).toHaveBeenNthCalledWith(1, "w", { count: 1 });

    fireEvent.input(count, { target: { value: "" } }); // invalid — held, not committed
    // Correcting back to "3" equals the stale prop value (3) but NOT the
    // in-flight 1 — swallowing it would flush 1 while the field shows 3.
    fireEvent.input(count, { target: { value: "3" } });
    expect(onUpdatePropsDebounced).toHaveBeenNthCalledWith(2, "w", { count: 3 });
  });

  it("still dedupes a keystroke that changes nothing (same parsed value as the document)", () => {
    const { onUpdatePropsDebounced } = renderPanel();
    const count = screen.getByLabelText("Count");
    fireEvent.input(count, { target: { value: "3" } }); // equals the committed value
    expect(onUpdatePropsDebounced).not.toHaveBeenCalled();
  });
});
