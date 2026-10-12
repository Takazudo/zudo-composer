import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const snapshot = JSON.parse(await readFile("src/snapshot.json", "utf8"));
const data = snapshot.renderData;
const visitor = await readFile("dist/index.html", "utf8");
const story = await readFile("dist/styleguide/index.html", "utf8");
for (const [lane, html] of [["ZFB visitor", visitor], ["SG story", story]]) {
  assert(html.includes('data-host-component="host:OfferPage"'), `${lane} must execute the shared host component`);
  assert(html.includes('data-template-id="approved-layout"'), `${lane} lost the linked layout`);
  assert(html.includes('data-outlet="main"'), `${lane} lost the layout outlet`);
  assert(html.includes(data.title), `${lane} title differs`);
  assert(html.includes(`${data.price}円`), `${lane} price differs`);
  assert(html.includes(`src="${data.image.url}"`), `${lane} approved image differs`);
  assert(html.includes(`data-asset-version="${data.image.versionId}"`) && html.includes(`data-asset-checksum="${data.image.checksum}"`), `${lane} image pin differs`);
  const renderedIds = [...html.matchAll(/data-faq-id="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(renderedIds, data.questions.map(item => item.id), `${lane} must contain the exact complete Content-owned membership/order`);
  let position = -1;
  for (const faq of data.questions) {
    const next = html.indexOf(`data-faq-id="${faq.id}"`);
    assert(next > position, `${lane} FAQ membership/order differs for ${faq.id}`);
    assert(html.includes(faq.question) && html.includes(faq.answer), `${lane} FAQ text differs`);
    position = next;
  }
  assert(!html.includes("editor.css") && !html.includes("editor.js"), `${lane} leaked authoring assets`);
}
assert(story.includes('data-sg-story="hosted-offer"'), "Not a real registered SG story");
assert.equal(visitor.match(/<article[\s\S]*?<\/article>/)?.[0], story.match(/<article[\s\S]*?<\/article>/)?.[0], "The actual ZFB and SG component HTML differs");
console.log("Real ZFB static HTML and registered zudo-sg story share exact component, image and FAQ order.");
