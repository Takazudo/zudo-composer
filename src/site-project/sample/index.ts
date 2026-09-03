import rawSampleSiteProject from "./sample-site-project.json";
import { validateSiteProject } from "../model/validation";
import type { SiteProject, SiteProjectValidationContext } from "../model/types";

/** Load a detached copy of the checked-in sample after validating the active public pack contract. */
export function loadSampleSiteProject(context: SiteProjectValidationContext): SiteProject {
  const result = validateSiteProject(structuredClone(rawSampleSiteProject), context);
  if (!result.ok) {
    const details = result.diagnostics.map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`).join("\n");
    throw new TypeError(`The bundled sample SiteProject is invalid.\n${details}`);
  }
  return result.project;
}
