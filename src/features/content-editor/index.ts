// Browser entry of the restricted content-only editor
// (`zudo-composer/content-editor`). Hosts build it with the plugins from
// `zudo-composer/vite` (`contentEditorPlugins()`); see docs/hosted-content.md.
export {
  CONTENT_EDITOR_LABELS,
  CONTENT_EDITOR_LABELS_JA,
  canSubmitPreviewedSnapshot,
  contentEditorDisplayStatus,
  mountContentEditor,
  type ContentEditorDisplayStatus,
  type ContentEditorExportOptions,
  type ContentEditorFormStatus,
  type ContentEditorHandle,
  type ContentEditorLabels,
  type ContentEditorPreviewOptions,
  type ContentEditorState,
  type MountContentEditorOptions,
} from "./mount";
export {
  changedEntryValues,
  createContentEditorSession,
  type ContentEditorPendingOperation,
  type ContentEditorSaveState,
  type ContentEditorSession,
  type ContentEditorSessionOptions,
} from "./session";
export type { ContentEditorAsset, ContentEditorAssetCatalog } from "./asset-picker";
export { HostedContentForbiddenError } from "./view-provider";
