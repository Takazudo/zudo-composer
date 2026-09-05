// Preact useId is root-local; every OverlayPortal is a separate rendering root.
// Reserve IDs for the lifetime of this module, including closed menu controllers.
let nextOverlayId = 0;

export function allocateOverlayId(kind: string): string {
  let id: string;
  do {
    id = `cms-${kind}-${++nextOverlayId}`;
  } while (typeof document !== "undefined" && document.getElementById(id));
  return id;
}
