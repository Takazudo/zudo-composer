import { defineComponent } from "@zudo-composer/component-contract";
import { CAPS, PRIMARY_CTA, SECONDARY_CTA } from "./tone";

export interface HeroProps {
  src: string;
  alt: string;
  eyebrow: string;
  heading: string;
  lead: string;
  primaryLabel: string;
  primaryHref: string;
  secondaryLabel: string;
  secondaryHref: string;
  variant: "display" | "compact";
}

/** `*word*` in a display heading is the home hero's one emphasised (accent) word. */
export function renderHeading(heading: string, emphasis: boolean) {
  return heading.split(/\*([^*]+)\*/).map((part, index) =>
    index % 2 === 1 ? (emphasis ? <span key={index} class="text-shop-accent">{part}</span> : part) : part,
  );
}

export function Hero({
  src = "",
  alt = "",
  eyebrow = "",
  heading = "Objects for quiet work",
  lead = "",
  primaryLabel = "",
  primaryHref = "#",
  secondaryLabel = "",
  secondaryHref = "#",
  variant = "display",
}: HeroProps) {
  const display = variant === "display";
  return (
    <section class="flex flex-col gap-shop-vsp-md">
      {src !== "" && (
        <img src={src} alt={alt} class={`block w-full bg-shop-surface object-cover ${display ? "aspect-video max-h-[70vh]" : "aspect-[3/1] max-h-[40vh]"}`} />
      )}
      <div class="mx-auto flex w-full max-w-shop-page flex-col gap-shop-vsp-sm px-shop-hsp-md shop-md:px-shop-hsp-lg shop-xl:px-shop-hsp-2xl">
        {eyebrow !== "" && <p class={`${CAPS} text-shop-muted`}>{eyebrow}</p>}
        <h1
          class={`font-shop-semibold text-shop-fg-strong ${display ? "text-shop-h1 shop-md:text-shop-display tracking-shop-tight" : "text-shop-h1"}`}
        >
          {renderHeading(heading, display)}
        </h1>
        {lead !== "" && <p class="max-w-shop-prose whitespace-pre-line text-shop-lead text-shop-fg">{lead}</p>}
        {(primaryLabel !== "" || secondaryLabel !== "") && (
          <div class="flex flex-wrap gap-shop-hsp-sm pt-shop-vsp-xs">
            {primaryLabel !== "" && <a href={primaryHref} class={PRIMARY_CTA}>{primaryLabel}</a>}
            {secondaryLabel !== "" && <a href={secondaryHref} class={SECONDARY_CTA}>{secondaryLabel}</a>}
          </div>
        )}
      </div>
    </section>
  );
}

export const heroComponent = defineComponent<HeroProps>()(Hero, {
  id: "shop.hero",
  schemaVersion: 1,
  title: "Hero",
  category: "Content",
  description: "Full-bleed image with eyebrow, heading, lead and up to two actions; wrap one heading word in *asterisks* to emphasise it.",
  source: { module: "demo-webshop/components", exportKind: "named", exportName: "Hero" },
  defaults: {
    src: "",
    alt: "",
    eyebrow: "",
    heading: "Objects for quiet work",
    lead: "",
    primaryLabel: "",
    primaryHref: "#",
    secondaryLabel: "",
    secondaryHref: "#",
    variant: "display",
  },
  fields: [
    { kind: "text", prop: "src", label: "Image URL" },
    { kind: "text", prop: "alt", label: "Image alt" },
    { kind: "text", prop: "eyebrow", label: "Eyebrow" },
    { kind: "text", prop: "heading", label: "Heading", inlineEdit: { multiline: false } },
    { prop: "lead", label: "Lead", schema: { type: "string" }, editor: { kind: "text", multiline: true } },
    { kind: "text", prop: "primaryLabel", label: "Primary label" },
    { kind: "text", prop: "primaryHref", label: "Primary URL" },
    { kind: "text", prop: "secondaryLabel", label: "Secondary label" },
    { kind: "text", prop: "secondaryHref", label: "Secondary URL" },
    { kind: "select", prop: "variant", label: "Variant", options: ["display", "compact"] },
  ],
  adapters: {
    inlineEditor: { field: "heading", resolveElement: (root: HTMLElement) => root.querySelector<HTMLHeadingElement>("h1") },
  },
});
