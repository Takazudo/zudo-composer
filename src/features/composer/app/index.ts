// Public surface of the central Composer app (issue #251).
//
// `ComposerIntegration` is the production app entry (mounted by
// `chrome/composer-app.tsx` → `pages/composer/index.tsx`'s island).
// `useComposerIntegration` is the callback/state composition seam waves 6-9
// (#254-#258) extend. The shared chooser instance is mounted inside
// `ComposerIntegration`; the main canvas bridge lives in `ComposerCanvasHost`
// (instance-scoped — a second host can be mounted for #254's chooser preview).

export { ComposerIntegration } from "./composer-integration";
export type { ComposerIntegrationProps } from "./composer-integration";

export { ProductionComposerApp, createProductionComposerProviders } from "./production-composer-app";
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
  isEditableEventTarget,
  type ComposerKeyboardOptions,
  type KeyboardHost,
} from "./use-composer-keyboard";

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
