/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// The toolbar clipboard chip is purely presentational: it renders
// nothing when the clipboard is empty, otherwise shows the clipboard
// component's display name. It is mounted inside `ComposerStatusIndicator`
// through its `children` composability seam; copy/cut/paste/duplicate actions
// remain owned by the controller and menus.

import type { JSX } from "preact";
import type { CompositionNode } from "../../../composer/browser";
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
