import { defineComponent } from "@zudo-composer/component-contract";
import { Show, computed, getScope, signal, type Child, type Ref } from "@takazudo/zfb/zudo-react";
import { HOVER_INVERT } from "./tone";

export interface HeaderProps {
  brand: string;
  brandHref: string;
  nav?: Child | object;
  // A single slot: the contract types it framework-neutrally, bigint included.
  actions?: Child | object | bigint;
}

const FOCUSABLE = "a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex='-1'])";
const DESKTOP = "(min-width: 48rem)";

export function Header({ brand = "Nightjar Supply", brandHref = "/", nav, actions }: HeaderProps) {
  const scope = getScope();
  const open = signal(false);
  const closed = computed(() => !open.value);
  const toggle: Ref<HTMLButtonElement> = { current: null };
  const panel: Ref<HTMLDivElement> = { current: null };

  scope.effect(() => {
    if (!open.value) return;
    const media = matchMedia(DESKTOP);
    const closeOnDesktop = () => {
      if (media.matches) open.value = false;
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        open.value = false;
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
  });

  return (
    <header class="sticky top-[0px] z-10 border-b border-shop-border bg-shop-bg">
      <div class="mx-auto flex h-shop-nav-h max-w-shop-page items-center justify-between gap-shop-hsp-md px-shop-hsp-md shop-md:px-shop-hsp-lg shop-xl:px-shop-hsp-2xl">
        <a href={brandHref} class={`text-shop-body font-shop-semibold text-shop-fg-strong ${HOVER_INVERT}`}>
          {brand}
        </a>
        {/* Nav children render in exactly one place: inline from `md`, otherwise in the open drawer. */}
        <Show when={closed}>{() => <nav aria-label="Primary" class="hidden items-center gap-shop-hsp-xs shop-md:flex">{nav as Child}</nav>}</Show>
        <div class="flex items-center gap-shop-hsp-xs">
          {actions as Child}
          <button
            ref={toggle}
            type="button"
            aria-expanded={open}
            aria-controls="shop-nav-drawer"
            on:click={() => {
              open.value = !open.value;
            }}
            class={`h-shop-control-h px-shop-hsp-xs text-shop-body text-shop-fg-strong shop-md:hidden ${HOVER_INVERT}`}
          >
            {computed(() => (open.value ? "Close" : "Menu"))}
          </button>
        </div>
      </div>
      <Show when={open}>
        {() => (
          <div
            ref={panel}
            id="shop-nav-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            class="fixed inset-y-[0px] right-[0px] z-20 flex w-[min(20rem,85vw)] flex-col gap-shop-vsp-sm border-l border-shop-border bg-shop-bg px-shop-hsp-md py-shop-vsp-md shadow-shop-drawer shop-md:hidden"
          >
            <button
              type="button"
              on:click={() => {
                open.value = false;
              }}
              class={`self-end h-shop-control-h px-shop-hsp-xs text-shop-body text-shop-fg-strong ${HOVER_INVERT}`}
            >
              Close
            </button>
            <nav aria-label="Primary" class="flex flex-col items-start gap-shop-vsp-xs">{nav as Child}</nav>
          </div>
        )}
      </Show>
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
