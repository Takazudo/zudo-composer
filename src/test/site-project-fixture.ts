import rawSiteProject from "./site-project-fixture.json";
import { validateSiteProject } from "../site-project/model/validation";
import type { SiteProject, SiteProjectValidationContext } from "../site-project/model/types";

/** Load a detached copy of the checked-in fixture after validating the active public pack contract. */
export function loadSampleSiteProject(context: SiteProjectValidationContext): SiteProject {
  const result = validateSiteProject(structuredClone(rawSiteProject), context);
  if (!result.ok) {
    const details = result.diagnostics.map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`).join("\n");
    throw new TypeError(`The checked-in fixture SiteProject is invalid.\n${details}`);
  }
  return result.project;
}
