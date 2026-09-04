/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// The Composer toolbar's centre: Edit / Preview and the canvas viewport.
//
// Both are `SegmentedControl`s. The viewport used to be a `<select>`, which
// hid three of four choices behind a click and read as a form field in a row of
// commands; as segments the widths are the labels, so "1280" says what it does
// without a legend.

import type { JSX } from "preact";
import { EditIcon, PreviewIcon } from "../../../../components/icons";
import { SegmentedControl } from "../../../../components/ui";
import type { SegmentedOption } from "../../../../components/ui";
import type { ComposerCanvasViewport, ComposerMode } from "../../chrome/controller-model";
import { COMPOSER_VIEWPORTS, COMPOSER_VIEWPORT_LABELS } from "../../app/viewport";

export interface ComposerViewControlsProps {
  mode: ComposerMode;
  viewport: ComposerCanvasViewport;
  onSetMode: (mode: ComposerMode) => void;
  onSetViewport: (viewport: ComposerCanvasViewport) => void;
}

const MODE_OPTIONS: readonly SegmentedOption<ComposerMode>[] = [
  { value: "edit", label: "Edit", icon: EditIcon },
  { value: "preview", label: "Preview", icon: PreviewIcon },
];

const VIEWPORT_OPTIONS: readonly SegmentedOption<ComposerCanvasViewport>[] = COMPOSER_VIEWPORTS.map((value) => ({
  value,
  label: COMPOSER_VIEWPORT_LABELS[value],
}));

export function ComposerViewControls({
  mode,
  viewport,
  onSetMode,
  onSetViewport,
}: ComposerViewControlsProps): JSX.Element {
  return (
    <>
      <SegmentedControl<ComposerMode>
        label="Composer mode"
        size="sm"
        options={MODE_OPTIONS}
        value={mode}
        onChange={onSetMode}
      />
      <SegmentedControl<ComposerCanvasViewport>
        label="Canvas viewport"
        size="sm"
        options={VIEWPORT_OPTIONS}
        value={viewport}
        onChange={onSetViewport}
      />
    </>
  );
}
