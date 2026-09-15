import type { ComponentChildren } from "preact";
import { buttonClass } from "./chrome";
import { Icon, type IconName } from "./icons";
import { Picture } from "./layout";

const cardClass = "rounded-land-md border border-land-border bg-land-surface p-land-hsp-md";

export interface FeatureGridProps {
  columns: "2" | "3";
  items?: ComponentChildren;
}

export function FeatureGrid({ columns, items }: FeatureGridProps) {
  const cols = columns === "3" ? "land-sm:grid-cols-2 land-lg:grid-cols-3" : "land-sm:grid-cols-2";
  return <div class={`grid gap-land-hsp-md ${cols}`}>{items}</div>;
}

export interface FeatureItemProps {
  icon: IconName;
  title: string;
  body: string;
  emphasis: boolean;
}

export function FeatureItem({ icon, title, body, emphasis }: FeatureItemProps) {
  const chip = emphasis ? "bg-land-accent-soft" : "border border-land-border";
  return (
    <article class={`flex flex-col gap-land-vsp-sm ${cardClass}`}>
      <span class={`inline-flex size-land-chip items-center justify-center rounded-land-md text-land-muted ${chip}`}>
        <Icon name={icon} class="size-land-icon" />
      </span>
      <h3 class="text-land-h3 text-land-fg-strong">{title}</h3>
      <p class="text-land-body text-land-fg">{body}</p>
    </article>
  );
}

export interface StepsRowProps {
  steps?: ComponentChildren;
}

export function StepsRow({ steps }: StepsRowProps) {
  return <ol class="grid gap-land-vsp-md land-md:grid-cols-3 land-md:gap-land-hsp-md">{steps}</ol>;
}

export interface StepProps {
  number: number;
  title: string;
  body: string;
}

export function Step({ number, title, body }: StepProps) {
  return (
    <li class="flex flex-col gap-land-vsp-xs border-t border-land-border pt-land-vsp-sm">
      <span class="text-land-h2-compact tracking-land-tight text-land-fg-strong tabular-nums" aria-hidden="true">{String(number).padStart(2, "0")}</span>
      <h3 class="text-land-h3 text-land-fg-strong">{title}</h3>
      <p class="text-land-body text-land-fg">{body}</p>
    </li>
  );
}

export interface StatsProps {
  stat1Value: string;
  stat1Label: string;
  stat2Value: string;
  stat2Label: string;
  stat3Value: string;
  stat3Label: string;
}

export function Stats(props: StatsProps) {
  const stats = [
    [props.stat1Value, props.stat1Label],
    [props.stat2Value, props.stat2Label],
    [props.stat3Value, props.stat3Label],
  ].filter(([value]) => value);
  return (
    <dl class="grid gap-land-vsp-md text-center land-md:grid-cols-3">
      {stats.map(([value, label], index) => (
        <div key={index} class="flex flex-col-reverse gap-land-vsp-xs">
          <dt class="text-land-body text-land-muted">{label}</dt>
          <dd class="text-land-price tracking-land-tight text-land-fg-strong tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export interface CtaBandProps {
  heading: string;
  lead: string;
  buttonLabel: string;
  buttonHref: string;
}

export function CtaBand({ heading, lead, buttonLabel, buttonHref }: CtaBandProps) {
  return (
    <section class="mt-land-vsp-2xl flex flex-col items-center gap-land-vsp-md bg-land-surface-2 px-land-hsp-md py-land-vsp-xl text-center land-lg:px-land-hsp-xl">
      <div class="flex max-w-land-narrow flex-col gap-land-vsp-sm">
        <h2 class="text-land-h2-compact tracking-land-tight text-land-fg-strong land-md:text-land-h2">{heading}</h2>
        {lead && <p class="text-land-lead text-land-fg">{lead}</p>}
      </div>
      {buttonLabel && <a href={buttonHref || undefined} class={buttonClass("primary", "lg")}>{buttonLabel}</a>}
    </section>
  );
}

export interface TestimonialsProps {
  testimonials?: ComponentChildren;
}

export function Testimonials({ testimonials }: TestimonialsProps) {
  return <div class="grid gap-land-hsp-md land-md:grid-cols-3">{testimonials}</div>;
}

export interface TestimonialProps {
  quote: string;
  name: string;
  role: string;
  src: string;
  alt: string;
  /** Sort key the Mapping query orders by; the list keeps DOM order. */
  order: number;
}

export function Testimonial({ quote, name, role, src, alt }: TestimonialProps) {
  return (
    <figure class={`flex flex-col justify-between gap-land-vsp-md ${cardClass}`}>
      <blockquote class="text-land-lead text-land-fg">{quote}</blockquote>
      <figcaption class="flex items-center gap-land-hsp-sm">
        <Picture src={src} alt={alt} class="size-land-avatar shrink-0 rounded-land-md" />
        <span class="flex flex-col">
          <span class="text-land-body font-land-semibold text-land-fg-strong">{name}</span>
          {role && <span class="text-land-caption text-land-muted">{role}</span>}
        </span>
      </figcaption>
    </figure>
  );
}
