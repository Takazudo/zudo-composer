import { activeSiteProjectValidationContext } from "../app/site-project-manifest";
import { loadSampleSiteProject } from "./site-project-fixture";

export const siteProject = loadSampleSiteProject(activeSiteProjectValidationContext);
/** Stable isolated namespace for Vitest's virtual-source alias. */
export const siteProjectRevision = "0".repeat(64);
export const deliverySource = { status: "no-active" as const, message: "No activated local release." };
export default siteProject;
