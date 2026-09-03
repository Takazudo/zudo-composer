/**
 * Roving-tabindex key math shared by SegmentedControl and PaneTabs.
 *
 * Kept as pure index arithmetic so both components can unit-test the wrapping
 * and disabled-skipping rules without a DOM.
 */

export type RovingOrientation = "horizontal" | "both";

export interface RovingOptions {
  /**
   * `"horizontal"` (tablist) answers only Left/Right; `"both"` (radio group)
   * also answers Up/Down, as the ARIA radio-group pattern expects.
   */
  orientation?: RovingOrientation;
  isDisabled?: (index: number) => boolean;
}

function seek(start: number, delta: number, count: number, enabled: (index: number) => boolean): number | null {
  for (let offset = 1; offset <= count; offset += 1) {
    const index = (((start + delta * offset) % count) + count) % count;
    if (enabled(index)) return index;
  }
  return null;
}

/** Returns the index the key should move to, or `null` when the key is not ours. */
export function nextRovingIndex(
  key: string,
  currentIndex: number,
  count: number,
  { orientation = "horizontal", isDisabled }: RovingOptions = {},
): number | null {
  if (count <= 0) return null;
  const enabled = (index: number) => !isDisabled?.(index);
  const vertical = orientation === "both";
  if (key === "ArrowRight" || (vertical && key === "ArrowDown")) return seek(currentIndex, 1, count, enabled);
  if (key === "ArrowLeft" || (vertical && key === "ArrowUp")) return seek(currentIndex, -1, count, enabled);
  if (key === "Home") return seek(-1, 1, count, enabled);
  if (key === "End") return seek(count, -1, count, enabled);
  return null;
}
