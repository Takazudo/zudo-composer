const COORDINATION_CODES = new Set(["authoring-busy", "stale-browser", "browser-dirty", "browser-unavailable"]);

/** A fetch refused by native-authoring coordination is not a missing dev server; say so. */
export function transportFailureMessage(cause: unknown, unavailable: string): string {
  const code = cause && typeof cause === "object" && "code" in cause ? cause.code : undefined;
  if (typeof code !== "string" || !COORDINATION_CODES.has(code)) return unavailable;
  return code === "stale-browser"
    ? "This tab's authoring session changed. Reopen the workspace to load current records; input is retained."
    : "Authoring coordination is settling another tab's operation. Retry in a moment; input is retained.";
}
