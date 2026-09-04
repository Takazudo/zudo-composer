import type { ComponentChildren } from "preact";
import { useRef } from "preact/hooks";
import type { IconComponent } from "../icons";
import { CountBadge } from "./badge";
import { cx } from "./class-names";
import { nextRovingIndex } from "./roving";

export interface PaneProps {
  /** `main` sits on the app background, `canvas` on the preview backdrop. */
  variant?: "default" | "main" | "canvas";
  /** Accessible name for the region, when the pane is a landmark of its own. */
  label?: string;
  class?: string;
  children?: ComponentChildren;
}

export function Pane({ variant = "default", label, class: className, children }: PaneProps) {
  return (
    <section class={cx("cms-pane", variant !== "default" && `cms-pane--${variant}`, className)} aria-label={label}>
      {children}
    </section>
  );
}

export interface PaneHeaderProps {
  title: ComponentChildren;
  /** The semantic element for the title; most pane titles remain spans. */
  as?: "span" | "h1";
  count?: number;
  /** Trailing controls, pushed to the inline end. */
  actions?: ComponentChildren;
  class?: string;
  children?: ComponentChildren;
}

export function PaneHeader({ title, as = "span", count, actions, class: className, children }: PaneHeaderProps) {
  const Title = as;
  return (
    <div class={cx("cms-pane__header", className)}>
      <Title class="cms-pane__title">{title}</Title>
      {count === undefined ? null : <CountBadge count={count} />}
      {children}
      {actions ? <div class="cms-pane__header-actions">{actions}</div> : null}
    </div>
  );
}

export interface PaneTab<Id extends string> {
  id: Id;
  label: ComponentChildren;
  icon?: IconComponent;
  count?: number;
  disabled?: boolean;
}

export interface PaneTabsProps<Id extends string> {
  /** Accessible name of the tab list. */
  label: string;
  tabs: readonly PaneTab<Id>[];
  activeId: Id;
  onSelect: (id: Id) => void;
  /** Maps a tab to the id of the panel it controls, when one is rendered. */
  panelId?: (id: Id) => string;
  class?: string;
}

export function PaneTabs<Id extends string>({ label, tabs, activeId, onSelect, panelId, class: className }: PaneTabsProps<Id>) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const activeIndex = tabs.findIndex((tab) => tab.id === activeId);
  const tabStopIndex = activeIndex === -1 ? 0 : activeIndex;

  function handleKeyDown(event: KeyboardEvent, index: number) {
    const next = nextRovingIndex(event.key, index, tabs.length, {
      isDisabled: (candidate) => Boolean(tabs[candidate].disabled),
    });
    if (next === null) return;
    event.preventDefault();
    buttons.current[next]?.focus();
    onSelect(tabs[next].id);
  }

  return (
    <div class={cx("cms-pane__tabs", className)} role="tablist" aria-label={label}>
      {tabs.map((tab, index) => {
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            type="button"
            class="cms-pane__tab"
            ref={(element) => {
              buttons.current[index] = element;
            }}
            role="tab"
            aria-selected={tab.id === activeId}
            aria-controls={panelId?.(tab.id)}
            disabled={tab.disabled}
            tabIndex={index === tabStopIndex ? 0 : -1}
            onKeyDown={(event) => handleKeyDown(event, index)}
            onClick={() => onSelect(tab.id)}
          >
            {Icon ? <Icon size="sm" /> : null}
            {tab.label}
            {tab.count === undefined ? null : <CountBadge count={tab.count} />}
          </button>
        );
      })}
    </div>
  );
}

export interface PaneSectionProps {
  title: ComponentChildren;
  /** Trailing action for the section, pushed to the inline end of its title. */
  action?: ComponentChildren;
  class?: string;
  children?: ComponentChildren;
}

export function PaneSection({ title, action, class: className, children }: PaneSectionProps) {
  return (
    <section class={cx("cms-pane__section", className)}>
      <h3 class="cms-pane__section-title">
        <span>{title}</span>
        {action ? <span class="cms-pane__section-action">{action}</span> : null}
      </h3>
      {children}
    </section>
  );
}

export interface PaneBodyProps {
  /** Adds the standard pane padding. */
  padded?: boolean;
  class?: string;
  children?: ComponentChildren;
}

export function PaneBody({ padded = false, class: className, children }: PaneBodyProps) {
  return <div class={cx("cms-pane__body", padded && "cms-pane__body--pad", className)}>{children}</div>;
}
