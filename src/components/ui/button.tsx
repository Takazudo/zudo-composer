import { computed, Show } from "@takazudo/zfb/zudo-react";
import { LoadingIcon } from "../icons";
import { read, type MaybeSignal } from "../reactive";
import { cx } from "./class-names";
import type { NativeProps } from "./class-names";
import { useElementRef, type ElementRef } from "./form-controls";

export type ButtonVariant = "default" | "primary" | "ghost" | "danger";
export type ButtonSize = "xs" | "sm" | "md";

type NativeButtonProps = Omit<NativeProps<HTMLButtonElement>, "disabled">;

interface ButtonBaseProps extends NativeButtonProps {
  variant?: ButtonVariant;
  /** Shows a decorative spinner and prevents activation while work is running. */
  busy?: MaybeSignal<boolean | undefined>;
  disabled?: MaybeSignal<boolean | null | undefined>;
  /** `md` 30px (default), `sm` 26px, `xs` 22px — the chrome control ladder. */
  size?: ButtonSize;
  /**
   * Ref onto the rendered `<button>`. Components take no `ref`, so menu
   * triggers (`createMenu`) and focus targets take the element through this
   * prop instead of hand-rolling a raw `<button class="cms-btn">`.
   */
  elementRef?: ElementRef<HTMLButtonElement>;
}

/**
 * An icon-only button renders no text, so `aria-label` is required at the type
 * level rather than left to a lint rule.
 */
export type ButtonProps =
  | (ButtonBaseProps & { iconOnly: true; "aria-label": MaybeSignal<string> })
  | (ButtonBaseProps & { iconOnly?: false });

export function Button(props: ButtonProps) {
  const { variant = "default", size = "md", iconOnly = false, class: className, type = "button", elementRef, busy = false, disabled, children, ...rest } = props;
  const ariaBusy = (rest as Record<string, unknown>)["aria-busy"] as MaybeSignal<string | number | boolean | null | undefined>;
  const ref = useElementRef(elementRef);
  const busyNow = computed(() => Boolean(read(busy)));
  return (
    <button
      ref={ref}
      type={type}
      class={cx(
        "cms-btn",
        variant !== "default" && `cms-btn--${variant}`,
        size !== "md" && `cms-btn--${size}`,
        iconOnly && "cms-btn--icon",
        className,
      )}
      {...(rest as unknown as Record<string, never>)}
      disabled={computed(() => busyNow.value || Boolean(read(disabled)))}
      aria-busy={computed(() => (busyNow.value ? true : read(ariaBusy)))}
    >
      <Show when={busyNow}>{() => <LoadingIcon size="sm" class="cms-btn__spinner" />}</Show>
      {children}
    </button>
  );
}
