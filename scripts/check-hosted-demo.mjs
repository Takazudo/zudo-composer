// `pnpm hosted-demo:verify [directory] [expectedSha]`
// Target selection: HOSTED_DEMO_TARGET env var (default "zudo-composer").
// Dispatches to the hosted composer demo's own artifact contract or a static
// demo site's, matching whichever target is selected.
import { DEFAULT_TARGET_KEY, resolveTarget } from "./hosted-demo/targets.mjs";

const arguments_ = process.argv.slice(2);
if (arguments_[0] === "--") arguments_.shift();
const target = resolveTarget(process.env.HOSTED_DEMO_TARGET ?? DEFAULT_TARGET_KEY);
const directory = arguments_[0] ?? target.artifactDirectory;
const expectedSourceRevision = arguments_[1];
const artifact = await target.verifyArtifact({ directory, expectedSourceRevision });

console.log(
  target.kind === "hosted-demo"
    ? `Hosted demo verified: ${artifact.files.length} files, six asset files, source ${artifact.manifest.sourceRevision}.`
    : target.kind === "doc-site"
      ? `Doc site verified: ${artifact.files.length} files, ${artifact.manifest.routes.length} routes${artifact.manifest.sourceRevision === undefined ? "" : `, source ${artifact.manifest.sourceRevision}`}.`
      : `Static site verified: ${artifact.manifest.projectId}, ${Object.keys(artifact.manifest.files).length} files, ${artifact.manifest.routes.length} routes, source ${artifact.manifest.sourceRevision}.`,
);
