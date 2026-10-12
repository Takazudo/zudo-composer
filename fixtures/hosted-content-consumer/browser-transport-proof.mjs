// Executes the actual local browser HTTP/provider boundary without claiming a browser render.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startBrowserFixture } from "./browser-proof.mjs";
import { fixtureEntry, fixtureDetachedFaq, fixtureAlternateAsset } from "./fixture-data.mjs";
const expected = state => ({ draftRevision: state.draftRevision, baseline: state.baseline, definition: state.definition });
export async function proveBrowserTransport(filename, artifactDirectory) {
  const running = await startBrowserFixture(filename);
  const request = async (path, payload) => {
    const response = await fetch(`${running.url}${path}`, payload === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    return result;
  };
  const execute = command => request("/api/execute", command);
  const pageEntry = state => state.providers[0].entries.find(entry => entry.id === fixtureEntry.recordId);
  try {
    let state = await request("/api/state");
    const initialBaseline = structuredClone(state.baseline);
    for (const [key, values, code] of [
      ["protected-slug", { slug: "forged-route" }, "forbidden"],
      ["active-markdown", { notes: "[run](javascript:alert(1))" }, "invalid-value"],
      ["outside-asset", { image: { ...pageEntry(state).values.image, asset: { providerId: "assets-filesystem", assetId: "outside" } } }, "forbidden"],
    ]) {
      const response = await fetch(`${running.url}/api/execute`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "set-fields", expected: expected(state), operationKey: key, entry: fixtureEntry, values, clear: [] }) });
      assert.equal(response.status, 400);
      assert.equal((await response.json()).code, code);
      assert.deepEqual(await request("/api/state"), state, "Direct forbidden HTTP operation cannot change any durable Content identity/value");
      assert.equal(await request(`/api/receipt?key=${key}`), null, "Rejected operation cannot gain a successful receipt");
    }
    for (const route of ["/composer", "/mapping", "/sitemapper", "/assets", "/uploaded-assets/unapproved.svg"]) {
      assert.equal((await fetch(`${running.url}${route}`)).status, 404, "Restricted fixture never serves developer tools or arbitrary assets");
    }
    const created = await execute({ kind: "create-entry", expected: expected(state), operationKey: "http-create", collectionId: "questions",
      values: { question: "HTTPで作成した質問", answer: "保存済みの回答" }, before: null });
    state = created.state;
    state = (await execute({ kind: "add-entry", expected: expected(state), operationKey: "http-add-existing", collectionId: "questions", entry: fixtureDetachedFaq, before: null })).state;
    assert(pageEntry(state).values.questions.some(ref => ref.recordId === fixtureDetachedFaq.recordId), "Explicit allowed addition includes the detached existing Entry");
    const refs = [...pageEntry(state).values.questions].reverse();
    state = (await execute({ kind: "reorder", expected: expected(state), operationKey: "http-reorder", collectionId: "questions", entries: refs })).state;
    const image = { ...pageEntry(state).values.image, asset: { providerId: fixtureAlternateAsset.providerId, assetId: fixtureAlternateAsset.assetId }, alt: "HTTPで保存した代替テキスト", caption: "承認済みアセットのみ" };
    const savedA = await execute({ kind: "set-fields", expected: expected(state), operationKey: "http-save-a", entry: fixtureEntry,
      values: { title: "HTTP講座A", price: 0, notes: "## 日本語 Markdown\n\n**保存した強調**と[安全なリンク](https://example.com/course)", image }, clear: [] });
    state = savedA.state;
    assert.equal(pageEntry(state).values.price, 0);
    assert.equal(pageEntry(state).values.notes, "## 日本語 Markdown\n\n**保存した強調**と[安全なリンク](https://example.com/course)");
    assert.equal(pageEntry(state).values.image.alt, image.alt);
    const A = (await execute({ kind: "capture-snapshot", expected: expected(state), operationKey: "http-capture-a" })).snapshot;
    assert.deepEqual(A.renderData.questions.map(entry => entry.id), refs.map(ref => ref.recordId));
    assert.equal(A.renderData.image.url, fixtureAlternateAsset.url);
    assert.equal(A.renderData.image.versionId, fixtureAlternateAsset.versionId);
    assert.equal(A.renderData.image.checksum, fixtureAlternateAsset.checksum);
    const beginA = { kind: "begin-publication", expected: expected(state), operationKey: "http-begin-a", snapshotId: A.id };
    const acceptedA = await execute(beginA);
    const publicationA = acceptedA.publication;
    assert.equal((await request(`/api/publication?id=${publicationA.id}`)).status, "verified");
    const savedB = await execute({ kind: "set-fields", expected: expected(state), operationKey: "http-save-b", entry: fixtureEntry, values: { title: "HTTP講座B" }, clear: [] });
    state = savedB.state;
    const receipt = await request("/api/receipt?key=http-save-b");
    await request("/api/provider/integrate", { publicationId: publicationA.id, crashBeforeReconcile: true });
    assert.deepEqual((await request("/api/state")).baseline, initialBaseline, "Remote-only integration models the real reconciliation crash gap");
    const originalBeginReceipt = await request("/api/receipt?key=http-begin-a");
    assert.deepEqual(await execute(beginA), acceptedA, "Lost begin acknowledgement replays original immutable bytes during the remote-only integrated crash gap");
    assert.deepEqual(await request("/api/receipt?key=http-begin-a"), originalBeginReceipt, "Provider recovery cannot rewrite the accepted begin receipt");
    assert.equal((await request("/api/state")).integrationFence, 1, "Exact remote integration replay reconciles at most once");
    await request("/api/restart", {});
    assert.deepEqual(await request("/api/receipt?key=http-save-b"), receipt, "Fresh backend recovers the exact acknowledged B receipt");
    await request("/api/provider/reconcile", { publicationId: publicationA.id });
    state = await request("/api/state");
    assert.equal(pageEntry(state).values.title, "HTTP講座B", "Reconciliation preserves newer B");
    assert.equal(state.integrationFence, 1);
    assert.equal(state.baseline.contentDigest, A.digest);
    const B = (await execute({ kind: "capture-snapshot", expected: expected(state), operationKey: "http-capture-b" })).snapshot;
    const publicationB = (await execute({ kind: "begin-publication", expected: expected(state), operationKey: "http-begin-b", snapshotId: B.id })).publication;
    await request("/api/provider/integrate", { publicationId: publicationB.id });
    const afterB = await request("/api/state");
    assert.equal(afterB.integrationFence, 2);
    assert.equal(afterB.baseline.contentDigest, B.digest);
    await request("/api/provider/reconcile", { publicationId: publicationA.id });
    assert.deepEqual(await request("/api/state"), afterB, "Late A callback cannot regress B2");
    const remote = JSON.parse(await readFile(`${filename}.remote/remote.json`, "utf8"));
    assert.equal(remote.operations.length, 2);
    assert.deepEqual(remote.operations[0].snapshot.renderData, A.renderData);
    assert.deepEqual(remote.operations[1].snapshot.renderData, B.renderData);
    assert.equal(remote.operations[0].snapshot.providers[0].entries.find(entry => entry.id === "home").values.slug, "fixed-home");
    assert.deepEqual(running.providerWarnings, [], "Normal/exact-replay provider work must complete without hidden callback errors");
    const evidence = { proof: "actual-browser-http-provider-transport", node: process.version, browserExecution: "NOT RUN",
      checks: ["direct forbidden field/Markdown/asset rejected without writes or receipts", "developer routes and unapproved assets unavailable", "public create/add-existing/reorder", "exact Markdown and numeric zero", "select different approved image and permitted descriptions", "durable B receipt after real backend restart",
        "synthetic remote A integration crash gap", "lost-ack exact begin replay recovers original receipt and remote integration once", "B preserved during A reconciliation", "exact saved snapshot Submit", "two integrations B0-B1-B2", "late A cannot regress B2"],
      snapshotA: A.id, digestA: A.digest, snapshotB: B.id, digestB: B.digest, createdEntryId: created.createdEntry.recordId, addedExistingEntryId: fixtureDetachedFaq.recordId, approvedSelectedImage: A.renderData.image };
    if (artifactDirectory) {
      await mkdir(artifactDirectory, { recursive: true });
      await writeFile(join(artifactDirectory, "browser-transport-evidence.json"), JSON.stringify(evidence, null, 2));
    }
    console.log(JSON.stringify(evidence));
    return evidence;
  } finally { await running.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const filename = process.argv[2];
  if (!filename) throw Error("Supply a fresh disposable SQLite filename");
  await proveBrowserTransport(resolve(filename), process.argv[3] ? resolve(process.argv[3]) : dirname(resolve(filename)));
}
