// @ts-check
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { compileStaticSite, verifySiteStaticArtifact } from "../server/site-build.mjs";
import { loadHostContext } from "../server/host-context.mjs";
import { readToolIdentity } from "../server/site-build/artifact.mjs";
import { resolveSiteSourceRevision } from "../server/site-build/source-revision.mjs";

/** Read routes only after verifying every artifact byte and proving it was
 * compiled from the current host project and assets. No build or state write.
 * @param {string} hostRoot @param {{env?: NodeJS.ProcessEnv}} [options] */
export async function readVerifiedHostManifest(hostRoot, { env } = {}) {
  const { composerConfig, pack } = await loadHostContext({ workspaceRoot: hostRoot, env });
  const manifest = await verifySiteStaticArtifact({ directory: join(hostRoot, "dist-site"), expectedSourceRevision: resolveSiteSourceRevision(undefined, env) });
  assert.deepEqual(manifest.tool, await readToolIdentity(), "Site artifact was built by a different installed tool identity");
  const current = await compileStaticSite({ projectPath: join(hostRoot, "site-project.json"), pack, assetsStoreRoot: composerConfig.paths.assets });
  assert.equal(manifest.projectId, current.project.id, "Site artifact belongs to a different host project");
  assert.equal(manifest.projectSourceRevision, current.projectSourceRevision, "Site artifact is stale; run pnpm demo:build-sites before browser checks");
  assert.deepEqual(manifest.routes, current.build.routes.map(({ pathname }) => pathname), "Site artifact routes differ from the current compiled sitemap");
  // Preserve the exact pinned image revision, not only the source JSON revision.
  for (const { fileName, source } of current.assetFiles) {
    assert.deepEqual(await readFile(join(hostRoot, "dist-site", fileName)), Buffer.from(source), `Site artifact asset differs from the current host: ${fileName}`);
  }
  return manifest;
}

/** @param {readonly string[]} routes */
export function authoringSiteRoutes(routes) {
  return routes.map((pathname) => pathname === "/" ? "/site" : `/site${pathname}`);
}
