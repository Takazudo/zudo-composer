import type { JSX } from "preact";
import { cx } from "./class-names";
import type { WithPlainClass } from "./class-names";

export type ButtonVariant = "default" | "primary" | "ghost" | "danger";
export type ButtonSize = "xs" | "sm" | "md";

type NativeButtonProps = WithPlainClass<Omit<JSX.IntrinsicElements["button"], "size" | "ref">>;

interface ButtonBaseProps extends NativeButtonProps {
  variant?: ButtonVariant;
  /** `md` 30px (default), `sm` 26px, `xs` 22px — the chrome control ladder. */
  size?: ButtonSize;
}

/**
 * An icon-only button renders no text, so `aria-label` is required at the type
 * level rather than left to a lint rule.
 */
export type ButtonProps =
  | (ButtonBaseProps & { iconOnly: true; "aria-label": string })
  | (ButtonBaseProps & { iconOnly?: false });

export function Button(props: ButtonProps) {
  const { variant = "default", size = "md", iconOnly = false, class: className, type = "button", ...rest } = props;
  return (
    <button
      type={type}
      class={cx(
        "cms-btn",
        variant !== "default" && `cms-btn--${variant}`,
        size !== "md" && `cms-btn--${size}`,
        iconOnly && "cms-btn--icon",
        className,
      )}
      {...rest}
    />
  );
}
