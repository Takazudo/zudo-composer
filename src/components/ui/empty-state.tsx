import type { ComponentChildren } from "preact";
import type { IconComponent } from "../icons";
import { cx } from "./class-names";

export interface EmptyStateProps {
  icon?: IconComponent;
  title: ComponentChildren;
  /** One line saying what this surface is for once it has content. */
  description?: ComponentChildren;
  action?: ComponentChildren;
  /** Tighter padding for an empty state sitting inside a pane or card. */
  inline?: boolean;
  class?: string;
}

export function EmptyState({ icon: Icon, title, description, action, inline = false, class: className }: EmptyStateProps) {
  return (
    <div class={cx("cms-empty", inline && "cms-empty--inline", className)}>
      {Icon ? <Icon size="lg" class="cms-empty__icon" /> : null}
      <strong class="cms-empty__title">{title}</strong>
      {description ? <p class="cms-empty__description">{description}</p> : null}
      {action ? <div class="cms-empty__actions">{action}</div> : null}
    </div>
  );
}
