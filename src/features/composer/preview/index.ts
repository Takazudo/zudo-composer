// Public surface of the Composer preview runtime (issue #248).
//
// PARENT-SIDE consumers (#251 central integration, #254 chooser live preview)
// need only this module. The typical mount is:
//
//   const location = buildComposerPreviewUrl();              // canonical URL + exact origin
//   <iframe ref={ref} {...composerPreviewFrameProps(location)} />
//   const bridge = createComposerPreviewBridge({
//     frame: ref.current, location, hostWindow: window,
//     onSelect, onRequestAdd, onRequestNodeMenu, onRequestInsertMenu, onError,
//   });
//   bridge.render({ document, localRecordId }, session);     // revision minted here
//   bridge.updateSession({ mode, theme, selectedId });       // session-only change
//   bridge.dispose();                                        // on unmount
//
// The bridge is INSTANCE-SCOPED: two live previews (canvas + chooser) keep
// separate readiness, revision counters, and retained snapshots.
//
// The IFRAME-SIDE modules (`preview-app`, `renderer`, `client`, `snapshot-store`,
// `preview.css`) are imported by the preview route entry, not from here.
// Only their TYPES are re-exported below, for hosts that want to name the
// session/state they are driving.

export { COMPOSER_PREVIEW_ROUTE_PATH, COMPOSER_PREVIEW_IFRAME_TITLE } from "./route";

export {
  buildComposerPreviewUrl,
  composerPreviewFrameProps,
  createComposerPreviewBridge,
} from "./bridge";
export type {
  ComposerPreviewBridge,
  ComposerPreviewBridgeOptions,
  ComposerPreviewFrameProps,
  ComposerPreviewLocation,
  PreviewFrameLike,
} from "./bridge";

export {
  COMPOSER_PREVIEW_CHANNEL,
  COMPOSER_PREVIEW_PROTOCOL_VERSION,
  RESERVED_PROP_KEYS,
  commitInlineEditMessageSchema,
  dropNodeMessage,
  dropNodeMessageSchema,
  compositionDocumentSchema,
  compositionNodeSchema,
  previewLinkedSourceContextSchema,
  localPreviewSnapshot,
  insertionTargetSchema,
  previewSessionSchema,
  rectSchema,
  serializeRect,
  errorMessageSchema,
  modeMessageSchema,
  openSourceMessageSchema,
  readyMessageSchema,
  renderMessageSchema,
  requestAddMessageSchema,
  requestNodeMenuMessageSchema,
  requestInsertMenuMessageSchema,
  restoreFocusMessageSchema,
  selectMessageSchema,
  parentToPreviewSchema,
  previewToParentSchema,
  readParentToPreview,
  readPreviewToParent,
} from "./protocol";
export type {
  CommitInlineEditMessage,
  DropNodeMessage,
  ErrorMessage,
  GuardFailure,
  GuardResult,
  MessageEventLike,
  MessagePoster,
  MessageTarget,
  ModeMessage,
  OpenSourceMessage,
  ParentToPreviewMessage,
  PreviewMode,
  PreviewPackIdentity,
  ComposerPreviewSnapshot,
  PreviewLinkedSourceContext,
  PreviewSession,
  PreviewTheme,
  PreviewToParentMessage,
  ReadyMessage,
  RenderMessage,
  RequestAddMessage,
  RequestNodeMenuMessage,
  RequestInsertMenuMessage,
  RestoreFocusMessage,
  SelectMessage,
  SerializedRect,
} from "./protocol";

// Type only — the store itself runs inside the iframe.
export type { PreviewState } from "./snapshot-store";
