// Composer copy-to-clipboard button. The shared helper uses the Clipboard API
// with an `execCommand` fallback; failure is surfaced rather than silently ignored.

import { computed, getScope, signal, type Child } from "@takazudo/zfb/zudo-react";
import { CopyIcon } from "../../../../components/icons";
import { Button, type ButtonSize } from "../../../../components/ui";
import { copyText } from "../../../../shared/clipboard";

export type ComposerCopyStatus = "idle" | "copied" | "failed";

export interface ComposerCopyButtonProps {
  text: string;
  label?: string;
  size?: ButtonSize;
}

export function ComposerCopyButton({ text, label = "Copy JSX", size = "md" }: ComposerCopyButtonProps): Child {
  const scope = getScope();
  const status = signal<ComposerCopyStatus>("idle");

  async function handleClick(): Promise<void> {
    const ok = await copyText(text);
    if (scope.abortSignal.aborted) return;
    status.value = ok ? "copied" : "failed";
    window.setTimeout(() => {
      if (!scope.abortSignal.aborted) status.value = "idle";
    }, 1800);
  }

  const visibleLabel = computed(() => (status.value === "copied" ? "Copied" : status.value === "failed" ? "Copy failed" : label));
  const announcement = computed(() => (status.value === "copied" ? "Copied to clipboard" : status.value === "failed" ? "Copy failed" : ""));

  return (
    <Button
      variant="primary"
      size={size}
      on:click={() => void handleClick()}
      data-sg-copy-status={status}
    >
      <CopyIcon size="sm" />
      {visibleLabel}
      <span role="status" aria-live="polite" class="cms-sr-only">
        {announcement}
      </span>
    </Button>
  );
}
