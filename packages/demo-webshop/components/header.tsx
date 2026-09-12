import { defineComponent } from "@zudo-composer/component-contract";
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { HOVER_INVERT } from "./tone";

export interface HeaderProps {
  brand: string;
  brandHref: string;
  nav?: ComponentChildren;
  actions?: ComponentChildren;
}

const FOCUSABLE = "a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex='-1'])";
const DESKTOP = "(min-width: 48rem)";

function useDrawer() {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const media = matchMedia(DESKTOP);
    const closeOnDesktop = () => media.matches && setOpen(false);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        toggle.current?.focus();
        return;
      }
      if (event.key !== "Tab" || !panel.current) return;
      const focusable = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    panel.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    media.addEventListener("change", closeOnDesktop);
    document.addEventListener("keydown", onKey);
    return () => {
      media.removeEventListener("change", closeOnDesktop);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return { open, setOpen, toggle, panel };
}

export function Header({ brand = "Nightjar Supply", brandHref = "/", nav, actions }: HeaderProps) {
  const { open, setOpen, toggle, panel } = useDrawer();
  return (
    <header class="sticky top-[0px] z-10 border-b border-shop-border bg-shop-bg">
      <div class="mx-auto flex h-shop-nav-h max-w-shop-page items-center justify-between gap-shop-hsp-md px-shop-hsp-md shop-md:px-shop-hsp-lg shop-xl:px-shop-hsp-2xl">
        <a href={brandHref} class={`text-shop-body font-shop-semibold text-shop-fg-strong ${HOVER_INVERT}`}>
          {brand}
        </a>
        {/* Nav children render in exactly one place: inline from `md`, otherwise in the open drawer. */}
        {!open && <nav aria-label="Primary" class="hidden items-center gap-shop-hsp-xs shop-md:flex">{nav}</nav>}
        <div class="flex items-center gap-shop-hsp-xs">
          {actions}
          <button
            ref={toggle}
            type="button"
            aria-expanded={open}
            aria-controls="shop-nav-drawer"
            onClick={() => setOpen(!open)}
            class={`h-shop-control-h px-shop-hsp-xs text-shop-body text-shop-fg-strong shop-md:hidden ${HOVER_INVERT}`}
          >
            {open ? "Close" : "Menu"}
          </button>
        </div>
      </div>
      {open && (
        <div
          ref={panel}
          id="shop-nav-drawer"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
          class="fixed inset-y-[0px] right-[0px] z-20 flex w-[min(20rem,85vw)] flex-col gap-shop-vsp-sm border-l border-shop-border bg-shop-bg px-shop-hsp-md py-shop-vsp-md shadow-shop-drawer shop-md:hidden"
        >
          <button type="button" onClick={() => setOpen(false)} class={`self-end h-shop-control-h px-shop-hsp-xs text-shop-body text-shop-fg-strong ${HOVER_INVERT}`}>
            Close
          </button>
          <nav aria-label="Primary" class="flex flex-col items-start gap-shop-vsp-xs">{nav}</nav>
        </div>
      )}
    </header>
  );
}

export const headerComponent = defineComponent<HeaderProps>()(Header, {
  id: "shop.header",
  schemaVersion: 1,
  title: "Header",
  category: "Chrome",
  description: "Sticky top bar with brand, navigation and cart; a drawer below md.",
  source: { module: "demo-webshop/components", exportKind: "named", exportName: "Header" },
  defaults: { brand: "Nightjar Supply", brandHref: "/" },
  fields: [
    { kind: "text", prop: "brand", label: "Brand" },
    { kind: "text", prop: "brandHref", label: "Brand URL" },
  ],
  slots: [
    { id: "nav", prop: "nav", label: "Navigation", cardinality: "many", accepts: ["shop.nav-link"] },
    { id: "actions", prop: "actions", label: "Actions", cardinality: "single", accepts: ["shop.cart-button"] },
  ],
});
