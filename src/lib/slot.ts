import type { Child } from "@takazudo/zfb/zudo-react";

/**
 * Slot prop type. The component contract types slot values structurally
 * (`object | bigint | scalar`, or an array of them), which is wider than
 * zudo-react's `Child`; renderers only ever pass `Child` values.
 */
export type SlotChildren = Child | object | bigint;

/** Narrows a slot value back to the `Child` the renderer passed in. */
export function slotChild(value: SlotChildren | undefined): Child {
  return value as Child;
}
