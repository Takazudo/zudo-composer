import type { ComponentChildren } from "preact";
import type { IconComponent } from "../icons";
import { cx } from "../ui";

// The library page shell (issue #164): icon tile, title, one-line purpose,
// an actions slot for route switches (the provider `Menu`), and the primary
// action. Everything below the header is the route's own composition of
// `LibraryToolbar`, `LibraryTable` and the state components.

export interface LibraryPageProps {
  icon?: IconComponent;
  title: string;
  /** One line saying what the records on this page are for. */
  purpose?: ComponentChildren;
  /** Secondary header controls — the provider switch, a view menu. */
  actions?: ComponentChildren;
  /** The single call to action, rendered last in the header. */
  primaryAction?: ComponentChildren;
  children?: ComponentChildren;
  class?: string;
}

export function LibraryPage({ icon: Icon, title, purpose, actions, primaryAction, children, class: className }: LibraryPageProps) {
  const hasActions = actions !== undefined || primaryAction !== undefined;
  return (
    <div class={cx("cms-library", className)}>
      <header class="cms-library__header">
        {Icon ? (
          <span class="cms-library__tile" aria-hidden="true">
            <Icon size="md" />
          </span>
        ) : null}
        <div class="cms-library__heading">
          <h1 class="cms-library__title">{title}</h1>
          {purpose ? <p class="cms-library__purpose">{purpose}</p> : null}
        </div>
        {hasActions ? (
          <div class="cms-library__actions">
            {actions}
            {primaryAction}
          </div>
        ) : null}
      </header>
      {children}
    </div>
  );
}
