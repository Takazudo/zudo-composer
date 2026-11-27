import { computed } from "@takazudo/zfb/zudo-react";
import { read, type MaybeSignal } from "../reactive";
import { cx } from "./class-names";
import type { NativeProps } from "./class-names";

export interface CountBadgeProps extends Omit<NativeProps<HTMLSpanElement>, "children" | "max"> {
  count: MaybeSignal<number>;
  /** Counts above this render as `{max}+`, keeping the badge one row wide. */
  max?: number;
}

export function CountBadge({ count, max = 999, class: className, ...rest }: CountBadgeProps) {
  const text = computed(() => {
    const value = read(count);
    return value > max ? `${max}+` : String(value);
  });
  return (
    <span class={cx("cms-count-badge", className)} {...rest}>
      {text}
    </span>
  );
}

export type KbdProps = NativeProps<HTMLElement>;

export function Kbd({ class: className, children, ...rest }: KbdProps) {
  return (
    <kbd class={cx("cms-kbd", className)} {...rest}>
      {children}
    </kbd>
  );
}
