// Assertions a demo package's own tests reuse.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadSite, renderSiteProject, SITE_OUTPUT_FILE } from "./generate";

/**
 * The committed `site-project.json` must be exactly what `site-project.ts`
 * generates today. Anything else means someone edited one without the other.
 */
export async function assertSiteProjectCurrent(packageRoot: string): Promise<void> {
  const site = await loadSite(packageRoot);
  const { text } = renderSiteProject(site);
  const committed = await readFile(resolve(packageRoot, SITE_OUTPUT_FILE), "utf8");
  if (committed !== text) {
    throw new Error(`${SITE_OUTPUT_FILE} in ${packageRoot} is stale: run \`pnpm generate\` in that package and commit the result.`);
  }
}
