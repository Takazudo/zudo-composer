/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// A typed omitted-surface fallback for `ComposerWorkspace`. Production supplies
// all three regions; isolated shell consumers get an explicit accessible state
// instead of an empty rail.

import type { JSX } from "preact";

export interface ComposerPlaceholderPaneProps {
  label: string;
  note?: string;
}

export function ComposerPlaceholderPane({ label, note }: ComposerPlaceholderPaneProps): JSX.Element {
  return (
    <div class="sg-composer-placeholder-pane" data-sg-composer-placeholder={label}>
      <strong>{label}</strong>
      {note && <span>{note}</span>}
    </div>
  );
}
