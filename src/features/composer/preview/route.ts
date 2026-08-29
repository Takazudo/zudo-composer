// Route path of the chrome-free Composer preview document, served by
// `preview-entry.ts`.
//
// One shared constant keeps the parent URL builder and route dispatcher from
// drifting. The standalone route is exact and has no trailing-slash variant.
export const COMPOSER_PREVIEW_ROUTE_PATH = "/composer/preview";

/**
 * Accessible name for the preview iframe at the HOST seam. The host (Takazudo/zudo-sg#247 shell
 * / Takazudo/zudo-sg#251 integration) owns the `<iframe>` element, but the accessible name is
 * part of this runtime's contract, so it is exported from here rather than
 * retyped at the mount site. See `composerPreviewFrameProps` in `./bridge`.
 */
export const COMPOSER_PREVIEW_IFRAME_TITLE = "Composer preview canvas";
