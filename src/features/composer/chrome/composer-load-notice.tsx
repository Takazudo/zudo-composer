/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// A dismissible banner surfacing #245's recovery outcome — issue #247's
// "the UI reports 'not saved' honestly" applies just as much to a one-time
// explanation of WHY as it does to the toolbar's live status pill.

import type { JSX } from "preact";
import type { ComposerLoadNotice } from "./controller-model";

export interface ComposerLoadNoticeBannerProps {
  notice: ComposerLoadNotice;
  onDismiss: () => void;
}

function describeLoadNotice(notice: ComposerLoadNotice): string {
  switch (notice.kind) {
    case "recovered":
      return `The saved Composition could not be read (${notice.reason}) — recovered the sample so you can keep working.`;
    case "quarantined":
      return `Storage holds a newer Composition (schema v${notice.foundSchemaVersion}) this version doesn't understand. Working from the sample — nothing is saved until you Reset.`;
  }
}

export function ComposerLoadNoticeBanner({ notice, onDismiss }: ComposerLoadNoticeBannerProps): JSX.Element {
  return (
    <div class="sg-composer-load-notice" role="status">
      <span>{describeLoadNotice(notice)}</span>
      <button type="button" class="sg-composer-toolbar-button" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}
