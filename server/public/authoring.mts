// Node-only authoring primitives. The browser entry must never import this module.
// Keep this list explicit; authoring input/handle types live at /site-project.
export {
  COMPOSITION_PROVIDER_ID,
  CONTENT_PROVIDER_ID,
  DEFAULT_TIMESTAMP,
  MAPPING_PROVIDER_ID,
  SITEMAP_PROVIDER_ID,
  defineSite,
  entryRef,
  node,
  slugify,
} from "../../src/site-project/authoring.js";
export { readAssetUrls } from "../authoring/assets.js";
export { assetAuthoringUrl } from "../../src/assets/model/types.js";
export { assetMimeTypeForExtension } from "../../src/assets/model/asset-kinds.mjs";
export { createFilesystemAssetStore } from "../../src/assets/storage/filesystem/store.js";
export { canonicalStringifyJson } from "../../src/site-project/model/canonical.js";
export { validateSiteProject } from "../../src/site-project/model/validation.js";
