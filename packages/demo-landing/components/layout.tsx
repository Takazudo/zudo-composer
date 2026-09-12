import type { ComponentChildren } from "preact";

export interface ContainerProps {
  width: "page" | "narrow";
  content?: ComponentChildren;
}

export function Container({ width, content }: ContainerProps) {
  const max = width === "narrow" ? "max-w-land-narrow" : "max-w-land-page";
  return <div class={`mx-auto w-full px-land-hsp-md land-lg:px-land-hsp-xl ${max}`}>{content}</div>;
}

const STACK_GAP = { xs: "gap-land-vsp-xs", sm: "gap-land-vsp-sm", md: "gap-land-vsp-md", lg: "gap-land-vsp-lg" } as const;

export interface StackProps {
  gap: keyof typeof STACK_GAP;
  align: "start" | "center";
  content?: ComponentChildren;
}

export function Stack({ gap, align, content }: StackProps) {
  const alignment = align === "center" ? "items-center text-center" : "items-stretch";
  return <div class={`flex flex-col ${STACK_GAP[gap]} ${alignment}`}>{content}</div>;
}

export interface GridProps {
  columns: "2" | "3";
  gap: "md" | "lg";
  items?: ComponentChildren;
}

export function Grid({ columns, gap, items }: GridProps) {
  const cols = columns === "3" ? "land-sm:grid-cols-2 land-lg:grid-cols-3" : "land-sm:grid-cols-2";
  const spacing = gap === "lg" ? "gap-land-hsp-lg" : "gap-land-hsp-md";
  return <div class={`grid ${spacing} ${cols}`}>{items}</div>;
}

export interface SplitProps {
  ratio: "1/1" | "2/3";
  reverse: boolean;
  media?: ComponentChildren;
  copy?: ComponentChildren;
}

export function Split({ ratio, reverse, media, copy }: SplitProps) {
  const cols = ratio === "2/3" ? "land-md:grid-cols-[2fr_3fr]" : "land-md:grid-cols-2";
  return (
    <div class={`grid items-center gap-land-vsp-md land-md:gap-land-hsp-lg land-lg:gap-land-hsp-xl ${cols}`}>
      <div class={reverse ? "land-md:order-last" : undefined}>{media}</div>
      <div class="flex flex-col gap-land-vsp-sm">{copy}</div>
    </div>
  );
}

export interface SectionProps {
  anchor: string;
  band: boolean;
  content?: ComponentChildren;
}

/**
 * A section only adds space above itself, so consecutive sections sit exactly
 * one `vsp-xl` apart; a band carries its own padding inside the grey ground.
 */
export function Section({ anchor, band, content }: SectionProps) {
  const spacing = band ? "mt-land-vsp-xl bg-land-surface-2 px-land-hsp-md py-land-vsp-xl land-lg:px-land-hsp-xl" : "pt-land-vsp-xl";
  return <section id={anchor || undefined} class={`flex scroll-mt-land-nav-h flex-col gap-land-vsp-lg ${spacing}`}>{content}</section>;
}

export interface SectionHeadingProps {
  eyebrow: string;
  heading: string;
  intro: string;
  as: "h1" | "h2";
  align: "start" | "center";
}

export function SectionHeading({ eyebrow, heading, intro, as, align }: SectionHeadingProps) {
  const Tag = as;
  const size = as === "h1" ? "text-land-h1-compact land-md:text-land-h1" : "text-land-h2-compact land-md:text-land-h2";
  const alignment = align === "center" ? "mx-auto items-center text-center" : "items-start";
  return (
    <div class={`flex max-w-land-narrow flex-col gap-land-vsp-xs ${alignment}`}>
      {eyebrow && <p class="text-land-caption uppercase tracking-land-caps text-land-muted">{eyebrow}</p>}
      <Tag class={`${size} tracking-land-tight text-land-fg-strong`}>{heading}</Tag>
      {intro && <p class="mt-land-vsp-xs text-land-lead text-land-fg">{intro}</p>}
    </div>
  );
}

/** An `<img>` with an empty-source placeholder, so a fresh node never shows a broken image. */
export function Picture({ src, alt, class: className }: { src: string; alt: string; class: string }) {
  if (!src) return <div role="img" aria-label={alt || undefined} class={`bg-land-surface ${className}`} />;
  return <img src={src} alt={alt} loading="lazy" class={`object-cover ${className}`} />;
}

const ASPECT = { "16/10": "aspect-16/10", "4/3": "aspect-4/3", "1/1": "aspect-square" } as const;

export interface ImageProps {
  src: string;
  alt: string;
  aspect: keyof typeof ASPECT;
}

export function Image({ src, alt, aspect }: ImageProps) {
  return (
    <figure>
      <Picture src={src} alt={alt} class={`w-full rounded-land-md border border-land-border ${ASPECT[aspect]}`} />
    </figure>
  );
}
