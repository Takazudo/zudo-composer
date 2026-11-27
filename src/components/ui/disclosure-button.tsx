import { computed, Show } from "@takazudo/zfb/zudo-react";
import { read, type MaybeSignal } from "../reactive";
import { Button, type ButtonProps } from "./button";
import { cx } from "./class-names";

export type DisclosureButtonProps = Omit<ButtonProps, "children" | "iconOnly" | "aria-expanded" | "aria-label"> & {
  expanded: MaybeSignal<boolean>;
  "aria-label": MaybeSignal<string>;
};

/** Shared square plus/minus expansion affordance, including shell disclosures. */
export function DisclosureButton({ expanded, class: className, ...props }: DisclosureButtonProps) {
  const open = computed(() => read(expanded));
  const closed = computed(() => !open.value);
  return (
    <Button {...props} iconOnly aria-expanded={open} class={cx("cms-disclosure", className)}>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
        <rect x="2" y="2" width="12" height="12" />
        <path d="M5 8h6" />
        <Show when={closed}>{() => <path d="M8 5v6" />}</Show>
      </svg>
    </Button>
  );
}
