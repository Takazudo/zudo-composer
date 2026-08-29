// Which way a slot's children flow — the only thing the renderer needs in order
// to pick an insert point's shape (a full-width horizontal RULE between stacked
// children, or a full-height vertical BAR between side-by-side ones).
//
// This is a PRESENTATION heuristic, deliberately not persisted state. The #244
// authoring contract carries no flow metadata (`ComposerSlot` is id / prop /
// label / accepts / cardinality), and inventing one just to orient a UI
// affordance would put a rendering detail into a persisted document key. So the
// orientation is derived from what the document already says:
//
//   - a component whose slot is laid out on a row REGARDLESS of props
//     (`ui.auto-grid` is a CSS grid) → horizontal;
//   - a component with an explicit direction prop set to "horizontal"
//     (`ui.stack`) → horizontal;
//   - everything else → vertical (block flow).
//
// If the authoring contract ever gains a real `flow` field, delete this and read
// it from the slot descriptor.

import type { CompositionNode } from "../../../composer";

export type SlotFlow = "vertical" | "horizontal";

/** Components whose slot children always sit on a row, whatever their props. */
const ALWAYS_HORIZONTAL_COMPONENT_IDS: ReadonlySet<string> = new Set(["ui.auto-grid"]);

/** The prop a container uses to declare its own main axis (`ui.stack`). */
const DIRECTION_PROP = "direction";

export function slotFlow(node: CompositionNode): SlotFlow {
  if (ALWAYS_HORIZONTAL_COMPONENT_IDS.has(node.componentId)) return "horizontal";
  if (node.props[DIRECTION_PROP] === "horizontal") return "horizontal";
  return "vertical";
}
