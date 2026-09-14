/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// The canvas quick insert: when an insertion point sits in a restricted slot
// with only a few allowed kinds, those kinds are offered as chips right at the
// insertion point instead of opening the full chooser.
//
// It renders INSIDE the shared `Menu` (the host owns positioning, Escape,
// outside-click and focus restoration), so every actionable element carries
// `role="menuitem"` to join the menu's roving focus.

import type { JSX } from "preact";
import { LockIcon, PlusIcon } from "../../../../components/icons";
import type { SlotRule } from "../slot-rules";

/** Above this many kinds the chip row is noise; the chooser's rule header covers it. */
export const QUICK_INSERT_MAX_KINDS = 6;

/** Whether an insertion into a slot with `rule` should offer chips instead of the chooser. */
export function offersQuickInsert(rule: SlotRule): boolean {
  return (
    rule.kind === "restricted" &&
    rule.accepts.length > 0 &&
    rule.accepts.length <= QUICK_INSERT_MAX_KINDS &&
    !rule.full &&
    rule.blockedReason === null
  );
}

/** The slot's display name, for the menu label and header. */
export function quickInsertSlotLabel(rule: SlotRule): string {
  return rule.origin?.slotLabel ?? "This slot";
}

export interface QuickInsertPopoverProps {
  rule: SlotRule;
  onInsert: (componentId: string) => void;
  /** Open the chooser on its Patterns tab for the same target. */
  onOpenPatterns: () => void;
  /** Open the full chooser for the same target. */
  onOpenChooser: () => void;
}

export function QuickInsertPopover({ rule, onInsert, onOpenPatterns, onOpenChooser }: QuickInsertPopoverProps): JSX.Element {
  const hidden = rule.hiddenByRule.length;
  return (
    <div class="sg-quick-insert">
      <div class="sg-quick-insert__head">
        <LockIcon size="xs" />
        <span>{quickInsertSlotLabel(rule)} accepts</span>
      </div>
      <div class="sg-quick-insert__chips">
        {rule.accepts.map((component) => (
          <button
            key={component.id}
            type="button"
            role="menuitem"
            tabIndex={-1}
            class="cms-chip sg-quick-insert__chip"
            onClick={() => onInsert(component.id)}
          >
            <PlusIcon size="xs" />
            {component.title}
          </button>
        ))}
        <button
          type="button"
          role="menuitem"
          tabIndex={-1}
          class="cms-chip sg-quick-insert__chip sg-quick-insert__chip--pattern"
          onClick={onOpenPatterns}
        >
          Pattern…
        </button>
      </div>
      <div class="sg-quick-insert__foot">
        {rule.origin && (
          <span class="sg-quick-insert__origin">
            rule: {rule.origin.componentTitle} › {rule.origin.slotLabel}
          </span>
        )}
        <button type="button" role="menuitem" tabIndex={-1} class="sg-quick-insert__more" onClick={onOpenChooser}>
          More… (search, {hidden} hidden)
        </button>
      </div>
    </div>
  );
}
