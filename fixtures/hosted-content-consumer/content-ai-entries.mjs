// Runtime smoke for the advertised Content-AI imports of an installed host: the Node-safe entries load and
// export what the guide names, the browser entries resolve, and /hosted-content/browser is not an entry.
import assert from "node:assert/strict";
import * as portable from "zudo-composer/hosted-content";
import * as node from "zudo-composer/hosted-content/node";

for (const name of ["createHostedContentEditorial", "createContentAiService", "createMemoryContentAiProposalStore", "createFakeContentAiProposer", "contentAiCandidateDigest", "runContentAiOperation", "EditorialError"])
  assert.equal(typeof portable[name], "function", `zudo-composer/hosted-content exports ${name}`);
assert.deepEqual([...portable.CONTENT_AI_FIELD_KEYS], ["title", "body"]);
assert.equal(typeof node.createContentAiProvider, "function", "zudo-composer/hosted-content/node exports createContentAiProvider");
const fake = await node.createContentAiProvider({ provider: "fake" });
assert.equal((await fake.inference()).state, "ready");
for (const entry of ["zudo-composer/hosted-content/editor", "zudo-composer/hosted-content/editor.css", "zudo-composer/hosted-content/preview", "zudo-composer/hosted-content/testing"])
  assert.match(import.meta.resolve(entry), /node_modules\/zudo-composer\/server\/hosted-content\//, `${entry} resolves to the shipped build`);
assert.throws(() => import.meta.resolve("zudo-composer/hosted-content/browser"), error => error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED", "/hosted-content/browser is not a package entry");
console.log("Content-AI entries: hosted-content, /editor, /editor.css, /preview, /testing and /node resolve; /browser is not exported.");
