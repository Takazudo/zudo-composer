import type { Page } from "@playwright/test";
const prepared = new WeakSet<Page>();
/** Test-owned fixture setup only. Dev without an activated release is
 * unavailable; the hidden initial `/`, dynamic imports, initialization, and
 * reload below are one test-owned dev cold window, measured in R0b. Keep this
 * initialization inside the test so empty-workspace scenarios can still assert
 * `Open workspace`. Initialize an explicit validated
 * source through the real workspace service, which writes it to the host's
 * filesystem exactly as authoring does. This is not a production fallback or a
 * storage mock.
 */
export async function ensureDevWorkspace(page: Page): Promise<void> {
  if (prepared.has(page)) return;
  await page.goto("/");
  await page.evaluate(async () => {
    const integrationPath = "/src/app/provider-integration.ts";
    const samplePath = "/src/test/site-project-fixture.ts";
    const manifestPath = "/src/app/site-project-manifest.ts";
    const modelPath = "/src/site-project/model/index.ts";
    const { createProductionProviderIntegration } = await import(integrationPath);
    const { loadSampleSiteProject } = await import(samplePath);
    const { activeSiteProjectValidationContext } = await import(manifestPath);
    const { serializeSiteProject } = await import(modelPath);
    const project = loadSampleSiteProject(activeSiteProjectValidationContext);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(serializeSiteProject(project)));
    const sourceRevision = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
    const integration = createProductionProviderIntegration({ project, sourceRevision });
    const outcome = await integration.initialization.initialize();
    if (outcome.status !== "ready") throw new Error(`Explicit browser fixture initialization failed: ${outcome.error?.message ?? outcome.status}`);
  });
  await page.reload();
  prepared.add(page);
}
