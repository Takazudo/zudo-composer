/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// Reusable Edit/Preview segmented control. The `aria-pressed` state keeps both
// modes explicit to assistive technology and keyboard users.

import type { JSX } from "preact";
import type { ComposerMode } from "../../chrome/controller-model";
import { EditIcon, PreviewIcon } from "../../../../components/icons";

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
          {m.value === "edit" ? <EditIcon size="sm" class="sg-composer-button-icon" /> : <PreviewIcon size="sm" class="sg-composer-button-icon" />}
          <span>{m.label}</span>
        </button>
      ))}
    </div>
  );
}
