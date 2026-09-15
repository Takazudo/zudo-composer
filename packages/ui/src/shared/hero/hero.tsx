import type { ComponentChildren, JSX } from "preact";
import { cx } from "../../lib/cx";
import { Container } from "../container/container";
import { CtaButton, type CtaButtonVariant } from "../cta-button/cta-button";

export type HeroAction = { label: string; href: string; variant?: CtaButtonVariant };
export type HeroVariant = "primary" | "secondary";

// Soft accent wash (6% accent mixed into bg) so the band reads as a distinct
// section without a hard-coded color — follows the active color scheme.
const HERO_STYLE: JSX.CSSProperties = {
  backgroundColor: "color-mix(in srgb, var(--color-accent) 6%, var(--color-bg))",
};

// Heading max-width and clamp ceiling are literal per variant — Tailwind v4
// only scans literal class strings in source, so `max-w-[${n}ch]` can't be
// composed dynamically.
const HEADING_MAXW: Record<HeroVariant, string> = {
  primary: "max-w-[20ch]",
  secondary: "max-w-[24ch]",
};

const HEADING_CLAMP_MAX: Record<HeroVariant, string> = {
  primary: "4rem",
  secondary: "3.5rem",
};

export type HeroProps = {
  eyebrow?: string;
  heading?: ComponentChildren;
  lead?: ComponentChildren;
  actions?: HeroAction[];
  /** Heading scale: `primary` for a page's main hero, `secondary` for a smaller section hero. */
  variant?: HeroVariant;
  class?: string;
};

/**
 * First-view hero band: eyebrow + display heading + lead + CTA row over a
 * soft accent-tinted background. Heading always renders as `<h1>` — mount at
 * most one per page.
 */
export function Hero({
  eyebrow,
  heading,
  lead,
  actions = [],
  variant = "primary",
  class: cls,
}: HeroProps) {
  return (
    <section class={cx("w-full", cls)} style={HERO_STYLE} aria-label="Hero">
      <Container class="py-vsp-2xl">
        {eyebrow && (
          <p class="text-caption font-semibold uppercase tracking-wide text-accent">{eyebrow}</p>
        )}
        {heading && (
          <h1
            class={cx("mt-vsp-sm", HEADING_MAXW[variant], "font-bold leading-tight text-fg")}
            style={{
              fontSize: `clamp(var(--text-display), 1.6rem + 3.4vw, ${HEADING_CLAMP_MAX[variant]})`,
              textWrap: "balance",
            }}
          >
            {heading}
          </h1>
        )}
        {lead && (
          <p
            class="mt-vsp-md max-w-[44rem] text-title leading-relaxed text-fg"
            style={{ textWrap: "pretty" }}
          >
            {lead}
          </p>
        )}

        {actions.length > 0 && (
          <div class="mt-vsp-lg flex flex-wrap gap-x-hsp-md gap-y-vsp-xs">
            {actions.map((action) => (
              <CtaButton
                key={action.href + action.label}
                href={action.href}
                variant={action.variant ?? "primary"}
              >
                {action.label}
              </CtaButton>
            ))}
          </div>
        )}
      </Container>
    </section>
  );
}
