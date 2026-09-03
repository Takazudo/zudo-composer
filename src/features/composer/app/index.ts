// Public surface of the central Composer app.
//
// `ComposerIntegration` is the production app entry (mounted by
// `chrome/composer-app.tsx` mounts from the standalone route dispatcher).
// `useComposerIntegration` is the callback/state composition seam for the
// complete editor. The shared chooser instance is mounted inside
// `ComposerIntegration`; the main canvas bridge lives in `ComposerCanvasHost`
// (instance-scoped so the chooser preview can mount a second host).

export { ComposerIntegration } from "./composer-integration";
export type { ComposerIntegrationProps } from "./composer-integration";

export { ProductionComposerApp } from "./production-composer-app";
export type {
  ComposerBrowserNavigation,
  ProductionComposerAppProps,
} from "./production-composer-app";

export { useComposerIntegration } from "./use-composer-integration";
export type {
  UseComposerIntegrationOptions,
  ComposerIntegrationApi,
  ComposerChooserState,
} from "./use-composer-integration";

export { ComposerCanvasHost } from "./composer-canvas-host";
export type { ComposerCanvasHostProps } from "./composer-canvas-host";

export { ComposerToolbarBar } from "./composer-toolbar-bar";
export type { ComposerToolbarBarProps } from "./composer-toolbar-bar";

export {
  useComposerKeyboard,
  type ComposerKeyboardOptions,
  type KeyboardHost,
} from "./use-composer-keyboard";

export { isEditableEventTarget, matchesUndoRedoShortcut } from "../keyboard-shortcuts";

export { useHostTheme, resolveHostTheme } from "./use-host-theme";

export {
  COMPOSER_VIEWPORTS,
  COMPOSER_VIEWPORT_WIDTHS,
  COMPOSER_VIEWPORT_LABELS,
  LS_COMPOSER_VIEWPORT,
  isComposerViewport,
  getPersistedViewport,
  setPersistedViewport,
} from "./viewport";
