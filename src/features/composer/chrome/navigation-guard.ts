/** Native unload protection for dirty Composer records. */
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

export function installComposerNavigationGuard(hasUnsavedChanges: () => boolean): () => void {
  const beforeUnload = createBeforeUnloadHandler(hasUnsavedChanges);
  window.addEventListener("beforeunload", beforeUnload);
  return () => window.removeEventListener("beforeunload", beforeUnload);
}
