import { computed, type Child } from "@takazudo/zfb/zudo-react";
import type { IconComponent } from "../icons";
import { read, type MaybeSignal } from "../reactive";
import { Button } from "../ui";

// The bulk action bar (issue #164).
//
// Actions are SUPPLIED BY THE ROUTE, never listed here: Delete is the only one
// every library has, and Duplicate exists on Compositions alone. A bar that
// shipped a fixed vocabulary would put dead controls on the other routes.
//
// It renders as a fragment because `DataTable` already provides the bar's box
// through its `bulkBar` slot — `LibraryTable` wires the two together.

export interface BulkAction {
  readonly id: string;
  readonly label: string;
  readonly icon?: IconComponent;
  readonly tone?: "default" | "danger";
  readonly disabled?: MaybeSignal<boolean>;
  readonly onSelect: () => void;
}

export interface BulkBarProps {
  readonly count: MaybeSignal<number>;
  readonly actions: readonly BulkAction[];
  onClear: () => void;
  /** Overrides `{n} selected` — routes name their records ("2 compositions"). */
  describeCount?: (count: number) => string;
  clearLabel?: string;
}

export function BulkBar({ count, actions, onClear, describeCount, clearLabel = "Clear selection" }: BulkBarProps): Child {
  const countText = computed(() => {
    const value = read(count);
    return describeCount ? describeCount(value) : `${value} selected`;
  });
  return (
    <>
      <strong class="cms-library-bulk__count">{countText}</strong>
      {actions.map((action) => {
        const Icon = action.icon;
        return (
          <Button
            key={action.id}
            size="sm"
            variant={action.tone === "danger" ? "danger" : "default"}
            disabled={action.disabled}
            on:click={() => action.onSelect()}
          >
            {Icon ? <Icon size="sm" /> : null}
            {action.label}
          </Button>
        );
      })}
      <Button size="sm" variant="ghost" class="cms-library-bulk__clear" on:click={() => onClear()}>
        {clearLabel}
      </Button>
    </>
  );
}
