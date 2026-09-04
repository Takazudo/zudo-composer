/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// Composer copy-to-clipboard button. The shared helper uses the Clipboard API
// with an `execCommand` fallback; failure is surfaced rather than silently ignored.

import type { JSX } from "preact";
import { useState } from "preact/hooks";
import { CopyIcon } from "../../../../components/icons";
import { Button } from "../../../../components/ui";
import { copyText } from "../../../../shared/clipboard";

export type ComposerCopyStatus = "idle" | "copied" | "failed";

export interface ComposerCopyButtonProps {
  text: string;
  label?: string;
}

export function ComposerCopyButton({ text, label = "Copy JSX" }: ComposerCopyButtonProps): JSX.Element {
  const [status, setStatus] = useState<ComposerCopyStatus>("idle");

  async function handleClick(): Promise<void> {
    const ok = await copyText(text);
    setStatus(ok ? "copied" : "failed");
    window.setTimeout(() => setStatus("idle"), 1800);
  }

  const visibleLabel = status === "copied" ? "Copied" : status === "failed" ? "Copy failed" : label;
  const announcement = status === "copied" ? "Copied to clipboard" : status === "failed" ? "Copy failed" : "";

  return (
    <Button
      variant="primary"
      onClick={() => void handleClick()}
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
