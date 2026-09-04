import { CheckCircleIcon, ErrorIcon, LoadingIcon, WarningIcon } from "../icons";
import type { IconComponent } from "../icons";
import { Button } from "./button";
import { cx } from "./class-names";

export type StatusChipState = "saved" | "unsaved" | "saving" | "failed" | "custom";
export type StatusChipTone = "neutral" | "ok" | "warn" | "err";

interface StatusPreset {
  label: string;
  tone: StatusChipTone;
  icon: IconComponent;
  spin?: boolean;
}

/** One save-status vocabulary for every route (epic #156 delegated decision). */
const PRESETS: Record<Exclude<StatusChipState, "custom">, StatusPreset> = {
  saved: { label: "Saved", tone: "ok", icon: CheckCircleIcon },
  unsaved: { label: "Unsaved changes", tone: "warn", icon: WarningIcon },
  saving: { label: "Saving…", tone: "neutral", icon: LoadingIcon, spin: true },
  failed: { label: "Save failed", tone: "err", icon: ErrorIcon },
};

interface StatusChipBaseProps {
  /** Appended after a middot, e.g. "Browser storage" or "12 min ago". */
  detail?: string;
  icon?: IconComponent;
  tone?: StatusChipTone;
  /** Renders the Retry action; only the `failed` state shows one. */
  onRetry?: () => void;
  retryLabel?: string;
  class?: string;
}

export type StatusChipProps = StatusChipBaseProps &
  ({ state: Exclude<StatusChipState, "custom">; label?: string } | { state: "custom"; label: string });

export function StatusChip(props: StatusChipProps) {
  const { state, label, detail, icon, tone, onRetry, retryLabel = "Retry", class: className } = props;
  const preset = state === "custom" ? undefined : PRESETS[state];
  const Icon = icon ?? preset?.icon;
  const resolvedTone = tone ?? preset?.tone ?? "neutral";
  const text = label ?? preset?.label ?? "";

  return (
    <span
      class={cx("cms-status", resolvedTone !== "neutral" && `cms-status--${resolvedTone}`, className)}
      role="status"
      data-state={state}
    >
      {Icon ? <Icon size="sm" class={cx("cms-status__icon", preset?.spin && "cms-status__spinner")} /> : null}
      <span class="cms-status__label">{detail ? `${text} · ${detail}` : text}</span>
      {state === "failed" && onRetry ? (
        <Button size="xs" onClick={onRetry}>
          {retryLabel}
        </Button>
      ) : null}
    </span>
  );
}
