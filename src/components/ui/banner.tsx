import type { ComponentChildren } from "preact";
import { ErrorIcon, InfoIcon, WarningIcon } from "../icons";
import type { IconComponent } from "../icons";
import { cx } from "./class-names";

export type BannerTone = "info" | "warn" | "err";

const TONE_ICONS: Record<BannerTone, IconComponent> = {
  info: InfoIcon,
  warn: WarningIcon,
  err: ErrorIcon,
};

export interface BannerProps {
  tone?: BannerTone;
  title?: ComponentChildren;
  /** Overrides the tone's default icon. */
  icon?: IconComponent;
  /** Trailing controls — retry, dismiss, recovery. */
  action?: ComponentChildren;
  class?: string;
  children?: ComponentChildren;
}

export function Banner({ tone = "info", title, icon, action, class: className, children }: BannerProps) {
  const Icon = icon ?? TONE_ICONS[tone];
  return (
    <div class={cx("cms-banner", `cms-banner--${tone}`, className)} role={tone === "err" ? "alert" : "status"}>
      <Icon size="sm" class="cms-banner__icon" />
      <div class="cms-banner__text">
        {title ? <strong class="cms-banner__title">{title}</strong> : null}
        {children ? <div class="cms-banner__body">{children}</div> : null}
      </div>
      {action ? <div class="cms-banner__actions">{action}</div> : null}
    </div>
  );
}
