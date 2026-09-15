import type { ComponentChildren } from "preact";
import { cx } from "../../lib/cx";

export type SectionHeadingProps = {
  /** Small label above the heading. */
  eyebrow?: string;
  heading: string;
  /** Supporting copy below the heading. */
  intro?: ComponentChildren;
  /** Heading element. Defaults to h2; use h1 only for a page's main heading. */
  as?: "h1" | "h2";
  class?: string;
};

/**
 * Section header block: optional eyebrow, heading, and an optional intro
 * paragraph. Also covers hero/band-style "eyebrow + heading + lead" headers.
 */
export function SectionHeading({
  eyebrow,
  heading,
  intro,
  as = "h2",
  class: cls,
}: SectionHeadingProps) {
  const Heading = as;
  return (
    <div class={cls}>
      {eyebrow && (
        <p class="text-caption font-semibold uppercase tracking-wide text-accent">{eyebrow}</p>
      )}
      <Heading
        class={cx(eyebrow && "mt-vsp-xs", "text-heading font-bold leading-tight text-fg")}
        style={{ textWrap: "balance" }}
      >
        {heading}
      </Heading>
      {intro && (
        <p
          class="mt-vsp-sm max-w-[44rem] text-small leading-relaxed text-fg"
          style={{ textWrap: "pretty" }}
        >
          {intro}
        </p>
      )}
    </div>
  );
}
