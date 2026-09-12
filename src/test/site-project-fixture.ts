import rawSiteProject from "../../packages/demo-studio/site-project.json";
import { validateSiteProject } from "../site-project/model/validation";
import type { SiteProject, SiteProjectValidationContext } from "../site-project/model/types";

/** Load a detached studio sample after validating the active public pack contract. */
export function loadSampleSiteProject(context: SiteProjectValidationContext): SiteProject {
  const result = validateSiteProject(structuredClone(rawSiteProject), context);
  if (!result.ok) {
    const details = result.diagnostics.map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`).join("\n");
    throw new TypeError(`The generated studio SiteProject is invalid.\n${details}`);
  }
  return result.project;
}
