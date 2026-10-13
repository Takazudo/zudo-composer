import { readFile, writeFile } from "node:fs/promises";
import { h } from "@takazudo/zfb/zudo-react";
import { islandRoot, renderToString } from "@takazudo/zfb/zudo-react/server";
import { HostDocumentBody } from "../src/OfferPage.tsx";
import { offerProjection } from "../src/project.ts";
import assert from "node:assert/strict";
import { hostComponentIdentity } from "../src/identity.ts";
const snapshot = JSON.parse(await readFile("src/snapshot.json", "utf8"));
// Generate the real SDK mount boundary, including its identity/protocol/transport
// metadata. The receiver later mounts this same component with the exact request.
const root = renderToString(islandRoot(h(HostDocumentBody, { data: offerProjection(snapshot.renderData) }), {
  identity: hostComponentIdentity, skipSsr: true,
}));
if (!root.startsWith("<div ")) throw Error("The SDK preview root must be its supported div boundary");
for (const [attribute, value] of Object.entries({ "data-zfb-island-skip-ssr": hostComponentIdentity.component, "data-zfb-build": hostComponentIdentity.build, "data-zfb-protocol": "zudo-react/1", "data-zfb-transport": "json/1" })) assert(root.includes(`${attribute}="${value}"`), `SDK preview boundary lacks ${attribute}`);
assert(root.includes("data-props="), "SDK preview boundary must carry its real serialized props transport");
const boundary = root.replace("<div ", '<div id="visitor-root" ');
const template = await readFile("public/preview.html", "utf8");
const marker = /<!--preview-boundary:start-->[\s\S]*?<!--preview-boundary:end-->/;
if (!marker.test(template)) throw Error("Missing explicit host preview boundary placeholder");
await writeFile("public/preview.html", template.replace(marker, `<!--preview-boundary:start-->${boundary}<!--preview-boundary:end-->`));
