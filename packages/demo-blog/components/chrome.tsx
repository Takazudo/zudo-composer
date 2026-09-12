import { createContext, type ComponentChildren } from "preact";
import { useContext } from "preact/hooks";
import { renderInline } from "./prose";
import { currentPathname, isCurrentHref } from "./runtime";

// Only the header marks the current item: the footer repeats nav links and a
// second accent underline would break the one-accent-per-viewport budget.
const NavCurrentContext = createContext(false);

const CAPTION = "font-blog-sans text-blog-caption font-blog-medium";
const CAPS = `${CAPTION} uppercase tracking-blog-caps`;

export interface HeaderProps {
  brand?: string;
  brandHref?: string;
  nav?: ComponentChildren[];
}

export function Header({ brand = "Margin Notes", brandHref = "/", nav }: HeaderProps) {
  return (
    <header class="border-b border-blog-border bg-blog-bg">
      <div class="mx-auto flex min-h-blog-nav-h max-w-blog-page flex-wrap items-center justify-between gap-x-blog-hsp-md px-blog-hsp-sm blog-md:px-blog-hsp-lg">
        <a class="font-blog-serif text-blog-h3 font-blog-semibold text-blog-fg-strong hover:underline" href={brandHref}>{brand}</a>
        <nav aria-label="Primary">
          <ul class="flex flex-wrap gap-x-blog-hsp-md">
            <NavCurrentContext.Provider value={true}>{nav}</NavCurrentContext.Provider>
          </ul>
        </nav>
      </div>
    </header>
  );
}

export interface NavLinkProps {
  label?: string;
  href?: string;
}

export function NavLink({ label = "Link", href = "/" }: NavLinkProps) {
  const markCurrent = useContext(NavCurrentContext);
  const current = markCurrent && isCurrentHref(href, currentPathname());
  return (
    <li>
      <a
        class={`inline-block py-blog-vsp-xs ${CAPTION} text-blog-fg-strong ${current ? "underline decoration-blog-accent decoration-2 underline-offset-3" : "hover:underline"}`}
        href={href}
        aria-current={current ? "page" : undefined}
      >
        {label}
      </a>
    </li>
  );
}

export interface FooterProps {
  smallPrint?: string;
  creditLabel?: string;
  creditHref?: string;
  nav?: ComponentChildren[];
}

export function Footer({ smallPrint = "", creditLabel = "Built with zudo-composer", creditHref = "https://zudo-composer.zudolab.dev", nav }: FooterProps) {
  return (
    <footer class="mt-blog-vsp-2xl border-t border-blog-border bg-blog-bg">
      <div class="mx-auto flex max-w-blog-page flex-col gap-blog-vsp-sm px-blog-hsp-sm py-blog-vsp-lg blog-md:px-blog-hsp-lg">
        <nav aria-label="Footer">
          <ul class="flex flex-wrap gap-x-blog-hsp-md">{nav}</ul>
        </nav>
        {smallPrint ? <p class={`${CAPTION} text-blog-muted`}>{smallPrint}</p> : null}
        <p class={`${CAPTION} text-blog-muted`}>
          <a class="hover:underline" href={creditHref}>{creditLabel}</a>
        </p>
      </div>
    </footer>
  );
}

export interface ContainerProps {
  width?: "page" | "measure";
  content?: ComponentChildren[];
}

export function Container({ width = "page", content }: ContainerProps) {
  return <div class={`mx-auto w-full px-blog-hsp-sm blog-md:px-blog-hsp-lg ${width === "measure" ? "max-w-blog-measure" : "max-w-blog-page"}`}>{content}</div>;
}

const STACK_GAP = { xs: "gap-blog-vsp-xs", sm: "gap-blog-vsp-sm", md: "gap-blog-vsp-md", lg: "gap-blog-vsp-lg" } as const;

export interface StackProps {
  gap?: keyof typeof STACK_GAP;
  content?: ComponentChildren[];
}

export function Stack({ gap = "md", content }: StackProps) {
  return <div class={`flex flex-col ${STACK_GAP[gap]}`}>{content}</div>;
}

export interface SectionProps {
  rule?: boolean;
  content?: ComponentChildren[];
}

export function Section({ rule = false, content }: SectionProps) {
  return <section class={`py-blog-vsp-xl${rule ? " border-t border-blog-border" : ""}`}>{content}</section>;
}

export interface SectionHeadingProps {
  eyebrow?: string;
  heading?: string;
  as?: "h2" | "h3";
}

export function SectionHeading({ eyebrow = "", heading = "Section", as = "h2" }: SectionHeadingProps) {
  const Tag = as;
  return (
    <div class="mb-blog-vsp-md">
      {eyebrow ? <p class={`${CAPS} text-blog-muted`}>{eyebrow}</p> : null}
      <Tag data-blog-inline class={`font-blog-serif font-blog-semibold text-blog-fg-strong ${as === "h2" ? "text-blog-h2" : "text-blog-h3"}`}>{heading}</Tag>
    </div>
  );
}

export interface PageHeadingProps {
  eyebrow?: string;
  heading?: string;
  intro?: string;
}

export function PageHeading({ eyebrow = "", heading = "Page title", intro = "" }: PageHeadingProps) {
  return (
    <div class="mx-auto max-w-blog-measure pt-blog-vsp-xl pb-blog-vsp-lg">
      {eyebrow ? <p class={`${CAPS} text-blog-muted`}>{eyebrow}</p> : null}
      <h1 data-blog-inline class="mt-blog-vsp-xs font-blog-serif text-blog-h1-sm font-blog-semibold text-blog-fg-strong blog-md:text-blog-h1">{heading}</h1>
      {intro ? <p class="mt-blog-vsp-sm font-blog-serif text-blog-lead text-blog-fg">{intro}</p> : null}
    </div>
  );
}

export interface HomeHeroProps {
  heading?: string;
  lead?: string;
  linkLabel?: string;
  linkHref?: string;
}

export function HomeHero({ heading = "Notes from the margin", lead = "", linkLabel = "", linkHref = "/about" }: HomeHeroProps) {
  return (
    <div class="mx-auto max-w-blog-measure pt-blog-vsp-xl pb-blog-vsp-2xl">
      <h1 data-blog-inline class="font-blog-serif text-blog-h1 font-blog-semibold text-blog-fg-strong blog-md:text-blog-display">{heading}</h1>
      {lead || linkLabel ? (
        <p class="mt-blog-vsp-md font-blog-serif text-blog-lead text-blog-fg">
          {lead}
          {lead && linkLabel ? " " : null}
          {linkLabel ? <a class="text-blog-link underline decoration-current underline-offset-3 hover:text-blog-fg-strong" href={linkHref}>{linkLabel}</a> : null}
        </p>
      ) : null}
    </div>
  );
}

export interface CalloutProps {
  title?: string;
  markdown?: string;
  tone?: "soft" | "surface";
}

export function Callout({ title = "", markdown = "", tone = "soft" }: CalloutProps) {
  return (
    <aside class={`mx-auto my-blog-vsp-md max-w-blog-measure px-blog-hsp-md py-blog-vsp-sm ${tone === "soft" ? "bg-blog-accent-soft" : "bg-blog-surface"}`}>
      {title ? <p class={`${CAPS} text-blog-fg-strong`}>{title}</p> : null}
      {markdown ? <div class="mt-blog-vsp-xs font-blog-serif text-blog-body text-blog-fg">{markdown.split(/\n{2,}/).map((paragraph, index) => <p key={index} class={index ? "mt-blog-vsp-xs" : ""}>{renderInline(paragraph.replace(/\s*\n\s*/g, " "))}</p>)}</div> : null}
    </aside>
  );
}

export interface DemoNoteProps {
  text?: string;
}

export function DemoNote({ text = "Demo — no data is sent." }: DemoNoteProps) {
  return <p class={`mx-auto max-w-blog-measure py-blog-vsp-sm ${CAPTION} text-blog-muted`} role="note">{text}</p>;
}
