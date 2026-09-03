/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// The toolbar clipboard chip is purely presentational: it renders nothing when
// the clipboard is empty, otherwise the clipboard component's display name.
// Copy/cut/paste/duplicate stay owned by the controller and the node menus.

import type { JSX } from "preact";
import type { CompositionNode } from "../../../composer/browser";
import { CopyIcon } from "../../../components/icons";
import { Chip } from "../../../components/ui";

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
    <Chip data-sg-clipboard-component={clipboard.componentId}>
      <CopyIcon size="sm" />
      {label}
    </Chip>
  );
}
