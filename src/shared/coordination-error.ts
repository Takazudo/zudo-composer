const COORDINATION_CODES = new Set(["authoring-busy", "stale-browser", "browser-dirty", "browser-unavailable"]);

/** A fetch refused by native-authoring coordination is not a missing dev server; say so. */
export function transportFailureMessage(cause: unknown, unavailable: string): string {
  const code = cause && typeof cause === "object" && "code" in cause ? cause.code : undefined;
  if (typeof code !== "string" || !COORDINATION_CODES.has(code)) return unavailable;
  return code === "stale-browser"
    ? "This tab's authoring session changed. Reopen the workspace to load current records; input is retained."
    : "Authoring coordination is settling another tab's operation. Retry in a moment; input is retained.";
}

const WAIT_CODES = new Set(["authoring-busy", "browser-dirty"]);

/** True when any error in the cause chain is a coordination wait, not a real failure. */
export function isCoordinationBusy(error: unknown): boolean {
  for (let current = error, depth = 0; current && typeof current === "object" && depth < 8; current = (current as { cause?: unknown }).cause, depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && WAIT_CODES.has(code)) return true;
  }
  return false;
}
