// @ts-check
import assert from "node:assert/strict";

/** A host revision is an optional opaque identifier, not the tool's Git SHA.
 * @param {string | undefined} sourceRevision
 * @param {Record<string, string | undefined>} [env]
 * @returns {string | undefined}
 */
export function resolveSiteSourceRevision(sourceRevision, env = process.env) {
  const revision = sourceRevision === undefined ? (env.GITHUB_SHA || undefined) : sourceRevision;
  assert.ok(revision === undefined || (typeof revision === "string" && revision.trim().length > 0), "Site sourceRevision must be a nonempty string when supplied");
  return revision;
}
