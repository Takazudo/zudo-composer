import { activeSiteProjectValidationContext } from "../app/site-project-manifest";
import { loadSampleSiteProject } from "../site-project/sample";

export const siteProject = loadSampleSiteProject(activeSiteProjectValidationContext);
export default siteProject;
