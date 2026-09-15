import type { ComponentChildren } from "preact";
import { cx } from "../../lib/cx";

export type CtaButtonVariant = "primary" | "secondary";

const VARIANT_CLASS: Record<CtaButtonVariant, string> = {
  // Filled accent; on-accent text via the inline color override below.
  primary: "bg-accent text-bg hover:bg-accent-hover border border-accent hover:border-accent-hover",
  // Outlined; hover fills with the surface tint.
  secondary: "bg-bg text-accent border border-border hover:border-accent hover:bg-surface",
};

// `.zd-content`'s prose stylesheet unlayers `a { color; text-decoration }`,
// which can outrank this component's layered utilities when it renders
// inside MDX body copy — pin color + textDecoration inline as a second guard.
const TEXT_COLOR: Record<CtaButtonVariant, string> = {
  primary: "var(--color-bg)",
  secondary: "var(--color-accent)",
};

export type CtaButtonProps = {
  href: string;
  variant?: CtaButtonVariant;
  /** Show the trailing arrow glyph. Defaults to true. */
  arrow?: boolean;
  class?: string;
  children?: ComponentChildren;
};

/** Accent-filled or outlined call-to-action link. */
export function CtaButton({
  href,
  variant = "primary",
  arrow = true,
  class: cls,
  children,
}: CtaButtonProps) {
  return (
    <a
      href={href}
      class={cx(
        "inline-flex items-center gap-x-hsp-xs rounded-md px-hsp-xl py-vsp-sm",
        "text-small font-semibold no-underline transition-colors",
        VARIANT_CLASS[variant],
        cls,
      )}
      style={{ textDecoration: "none", color: TEXT_COLOR[variant] }}
    >
      {/* Label wrapped so the Composer inline-editor can target a
          decoration-free region: editing the bare <a> would trap the
          trailing arrow inside the contenteditable host and break
          select-all/replace. See the composer inlineEditor adapter. */}
      <span data-cta-label>{children}</span>
      {arrow && <span aria-hidden="true">→</span>}
    </a>
  );
}
