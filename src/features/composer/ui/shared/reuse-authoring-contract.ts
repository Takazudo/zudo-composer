// Async relationship checks sit outside the synchronous document controller.
// These small UI-facing results let authoring controls wait for the current
// provider result before issuing an outlet reassignment or clearing a role.

export type ReuseDependencyCheck =
  | { status: "ready"; dependentCount: number }
  | { status: "unavailable" | "load-error"; message: string };

export type ReuseAuthoringActionResult =
  | { status: "applied"; message?: string }
  | { status: "blocked" | "unavailable"; message: string };
