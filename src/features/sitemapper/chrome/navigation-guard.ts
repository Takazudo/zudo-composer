// Standalone navigation guard. The application shell may dispatch this
// cancelable event before changing routes; native unloads are guarded too.

export const BEFORE_NAVIGATE_EVENT = "zudo-composer:before-navigate";

/** Minimal shape this module needs from the router's before-navigate event. */
export interface CancelableNavigationEvent {
  preventDefault(): void;
}

/** Build the raw before-preparation listener for unit tests and installation. */
export function createBeforeNavigateHandler(
  hasUnsavedChanges: () => boolean,
): (event: CancelableNavigationEvent) => void {
  return (event) => {
    if (hasUnsavedChanges()) event.preventDefault();
  };
}

/** Build the native browser leave-page handler. */
export function createBeforeUnloadHandler(
  hasUnsavedChanges: () => boolean,
): (event: BeforeUnloadEvent) => string | undefined {
  return (event) => {
    if (!hasUnsavedChanges()) return undefined;
    event.preventDefault();
    event.returnValue = "";
    return "";
  };
}

/**
 * Install both Sitemapper navigation guards for the island lifetime.
 * Returns a disposer suitable for a Preact effect cleanup.
 */
export function installSitemapperNavigationGuard(hasUnsavedChanges: () => boolean): () => void {
  const beforeNavigate = createBeforeNavigateHandler(hasUnsavedChanges) as EventListener;
  const beforeUnload = createBeforeUnloadHandler(hasUnsavedChanges);
  document.addEventListener(BEFORE_NAVIGATE_EVENT, beforeNavigate);
  window.addEventListener("beforeunload", beforeUnload);
  return () => {
    document.removeEventListener(BEFORE_NAVIGATE_EVENT, beforeNavigate);
    window.removeEventListener("beforeunload", beforeUnload);
  };
}
