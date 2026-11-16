// Node-only authoring primitives. The browser entry must never import this module.
// Keep this list explicit; authoring input/handle types live at /site-project.
export {
  ASSET_PROVIDER_ID,
  COMPOSITION_PROVIDER_ID,
  CONTENT_PROVIDER_ID,
  DEFAULT_TIMESTAMP,
  MAPPING_PROVIDER_ID,
  SITEMAP_PROVIDER_ID,
  defineSite,
  entryRef,
  imageUse,
  node,
  slugify,
} from "../../src/site-project/authoring.js";
export { assetAuthoringUrl } from "../../src/assets/model/types.js";
export { assetMimeTypeForExtension } from "../../src/assets/model/asset-kinds.mjs";
export { createFilesystemAssetStore } from "../../src/assets/storage/filesystem/store.js";
export { canonicalStringifyJson } from "../../src/site-project/model/canonical.js";
export { validateSiteProject } from "../../src/site-project/model/validation.js";
export { initializeAuthoringWorkspace } from "../edit/initialize-workspace.js";
export {
  captureAuthoringWorkspace,
  isAuthoringWorkspaceSnapshotCurrent,
  isAuthoringWorkspaceSourceCurrent,
  resolveAuthoringPackIdentity,
  resolveAuthoringRendererIdentity,
  type AuthoringRendererIdentity,
  type AuthoringPackIdentity,
  type AuthoringWorkspaceSnapshot,
  type CaptureAuthoringWorkspaceOptions,
  type AuthoringPublicFile,
  type CapturedPublicFile,
} from "../authoring-workspace/capture.js";
export type { HostDocumentRenderer, HostDocumentRenderInput, HostDocumentIdentity, HostDocumentTarget, HostDocumentPreview } from "../host-document/types.js";
export { renderHostDocument, hostDocumentTargets } from "../host-document/render.js";
