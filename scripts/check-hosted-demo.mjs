import { verifyHostedDemoArtifact } from "./hosted-demo/artifact.mjs";

const arguments_ = process.argv.slice(2);
if (arguments_[0] === "--") arguments_.shift();
const directory = arguments_[0] ?? "dist-hosted-demo";
const expectedSourceRevision = arguments_[1];
const proof = await verifyHostedDemoArtifact({ directory, expectedSourceRevision });

console.log(`Hosted demo verified: ${proof.files.length} files, four media assets, source ${proof.manifest.sourceRevision}.`);
