import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { OrreryMark } from "./icons";
import { textLinkClass } from "./prose";

export type ButtonVariant = "primary" | "secondary";
export type ButtonSize = "md" | "lg";

/** The only button styling on the site; `primary` is the scarce accent. */
export function buttonClass(variant: ButtonVariant, size: ButtonSize = "md"): string {
  const tone = variant === "primary"
    ? "bg-land-accent text-land-accent-fg hover:bg-land-accent-strong"
    : "border border-land-border text-land-fg-strong hover:bg-land-surface-2";
  const height = size === "lg" ? "h-land-control-h-lg" : "h-land-control-h";
  return `inline-flex items-center justify-center whitespace-nowrap rounded-land-pill px-land-hsp-md text-land-body font-land-semibold ${height} ${tone}`;
}

export interface ButtonProps {
  label: string;
  href: string;
  variant: ButtonVariant;
  size: ButtonSize;
}

export function Button({ label, href, variant, size }: ButtonProps) {
  return <a href={href || undefined} class={buttonClass(variant, size)}>{label}</a>;
}

/**
 * Delivery serves routes both at the site root and under a mount prefix
 * (`/site/pricing` in dev), so a non-root link is current when the pathname
 * ends with it. Links carrying a hash point into a page, never at one.
 */
export function isCurrentPath(href: string, pathname: string): boolean {
  if (!href.startsWith("/") || href.includes("#")) return false;
  const target = trimSlash(href.split("?")[0]!);
  const path = trimSlash(pathname);
  if (target === "") return path === "";
  return path === target || path.endsWith(target);
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export interface NavLinkProps {
  label: string;
  href: string;
}

export function NavLink({ label, href }: NavLinkProps) {
  const [current, setCurrent] = useState(false);
  useEffect(() => {
    setCurrent(isCurrentPath(href, window.location.pathname));
  }, [href]);
  return (
    <a
      href={href}
      aria-current={current ? "page" : undefined}
      class="inline-flex min-h-land-control-h items-center text-land-body text-land-fg-strong decoration-land-border underline-offset-4 hover:underline aria-[current=page]:underline aria-[current=page]:decoration-land-fg-strong"
    >
      {label}
    </a>
  );
}

export interface HeaderProps {
  brand: string;
  brandHref: string;
  nav?: ComponentChildren;
  action?: ComponentChildren;
}

export function Header({ brand, brandHref, nav, action }: HeaderProps) {
  return (
    <header class="sticky top-0 z-10 border-b border-land-border bg-land-bg">
      <div class="mx-auto flex min-h-land-nav-h w-full max-w-land-page flex-wrap items-center gap-x-land-hsp-lg gap-y-land-vsp-xs px-land-hsp-md py-land-vsp-xs land-md:py-[0] land-lg:px-land-hsp-xl">
        <a href={brandHref || "/"} class="flex items-center gap-land-hsp-xs text-land-h3 text-land-fg-strong">
          <OrreryMark class="size-land-icon" />
          <span>{brand}</span>
        </a>
        <nav aria-label="Primary" class="order-last flex w-full items-center gap-x-land-hsp-md land-md:order-none land-md:w-auto land-md:flex-1">{nav}</nav>
        <div class="ml-auto flex items-center land-md:ml-[0]">{action}</div>
      </div>
    </header>
  );
}

export interface FooterProps {
  smallPrint: string;
  creditLabel: string;
  creditHref: string;
  nav?: ComponentChildren;
}

export function Footer({ smallPrint, creditLabel, creditHref, nav }: FooterProps) {
  return (
    <footer class="mt-land-vsp-xl border-t border-land-border bg-land-bg">
      <div class="mx-auto flex w-full max-w-land-page flex-col gap-land-vsp-md px-land-hsp-md py-land-vsp-lg land-lg:px-land-hsp-xl">
        <nav aria-label="Footer" class="flex flex-wrap gap-x-land-hsp-md gap-y-land-vsp-xs [&_a]:text-land-muted">{nav}</nav>
        <div class="flex flex-wrap justify-between gap-x-land-hsp-md gap-y-land-vsp-xs text-land-caption text-land-muted">
          <p>{smallPrint}</p>
          {creditLabel && <p><a href={creditHref || undefined} class={textLinkClass}>{creditLabel}</a></p>}
        </div>
      </div>
    </footer>
  );
}

export interface DemoNoteProps {
  text: string;
}

export function DemoNote({ text }: DemoNoteProps) {
  return <p class="text-land-caption text-land-muted">{text}</p>;
}
