import { buttonClass } from "./chrome";
import { WORDMARKS, Wordmark } from "./icons";
import { Picture } from "./layout";

/** Splits `heading` around the first occurrence of `emphasis`; null when there is nothing to emphasise. */
export function splitEmphasis(heading: string, emphasis: string): [string, string, string] | null {
  if (!emphasis) return null;
  const at = heading.indexOf(emphasis);
  if (at < 0) return null;
  return [heading.slice(0, at), emphasis, heading.slice(at + emphasis.length)];
}

export interface HeroProps {
  eyebrow: string;
  heading: string;
  emphasis: string;
  lead: string;
  primaryLabel: string;
  primaryHref: string;
  secondaryLabel: string;
  secondaryHref: string;
  src: string;
  alt: string;
}

export function Hero({ eyebrow, heading, emphasis, lead, primaryLabel, primaryHref, secondaryLabel, secondaryHref, src, alt }: HeroProps) {
  const parts = splitEmphasis(heading, emphasis);
  return (
    <section class="grid items-center gap-land-vsp-lg pt-land-vsp-2xl land-md:grid-cols-2 land-md:gap-land-hsp-lg land-xl:gap-land-hsp-2xl">
      <div class="flex flex-col items-start gap-land-vsp-md">
        <div class="flex flex-col gap-land-vsp-sm">
          {eyebrow && <p class="text-land-caption uppercase tracking-land-caps text-land-muted">{eyebrow}</p>}
          <h1 class="text-land-display-compact tracking-land-tight text-land-fg-strong land-md:text-land-display">
            {parts ? <>{parts[0]}<span class="text-land-accent">{parts[1]}</span>{parts[2]}</> : heading}
          </h1>
          {lead && <p class="text-land-lead text-land-fg">{lead}</p>}
        </div>
        <div class="flex flex-wrap gap-land-hsp-sm">
          {primaryLabel && <a href={primaryHref || undefined} class={buttonClass("primary", "lg")}>{primaryLabel}</a>}
          {secondaryLabel && <a href={secondaryHref || undefined} class={buttonClass("secondary", "lg")}>{secondaryLabel}</a>}
        </div>
      </div>
      <Picture src={src} alt={alt} class="aspect-16/10 w-full rounded-land-md border border-land-border shadow-land-hero" />
    </section>
  );
}

export interface LogoStripProps {
  caption: string;
  count: number;
}

export function LogoStrip({ caption, count }: LogoStripProps) {
  const shown = WORDMARKS.slice(0, Math.min(6, Math.max(3, Math.round(count))));
  return (
    <section class="mt-land-vsp-xl flex flex-col items-center gap-land-vsp-md bg-land-surface-2 px-land-hsp-md py-land-vsp-md land-lg:px-land-hsp-xl">
      {caption && <p class="text-land-caption uppercase tracking-land-caps text-land-muted">{caption}</p>}
      <ul class="flex flex-wrap items-center justify-center gap-x-land-hsp-xl gap-y-land-vsp-sm">
        {shown.map((mark) => <li key={mark.name}><Wordmark {...mark} /></li>)}
      </ul>
    </section>
  );
}
