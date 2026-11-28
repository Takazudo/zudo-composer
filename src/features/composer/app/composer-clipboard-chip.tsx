// The toolbar clipboard chip is purely presentational: it renders nothing when
// the clipboard is empty, otherwise the clipboard component's display name.
// Copy/cut/paste/duplicate stay owned by the controller and the node menus.

import { computed, Show, type Child } from "@takazudo/zfb/zudo-react";
import type { CompositionNode } from "../../../composer/browser";
import { CopyIcon } from "../../../components/icons";
import { read, type MaybeSignal } from "../../../components/reactive";
import { Rebuild } from "../../../components/rebuild";
import { Chip } from "../../../components/ui";

export interface ComposerClipboardChipProps {
  /** The session clipboard's snapshot, or `null` when empty. */
  clipboard: MaybeSignal<CompositionNode | null>;
  /** Friendly display name for a component id — falls back to the raw id. */
  titleFor: (componentId: string) => string | undefined;
}

export function ComposerClipboardChip({ clipboard, titleFor }: ComposerClipboardChipProps): Child {
  const componentId = computed(() => read(clipboard)?.componentId ?? null);
  return (
    <Show when={computed(() => componentId.value !== null)}>
      {() => (
        <Rebuild value={componentId}>
          {(id) => (
            <Chip data-sg-clipboard-component={id ?? ""}>
              <CopyIcon size="sm" />
              {id === null ? "" : titleFor(id) ?? id}
            </Chip>
          )}
        </Rebuild>
      )}
    </Show>
  );
}
