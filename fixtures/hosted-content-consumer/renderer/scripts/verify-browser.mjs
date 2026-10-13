import assert from "node:assert/strict";
/* global document, NodeFilter */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
const base = process.argv[2];
if (!base) throw Error("Supply the local independent host server URL");
const snapshot = JSON.parse(await readFile("src/snapshot.json", "utf8"));
const browser = await chromium.launch({ headless: true });
let review;
const errors = []; const consoleMessages = []; const failedRequests = [];
function canonicalComponent(node) {
  const clone = node.cloneNode(true);
  const walker = node.ownerDocument.createTreeWalker(clone, NodeFilter.SHOW_COMMENT);
  const ownership = [];
  while (walker.nextNode()) if (/^\/?zr:1:/.test(walker.currentNode.nodeValue ?? "")) ownership.push(walker.currentNode);
  for (const marker of ownership) marker.remove();
  return clone.innerHTML;
}
try {
  const noJs = await browser.newContext({ javaScriptEnabled: false });
  const visitor = await noJs.newPage();
  await visitor.goto(base, { waitUntil: "networkidle" });
  const article = visitor.locator('[data-host-component="host:OfferPage"]');
  await article.locator("h1").waitFor();
  assert.equal(await article.locator("h1").textContent(), snapshot.renderData.title);
  const canonical = await article.innerHTML();
  const notes = article.locator("[data-host-notes]");
  assert(await notes.locator("h1,h2,h3,h4,h5,h6").count() > 0, "No-JS Notes must contain rendered headings");
  assert(await notes.locator("strong").count() > 0, "No-JS Notes must contain rendered bold text");
  assert(await notes.locator('a[href^="https://"]').count() > 0, "No-JS Notes must contain real safe links");
  assert(await article.locator("img").evaluate((image) => image.complete && image.naturalWidth > 0), "No-JS approved image failed");
  await visitor.goto(new URL("/styleguide/", base).href);
  assert.equal(await visitor.locator('[data-sg-story="hosted-offer"] article').innerHTML(), canonical);
  const context = await browser.newContext();
  review = await context.newPage();
  review.on("pageerror", (error) => errors.push(error.message));
  review.on("console", message => consoleMessages.push({ type: message.type(), text: message.text() }));
  review.on("requestfailed", request => failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
  review.on("response", response => { if (response.status() >= 400) failedRequests.push({ url: response.url(), status: response.status() }); });
  await review.goto(new URL("/review.html", base).href);
  await review.waitForFunction(() => ["rendered", "error"].includes(document.querySelector("#preview-status")?.getAttribute("data-state") ?? ""));
  assert.equal(await review.locator("#preview-status").getAttribute("data-state"), "rendered", await review.locator("#preview-status").textContent());
  assert.equal(await review.locator("#preview-status").getAttribute("data-snapshot-id"), snapshot.id);
  assert.equal(await review.locator("#preview-status").getAttribute("data-digest"), snapshot.digest);
  const frame = review.frameLocator("#snapshot-preview");
  const mounted = await frame.locator("article").innerHTML();
  assert(mounted.includes("<!--zr:1:"), "Real SDK mount must retain its reserved ownership markers");
  assert.equal(await frame.locator("article").evaluate(canonicalComponent), canonical, "Exact component DOM must match after excluding only SDK ownership comments");
  assert(await frame.locator("[data-host-notes] strong").count() > 0, "Acknowledged iframe must render bold Notes, not literal Markdown source");
  assert.equal(await frame.locator("#visitor-root").getAttribute("data-snapshot-id"), snapshot.id);
  assert.deepEqual(errors, []);
  console.log("JavaScript-disabled ZFB visitor, real registered SG story and acknowledged zudo-react iframe match exactly.");
} catch (error) {
  const directory = "browser-failure"; await mkdir(directory, { recursive: true });
  const diagnostics = { message: error instanceof Error ? error.message : String(error), snapshotId: snapshot.id, errors, consoleMessages, failedRequests,
    status: review ? await review.locator("#preview-status").evaluate(node => ({ text: node.textContent, attributes: Object.fromEntries([...node.attributes].map(attribute => [attribute.name, attribute.value])) })).catch(() => null) : null,
    frames: review ? await Promise.all(review.frames().map(async frame => ({ url: frame.url(), html: await frame.content().catch(failure => String(failure)) }))) : [] };
  await writeFile(`${directory}/preview-diagnostics.json`, JSON.stringify(diagnostics, null, 2));
  if (review) await review.screenshot({ path: `${directory}/preview-failure.png`, fullPage: true }).catch(() => undefined);
  console.error(JSON.stringify(diagnostics));
  throw error;
} finally { await browser.close(); }
