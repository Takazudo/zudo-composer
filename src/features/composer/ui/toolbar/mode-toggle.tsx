/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// Reusable Edit/Preview segmented control (issue #249). Same accessible
// `aria-pressed` pattern the #247 toolbar already established
// (`sg-composer-mode-toggle`), extracted into its own component so wave-5
// integration (#251) can compose a richer toolbar from it without touching
// this component or #247's central app entry.

import type { JSX } from "preact";
import type { ComposerMode } from "../../chrome/controller-model";

export interface ComposerModeToggleProps {
  mode: ComposerMode;
  onSetMode: (mode: ComposerMode) => void;
}

const MODES: { value: ComposerMode; label: string }[] = [
  { value: "edit", label: "Edit" },
  { value: "preview", label: "Preview" },
];

export function ComposerModeToggle({ mode, onSetMode }: ComposerModeToggleProps): JSX.Element {
  return (
    <div class="sg-composer-mode-toggle" role="group" aria-label="Composer mode">
      {MODES.map((m) => (
        <button key={m.value} type="button" aria-pressed={mode === m.value} onClick={() => onSetMode(m.value)}>
          {m.label}
        </button>
      ))}
    </div>
  );
}
