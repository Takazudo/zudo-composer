import type { JSX } from "preact";
import { cx } from "./class-names";
import type { WithPlainClass } from "./class-names";

export interface CountBadgeProps extends WithPlainClass<Omit<JSX.IntrinsicElements["span"], "ref">> {
  count: number;
  /** Counts above this render as `{max}+`, keeping the badge one row wide. */
  max?: number;
}

export function CountBadge({ count, max = 999, class: className, ...rest }: CountBadgeProps) {
  return (
    <span class={cx("cms-count-badge", className)} {...rest}>
      {count > max ? `${max}+` : String(count)}
    </span>
  );
}

export type KbdProps = WithPlainClass<Omit<JSX.IntrinsicElements["kbd"], "ref">>;

export function Kbd({ class: className, children, ...rest }: KbdProps) {
  return (
    <kbd class={cx("cms-kbd", className)} {...rest}>
      {children}
    </kbd>
  );
}
