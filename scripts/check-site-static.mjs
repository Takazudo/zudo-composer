// @ts-check
// `node scripts/check-site-static.mjs <dist-site dir> [expected host revision]`
import { verifySiteStaticArtifact } from "../server/site-build.mjs";

const arguments_ = process.argv.slice(2);
if (arguments_[0] === "--") arguments_.shift();
const directory = arguments_[0];
if (!directory) {
  console.error("Usage: node scripts/check-site-static.mjs <dist-site directory> [expected source revision]");
  process.exit(1);
}
const manifest = await verifySiteStaticArtifact({ directory, expectedSourceRevision: arguments_[1] });
console.log(`Static site verified: ${manifest.projectId}, ${Object.keys(manifest.files).length} files, ${manifest.routes.length} routes, tool ${manifest.tool.name}@${manifest.tool.version}${manifest.sourceRevision === undefined ? "" : `, source ${manifest.sourceRevision}`}.`);
