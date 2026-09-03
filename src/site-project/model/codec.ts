import { canonicalizeSiteProject } from "./canonical";
import type { SiteProjectParseResult, SiteProjectValidationContext } from "./types";
import { validateSiteProject } from "./validation";

/** Parses untrusted JSON, validates the full graph, and returns canonical collection order. */
export function parseSiteProjectJson(json: string, context: SiteProjectValidationContext): SiteProjectParseResult {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return {
      ok: false,
      diagnostics: [{ severity: "error", code: "invalid-project", path: "$", message: "SiteProject JSON could not be parsed." }],
    };
  }
  const validation = validateSiteProject(value, context);
  return validation.ok
    ? { ok: true, project: canonicalizeSiteProject(validation.project), diagnostics: [] }
    : validation;
}
