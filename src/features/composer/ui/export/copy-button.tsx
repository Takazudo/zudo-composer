/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// Composer copy-to-clipboard button (issue #249). Reuses the styleguide
// CodePanel's `copyText` utility (Clipboard API with an `execCommand`
// fallback for insecure contexts) — that helper carries no styleguide-only
// state, so importing it doesn't couple this feature to the styleguide.
// Unlike the styleguide's own `CopyButton`, this one surfaces FAILURE
// feedback too (the export dialog's copy action must never silently no-op).

import type { JSX } from "preact";
import { useState } from "preact/hooks";
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
    <button
      type="button"
      class="sg-composer-toolbar-button"
      onClick={() => void handleClick()}
      data-sg-copy-status={status}
    >
      {visibleLabel}
      <span role="status" aria-live="polite" class="sr-only">
        {announcement}
      </span>
    </button>
  );
}
