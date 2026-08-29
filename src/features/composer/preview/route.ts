// Route path of the chrome-free Composer preview document, served by
// `pages/composer/preview.tsx`.
//
// One shared constant so the parent-side URL builder (`bridge.ts`) and the
// page that answers it can never drift — the same discipline the styleguide's
// `src/features/styleguide/preview/route.ts` applies to `/components/preview`
// (a drifting literal there was a real regression, #48/#105).
//
// It is a BARE path: `withBase()` adds the configured base prefix and the
// trailing slash. Never hand-concatenate it.
export const COMPOSER_PREVIEW_ROUTE_PATH = "/composer/preview";

/**
 * Accessible name for the preview iframe at the HOST seam. The host (#247 shell
 * / #251 integration) owns the `<iframe>` element, but the accessible name is
 * part of this runtime's contract, so it is exported from here rather than
 * retyped at the mount site. See `composerPreviewFrameProps` in `./bridge`.
 */
export const COMPOSER_PREVIEW_IFRAME_TITLE = "Composer preview canvas";
