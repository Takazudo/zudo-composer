// Offline proof of the persistent local host: real child processes of local.mjs on loopback, one temp --dir.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { get } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fixtureEntry } from "./fixture-data.mjs";

const command = fileURLToPath(new URL("local.mjs", import.meta.url));
// The real renderer is prepared once (local.mjs --prepare) under the repository's .zudo-local/.
export const preparedRendererHost = fileURLToPath(new URL("../../.zudo-local/renderer-host", import.meta.url));
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const pause = milliseconds => new Promise(ready => setTimeout(ready, milliseconds));
const identities = state => ({ draftRevision: state.draftRevision, baseline: state.baseline, definition: state.definition });
const terminal = new Set(["integrated", "failed", "conflict"]);

export function startHost(directory, { faults, args = [], rendererHost = preparedRendererHost } = {}) {
  const child = spawn(process.execPath, [command, "--dir", directory, "--port", "0", "--renderer-host", rendererHost, ...args],
    { env: { ...process.env, ...(faults ? { ZUDO_LOCAL_HOSTED_FAULTS: JSON.stringify(faults) } : {}) }, stdio: ["ignore", "pipe", "pipe"] });
  let output = ""; let errors = "";
  const exited = new Promise(ready => child.once("exit", (code, signal) => ready({ code, signal })));
  child.stderr.on("data", chunk => { errors += chunk; });
  const ready = new Promise((ready, reject) => {
    child.stdout.on("data", chunk => {
      output += chunk;
      const url = output.match(/URL:\s+(\S+)/)?.[1];
      if (url && output.includes("Press Ctrl+C")) ready({ url: url.replace(/\/$/, ""), output });
    });
    void exited.then(result => reject(new Error(`local host exited ${JSON.stringify(result)} before ready: ${errors}`)));
  });
  return { child, exited, ready, get errors() { return errors; },
    async stop() { if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM"); return exited; } };
}

async function api(url, path, payload) {
  const response = await fetch(`${url}${path}`, payload === undefined ? undefined
    : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const body = await response.json();
  if (!response.ok) throw Object.assign(new Error(body.message), { code: body.code, status: response.status });
  return body;
}
const save = async (url, title, operationKey) => api(url, "/api/execute", { kind: "set-fields", operationKey,
  expected: identities(await api(url, "/api/state")), entry: fixtureEntry, values: { title }, clear: [] });
async function captureAndBegin(url, suffix) {
  const state = await api(url, "/api/state");
  const captured = await api(url, "/api/execute", { kind: "capture-snapshot", operationKey: `capture-${suffix}`, expected: identities(state) });
  const beginCommand = { kind: "begin-publication", operationKey: `begin-${suffix}`, expected: identities(state), snapshotId: captured.snapshot.id };
  const begun = await api(url, "/api/execute", beginCommand);
  return { state, snapshot: captured.snapshot, publication: begun.publication, beginCommand };
}
async function waitForPublication(url, id, predicate = row => terminal.has(row.status), timeout = 60_000, settled = true) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const row = (await api(url, "/api/local/publications")).find(item => item.publicationId === id);
    if (row && predicate(row) && !(settled && row.running)) return row;
    if (Date.now() > deadline) throw new Error(`Publication ${id} did not settle: ${JSON.stringify(row)}`);
    await pause(100);
  }
}
async function readArtifact(url, row) {
  // The artifact link redirects to the artifact's own loopback origin, where the unmodified site is served at /.
  const response = await fetch(`${url}${row.artifact.url}`);
  const html = await response.text();
  const story = await (await fetch(new URL("/styleguide/", response.url))).text();
  const { manifest, snapshot } = await api(url, `/api/local/artifact?id=${row.publicationId}`);
  return { html, story, manifest, snapshot, origin: new URL(response.url).origin };
}

export async function assertRendererPrepared() {
  try { await readFile(join(preparedRendererHost, "current.json")); }
  catch (error) { throw new Error(`Prepare the real renderer once first: node fixtures/hosted-content-consumer/local.mjs --prepare (expected ${preparedRendererHost})`, { cause: error }); }
}

export async function runLocalHostProof({ directory } = {}) {
  await assertRendererPrepared();
  const root = directory ? resolve(directory) : await mkdtemp(join(tmpdir(), "composer-local-host-"));
  const dataDir = join(root, "data");
  const evidence = { node: process.version, directory: dataDir, checks: [] };
  const check = (name, condition) => { assert.ok(condition, name); evidence.checks.push(name); };
  let host;
  const restart = async faults => { await host?.stop(); host = startHost(dataDir, { faults }); return (await host.ready).url; };
  try {
    // 1. Fresh start, save, exact snapshot, local publication, artifact over HTTP.
    let url = await restart();
    const shell = await (await fetch(`${url}/`)).text();
    check("shell labels itself local-only and never live", /Local only\./.test(shell) && /Nothing here is live, deployed or in production/.test(shell));
    check("foreign Host header is refused", await new Promise((ready, reject) => get(`${url}/api/state`, { headers: { host: "evil.example" } },
      response => { response.resume(); ready(response.statusCode === 421); }).once("error", reject)));
    const savedA = await save(url, "ローカル講座A", "save-a");
    const A = await captureAndBegin(url, "a");
    check("captured snapshot is exactly the saved revision", A.snapshot.draftRevision === savedA.state.draftRevision && A.snapshot.renderData.title === "ローカル講座A");
    const rowA = await waitForPublication(url, A.publication.id);
    check("local publication A reaches integrated (local) and never deployed", rowA.status === "integrated" && rowA.artifact);
    const artifactA = await readArtifact(url, rowA);
    check("artifact HTML renders the exact snapshot title", artifactA.html.includes("<h1>ローカル講座A</h1>"));
    check("artifact is the real ZFB visitor page and zudo-sg story of that snapshot", artifactA.html.includes('data-host-component="host:OfferPage"')
      && artifactA.story.includes('data-sg-story="hosted-offer"') && artifactA.story.includes("<h1>ローカル講座A</h1>"));
    check("artifact opens on its own loopback origin", artifactA.origin !== url && /^http:\/\/127\.0\.0\.1:\d+$/.test(artifactA.origin));
    check("artifact manifest binds publication, snapshot, digest and operation", artifactA.manifest.publicationId === A.publication.id
      && artifactA.manifest.snapshotId === A.snapshot.id && artifactA.manifest.snapshotDigest === A.snapshot.digest && artifactA.manifest.operationKey === `local-artifact-${A.publication.id}`);
    check("artifact manifest says local, not live", /not live, not production and not deployed/.test(artifactA.manifest.notice));
    check("artifact keeps the complete trusted snapshot", artifactA.snapshot.id === A.snapshot.id && artifactA.snapshot.digest === A.snapshot.digest && artifactA.snapshot.providers[0].entries.find(entry => entry.id === "home").values.slug === "fixed-home");
    const image = Buffer.from(await (await fetch(`${artifactA.origin}/approved.svg`)).arrayBuffer());
    check("artifact image bytes match the snapshot pin", sha256(image) === A.snapshot.renderData.image.checksum);
    check("artifact path traversal is refused", (await fetch(`${url}/local-artifacts/${A.publication.id}/..%2F..%2Fcontent.sqlite`)).status === 404);
    const stateAfterA = await api(url, "/api/state");
    check("local integration advances the local baseline once", stateAfterA.integrationFence === 1 && stateAfterA.baseline.contentDigest === A.snapshot.digest);
    const receiptA = await api(url, "/api/receipt?key=save-a");
    const indexA = await readFile(join(dataDir, "artifacts", A.publication.id, "site", "index.html"));

    // 2. Restart: data, receipts, publications and artifacts survive; normal start never wipes.
    url = await restart();
    check("restart keeps saved content", (await api(url, "/api/state")).providers[0].entries.find(entry => entry.id === "home").values.title === "ローカル講座A");
    check("restart keeps the exact save receipt", JSON.stringify(await api(url, "/api/receipt?key=save-a")) === JSON.stringify(receiptA));
    const rowAfterRestart = (await api(url, "/api/local/publications")).find(row => row.publicationId === A.publication.id);
    check("restart keeps the publication and its artifact link", rowAfterRestart?.status === "integrated" && rowAfterRestart.artifact?.url === rowA.artifact.url);
    check("restart serves identical artifact bytes", (await readArtifact(url, rowA)).html === indexA.toString());

    // 3. Saving C while B is publishing corrupts neither.
    url = await restart({ buildDelayMs: 2500 });
    await save(url, "講座B", "save-b");
    const B = await captureAndBegin(url, "b");
    await waitForPublication(url, B.publication.id, row => row.status === "building" && row.running, 5_000, false);
    const savedC = await save(url, "講座C（Bの公開中に保存）", "save-c");
    const duringC = (await api(url, "/api/local/publications")).find(row => row.publicationId === B.publication.id);
    check("C was saved while B was still generating", duringC.status === "building" && duringC.running && !duringC.artifact);
    check("save during publication succeeds", savedC.state.providers[0].entries.find(entry => entry.id === "home").values.title === "講座C（Bの公開中に保存）");
    const rowB = await waitForPublication(url, B.publication.id);
    const artifactB = await readArtifact(url, rowB);
    check("artifact B contains B, not the newer C", rowB.status === "integrated" && artifactB.html.includes("<h1>講座B</h1>") && !artifactB.html.includes("講座C"));
    const stateAfterB = await api(url, "/api/state");
    check("newer draft C is retained after B integrates", stateAfterB.providers[0].entries.find(entry => entry.id === "home").values.title === "講座C（Bの公開中に保存）"
      && stateAfterB.baseline.contentDigest === B.snapshot.digest && stateAfterB.integrationFence === 2);
    check("artifact A is unchanged by publication B", (await readFile(join(dataDir, "artifacts", A.publication.id, "site", "index.html"))).equals(indexA));

    // 4. Stale notifications: replaying A's begin and retrying A cannot regress anything.
    const replay = await api(url, "/api/execute", A.beginCommand);
    check("exact begin replay returns the original publication", replay.publication.id === A.publication.id);
    await api(url, "/api/local/publications/retry", { publicationId: A.publication.id });
    await pause(300);
    check("stale A notification leaves state and A untouched", JSON.stringify(await api(url, "/api/state")) === JSON.stringify(stateAfterB)
      && (await api(url, "/api/local/publications")).find(row => row.publicationId === A.publication.id).status === "integrated");

    // 5. Lost acknowledgement: the sink persisted the export, the process died before recording it.
    url = await restart({ crashAfterRemoteSubmit: true });
    await save(url, "講座D", "save-d");
    const D = await captureAndBegin(url, "d");
    check("fault process exits after the durable sink write", (await host.exited).code === 75);
    url = await restart();
    const rowD = await waitForPublication(url, D.publication.id);
    check("lost acknowledgement recovers to one integrated artifact after restart", rowD.status === "integrated" && (await readArtifact(url, rowD)).html.includes("<h1>講座D</h1>"));
    const remote = JSON.parse(await readFile(join(dataDir, "publication", "remote.json"), "utf8"));
    check("recovery never duplicates the sink operation", remote.operations.filter(operation => operation.publicationId === D.publication.id).length === 1);

    // 6. Failed artifact generation is reported, retains the draft and completes after restart.
    url = await restart({ failBuildOnce: true });
    const savedE = await save(url, "講座E", "save-e");
    const E = await captureAndBegin(url, "e");
    const failedE = await waitForPublication(url, E.publication.id, row => row.status === "unavailable");
    check("failed generation is reported as unavailable with no artifact", !failedE.artifact && /Local artifact generation failed/.test(failedE.message));
    check("failed generation retains the saved draft", (await api(url, "/api/state")).draftRevision === savedE.state.draftRevision);
    url = await restart();
    const rowE = await waitForPublication(url, E.publication.id);
    check("failed job completes after restart", rowE.status === "integrated" && (await readArtifact(url, rowE)).html.includes("<h1>講座E</h1>"));

    // 7. Crash after the artifact rename and after sink integration both resume without rewriting.
    url = await restart({ crashAfterArtifact: true });
    await save(url, "講座F", "save-f");
    const F = await captureAndBegin(url, "f");
    check("fault process exits after the artifact commit", (await host.exited).code === 75);
    const manifestF = await readFile(join(dataDir, "artifacts", F.publication.id, "local-artifact.json"), "utf8");
    // Startup recovery itself hits this fault, so the process may exit before it reports ready.
    await host.stop();
    host = startHost(dataDir, { faults: { crashAfterRemoteIntegration: true } });
    host.ready.catch(() => undefined);
    check("fault process exits after sink integration", (await host.exited).code === 75);
    url = await restart();
    const rowF = await waitForPublication(url, F.publication.id);
    check("crash gaps reconcile to integrated, reusing the committed artifact", rowF.status === "integrated"
      && await readFile(join(dataDir, "artifacts", F.publication.id, "local-artifact.json"), "utf8") === manifestF);
    check("local baseline equals the sink baseline after reconciliation", JSON.stringify((await api(url, "/api/state")).baseline)
      === JSON.stringify(JSON.parse(await readFile(join(dataDir, "publication", "remote.json"), "utf8")).baseline));

    // 8. A terminal export failure retains the draft and the next publication succeeds.
    url = await restart({ failExportOnce: true });
    await save(url, "講座G", "save-g");
    const G = await captureAndBegin(url, "g");
    const rowG = await waitForPublication(url, G.publication.id);
    check("terminal export failure is reported failed without an artifact", rowG.status === "failed" && !rowG.artifact);
    const H = await captureAndBegin(url, "h");
    check("a later publication of the retained draft succeeds", (await waitForPublication(url, H.publication.id)).status === "integrated");

    // 9. Safety: an unprepared renderer is explained, never installed; one host per directory; reset is explicit.
    const unprepared = startHost(join(root, "unprepared-data"), { rendererHost: join(root, "no-renderer") });
    await unprepared.ready.then(() => assert.fail("started without renderer"), () => undefined);
    check("a missing real renderer stops the start with the --prepare instruction", /not prepared[\s\S]*--prepare/.test(unprepared.errors));
    const second = startHost(dataDir);
    await second.ready.then(() => assert.fail("second host started"), () => undefined);
    check("a second host on the same directory is refused", /Another local host/.test(second.errors));
    const foreign = join(root, "foreign"); await mkdir(foreign); await writeFile(join(foreign, "keep.txt"), "user file");
    const foreignHost = startHost(foreign, { args: ["--reset"] });
    await foreignHost.ready.then(() => assert.fail("foreign reset"), () => undefined);
    check("reset refuses a directory the host did not create", (await readFile(join(foreign, "keep.txt"), "utf8")) === "user file");
    await host.stop();
    host = startHost(dataDir, { args: ["--reset"] });
    url = (await host.ready).url;
    check("explicit reset starts from the seed", (await api(url, "/api/state")).draftRevision === "r0" && (await api(url, "/api/local/publications")).length === 0);
    return evidence;
  } catch (error) {
    if (host) error.message += `\nhost stderr:\n${host.errors}`;
    throw error;
  } finally {
    await host?.stop();
    if (!directory) await rm(root, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const evidence = await runLocalHostProof({ directory: process.argv[2] });
  console.log(JSON.stringify({ proof: "persistent-local-host", checks: evidence.checks.length, node: evidence.node }, null, 2));
  for (const name of evidence.checks) console.log(`PASS ${name}`);
}
