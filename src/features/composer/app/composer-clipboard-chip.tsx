/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// The toolbar clipboard chip (issue #255). Purely presentational: renders
// nothing when the clipboard is empty, otherwise shows the clipboard
// component's display name. Mounted inside #249's `ComposerStatusIndicator`
// via its `children` composability seam (see that component's file header) —
// this is the ONE new UI surface this wave adds; the copy/cut/paste/duplicate
// actions themselves are exposed menu-free for wave 7 (#256) to wire up.

import type { JSX } from "preact";
import type { CompositionNode } from "../../../composer";
import { CopyIcon } from "../../../components/icons";

export interface ComposerClipboardChipProps {
  /** The session clipboard's snapshot, or `null` when empty. */
  clipboard: CompositionNode | null;
  /** Friendly display name for a component id — falls back to the raw id. */
  titleFor: (componentId: string) => string | undefined;
}

export function ComposerClipboardChip({ clipboard, titleFor }: ComposerClipboardChipProps): JSX.Element | null {
  if (!clipboard) return null;
  const label = titleFor(clipboard.componentId) ?? clipboard.componentId;
  return (
    <span
      class="sg-composer-clipboard-chip inline-flex items-center gap-hsp-3xs text-small text-muted"
      data-sg-clipboard-component={clipboard.componentId}
    >
      <CopyIcon size="sm" />
      <span>{label}</span>
    </span>
  );
}
