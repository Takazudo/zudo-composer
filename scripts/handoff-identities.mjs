// @ts-check
import assert from "node:assert/strict";

/** Keep the permanent provenance/provider/tree/contract set exact. A consumer
 * install example may independently name a full tool commit; it is not a new
 * permanent identity. Only that package's explicit Git spec in the installation
 * section is separated, never free prose, provider refs or contract refs.
 * @param {{readme: string, guidance: string, permanent: string[]}} options */
export function assertHandoffHashes({ readme, guidance, permanent }) {
  const all = `${readme}\n${guidance}`;
  const abbreviated = [...all.matchAll(/(?<![a-f0-9])[a-f0-9]{7,39}(?![a-f0-9])/gi)].map(([hash]) => hash);
  assert.deepEqual(abbreviated, [], "README/CLAUDE must not publish abbreviated or provisional checkpoint hashes");

  const identities = readme.replace(/(^## Installing into a host project\s*\n)([\s\S]*?)(?=^## |$(?![\s\S]))/m, (_section, heading, body) =>
    heading + body.replace(/(?<![\w@/.-])zudo-composer@git\+https:\/\/github\.com\/Takazudo\/zudo-composer\.git#[a-f0-9]{40}(?![a-f0-9])/gi, "zudo-composer@<consumer-install-reference>"));
  const hashes = new Set([...`${identities}\n${guidance}`.matchAll(/\b[a-f0-9]{40}\b/gi)].map(([hash]) => hash.toLowerCase()));
  assert.deepEqual(hashes, new Set(permanent), "README/CLAUDE permanent identities must contain only the four provenance/provider/tree/contract hashes");
}
