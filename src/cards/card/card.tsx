import type { ComponentChildren } from "preact";
import { cx } from "../../lib/cx";

export type CardVariant = "default" | "accent" | "muted";
export type CardPadding = "sm" | "md" | "lg";

export type CardProps = {
  /** Optional heading, rendered above children via Card.Title. */
  title?: string;
  variant?: CardVariant;
  padding?: CardPadding;
  class?: string;
  children?: ComponentChildren;
};

const PADDING_CLASS: Record<CardPadding, string> = {
  sm: "px-hsp-md py-vsp-sm",
  md: "px-hsp-lg py-vsp-md",
  lg: "px-hsp-xl py-vsp-lg",
};

const VARIANT_CLASS: Record<CardVariant, string> = {
  // Flat card: bg + a thin border all around.
  default: "bg-bg border border-border",
  // Sits on the surface tint instead of bg — a subdued companion card.
  muted: "bg-surface border border-border",
  // bg + a thicker accent-colored top rule — a highlighted card.
  accent: "bg-bg border border-border border-t-2 border-t-accent",
};

/**
 * Flat surface container: background + border + rounded corners, no shadow.
 * `variant="accent"` adds a top accent rule for a highlighted card;
 * `variant="muted"` sits on the surface tint for a secondary card.
 */
export function Card({
  title,
  variant = "default",
  padding = "md",
  class: cls,
  children,
}: CardProps) {
  return (
    <div class={cx("rounded-md", VARIANT_CLASS[variant], PADDING_CLASS[padding], cls)}>
      {title && <CardTitle>{title}</CardTitle>}
      <div class="text-small text-fg">{children}</div>
    </div>
  );
}

export type CardTitleProps = {
  class?: string;
  children?: ComponentChildren;
};

/** Heading row inside a Card. Also what the `title` prop renders through. */
export function CardTitle({ class: cls, children }: CardTitleProps) {
  return <h3 class={cx("text-title font-semibold text-fg mb-vsp-xs", cls)}>{children}</h3>;
}

Card.Title = CardTitle;
