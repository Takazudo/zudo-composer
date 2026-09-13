// `HOSTED_DEMO_TARGET=<target> pnpm hosted-demo:verify [directory] [expectedSha]`
// Target selection is explicit because the registry contains several
// production artifacts with different verification contracts.
// Dispatches to the selected editor, static-site or documentation artifact
// contract.
import { resolveTarget } from "./hosted-demo/targets.mjs";

const arguments_ = process.argv.slice(2);
if (arguments_[0] === "--") arguments_.shift();
const target = resolveTarget(process.env.HOSTED_DEMO_TARGET);
const directory = arguments_[0] ?? target.artifactDirectory;
const expectedSourceRevision = arguments_[1];
const artifact = await target.verifyArtifact({ directory, expectedSourceRevision });

console.log(
  target.kind === "demo-editor"
    ? `Demo editor verified: ${artifact.manifest.hostId}, ${artifact.files.length} files, ${Object.keys(artifact.manifest.assets).length} asset files, ${artifact.manifest.routes.length} routes, source ${artifact.manifest.sourceRevision}.`
    : target.kind === "doc-site"
      ? `Doc site verified: ${artifact.files.length} files, ${artifact.manifest.routes.length} routes${artifact.manifest.sourceRevision === undefined ? "" : `, source ${artifact.manifest.sourceRevision}`}.`
      : `Static site verified: ${artifact.manifest.projectId}, ${Object.keys(artifact.manifest.files).length} files, ${artifact.manifest.routes.length} routes, source ${artifact.manifest.sourceRevision}.`,
);
