/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// A typed placeholder for the tree/canvas/inspector regions this issue does
// NOT implement (structure tree #250, canvas/preview iframe #248, inspector
// #249 — see the epic's exclusive-ownership table). Rendered by
// ComposerWorkspace's default slot content, and replaceable by any consumer
// simply passing `tree` / `canvas` / `inspector` props — see that file's
// header for the full seam contract.

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
