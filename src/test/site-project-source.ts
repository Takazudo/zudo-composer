import { activeSiteProjectValidationContext } from "../app/site-project-manifest";
import { loadSampleSiteProject } from "../site-project/sample";

export const siteProject = loadSampleSiteProject(activeSiteProjectValidationContext);
/** Stable isolated namespace for Vitest's virtual-source alias. */
export const siteProjectRevision = "0".repeat(64);
export default siteProject;
