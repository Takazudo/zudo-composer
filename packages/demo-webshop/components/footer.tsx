import { defineComponent } from "@zudo-composer/component-contract";
import type { ComponentChildren } from "preact";
import { HOVER_INVERT } from "./tone";

export interface FooterProps {
  smallPrint: string;
  creditLabel: string;
  creditHref: string;
  nav?: ComponentChildren;
}

export function Footer({
  smallPrint = "Nightjar Supply is a demo shop. Nothing here is for sale.",
  creditLabel = "Built with zudo-composer",
  creditHref = "https://github.com/Takazudo/zudo-composer",
  nav,
}: FooterProps) {
  return (
    <footer class="mt-shop-vsp-2xl border-t border-shop-border bg-shop-bg">
      <div class="mx-auto grid max-w-shop-page grid-cols-1 gap-shop-vsp-md px-shop-hsp-md py-shop-vsp-lg shop-md:grid-cols-3 shop-md:gap-shop-hsp-xl shop-md:px-shop-hsp-lg shop-xl:px-shop-hsp-2xl">
        <nav aria-label="Footer" class="flex flex-col items-start gap-shop-vsp-xs">{nav}</nav>
        <p class="whitespace-pre-line text-shop-caption text-shop-muted">{smallPrint}</p>
        <p class="text-shop-caption text-shop-muted shop-md:text-right">
          <a href={creditHref} class={`text-shop-link underline decoration-shop-border underline-offset-4 ${HOVER_INVERT}`}>
            {creditLabel}
          </a>
        </p>
      </div>
    </footer>
  );
}

export const footerComponent = defineComponent<FooterProps>()(Footer, {
  id: "shop.footer",
  schemaVersion: 1,
  title: "Footer",
  category: "Chrome",
  description: "Three columns: footer links, small print and the zudo-composer credit.",
  source: { module: "demo-webshop/components", exportKind: "named", exportName: "Footer" },
  defaults: {
    smallPrint: "Nightjar Supply is a demo shop. Nothing here is for sale.",
    creditLabel: "Built with zudo-composer",
    creditHref: "https://github.com/Takazudo/zudo-composer",
  },
  fields: [
    { prop: "smallPrint", label: "Small print", schema: { type: "string" }, editor: { kind: "text", multiline: true } },
    { kind: "text", prop: "creditLabel", label: "Credit label" },
    { kind: "text", prop: "creditHref", label: "Credit URL" },
  ],
  slots: [{ id: "nav", prop: "nav", label: "Footer links", cardinality: "many", accepts: ["shop.nav-link"] }],
});
