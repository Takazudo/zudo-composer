import { defineComponent } from "@zudo-composer/component-contract";
import { computed, getScope, signal } from "@takazudo/zfb/zudo-react";
import { HOVER_INVERT } from "./tone";

export interface NavLinkProps {
  label: string;
  href: string;
  exact?: boolean;
}

export function isActivePath(pathname: string, href: string, exact: boolean): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  const target = href.replace(/\/+$/, "") || "/";
  if (exact || target === "/") return path === target;
  return path === target || path.startsWith(`${target}/`);
}

export function NavLink({ label = "Link", href = "/", exact = false }: NavLinkProps) {
  const active = signal(false);
  getScope().onActivate(() => {
    active.value = isActivePath(location.pathname, href, exact);
  });
  return (
    <a
      href={href}
      aria-current={computed(() => (active.value ? "page" : null))}
      class={computed(() => `inline-flex items-center h-shop-control-h px-shop-hsp-xs text-shop-body text-shop-fg-strong ${active.value ? "underline decoration-shop-border underline-offset-4" : ""} ${HOVER_INVERT}`)}
    >
      {label}
    </a>
  );
}

export const navLinkComponent = defineComponent<NavLinkProps>()(NavLink, {
  id: "shop.nav-link",
  schemaVersion: 1,
  title: "Nav link",
  category: "Chrome",
  description: "One navigation link; active when the current path starts with its href.",
  source: { module: "demo-webshop/components", exportKind: "named", exportName: "NavLink" },
  defaults: { label: "Link", href: "/", exact: false },
  fields: [
    { kind: "text", prop: "label", label: "Label" },
    { kind: "text", prop: "href", label: "URL" },
    { kind: "boolean", prop: "exact", label: "Exact match" },
  ],
});
