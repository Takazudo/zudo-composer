// Worker/D1 Article host boundaries over HTTP: runtime graph, refusal without trusted configuration, remote refusal,
// loopback Host/Origin checks, launcher restarts on one D1 directory, and an interrupted publication resumed after a
// runtime restart. Local only; the fake provider is never model evidence.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startD1Runtime } from "../d1-runtime.mjs";
import { snapshotD1Database } from "../d1-storage.mjs";
import { articleRef } from "./article-data.mjs";
import { buildArticleWorker, startWorkerArticleCms } from "./worker-host.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const welcome = articleRef("welcome");
const identities = state => ({ draftRevision: state.draftRevision, baseline: state.baseline, definition: state.definition });

async function launch(directory, args) {
  const child = spawn(process.execPath, [join(here, "worker-host.mjs"), "--data", directory, ...args], { stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { output += chunk; });
  const url = await new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error(`launcher did not start:\n${output}`)), 60_000);
    child.stdout.on("data", () => { const match = /(http:\/\/127\.0\.0\.1:\d+)\//.exec(output); if (match && output.includes("Data is kept.")) { clearTimeout(timer); done(match[1]); } });
    child.on("exit", code => { clearTimeout(timer); fail(new Error(`launcher exited ${code}:\n${output}`)); });
  });
  return { url, output: () => output, async stop() { child.kill("SIGINT"); await once(child, "exit"); } };
}

export async function runWorkerHostProof({ directory } = {}) {
  const root = directory ? resolve(directory) : await mkdtemp(join(tmpdir(), "article-worker-host-"));
  const evidence = { checks: [] };
  const check = (name, condition) => { assert.ok(condition, name); evidence.checks.push(name); };
  const { script, inputs } = await buildArticleWorker();
  check("the Worker bundle holds no node:, SQLite, filesystem, child process, hosted-content/node or private Composer module",
    inputs.length > 0 && !inputs.some(input => /node:|sqlite|child_process|hosted-content\/node|zudo-composer\/src\//.test(input)) && !/from\s*["']node:/.test(script));
  evidence.workerInputs = inputs.filter(input => !input.startsWith("article-ui:")).map(input => input.replace(/^.*node_modules\//, "node_modules/"));

  // Without the trusted local-fixture configuration the Worker refuses everything: no anonymous owner fallback.
  const bare = await startD1Runtime({ persist: join(root, "unconfigured"), script, name: "article-unconfigured" });
  try {
    const answers = await Promise.all(["/", "/api/state", "/api/host"].map(path => bare.fetch(`http://127.0.0.1/${path.slice(1)}`).then(async response => [response.status, (await response.json()).code])));
    check("an unconfigured Worker refuses every request with configuration-required", answers.every(([status, code]) => status === 503 && code === "configuration-required"));
  } finally { await bare.dispose(); }
  await assert.rejects(startD1Runtime({ persist: join(root, "remote"), bindings: { OTHER: { type: "d1", id: "x", dev: { remote: true } } } }), /Remote bindings are refused/);
  check("a remote binding is refused before any runtime starts", true);
  const remoteFlag = spawn(process.execPath, [join(here, "worker-host.mjs"), "--remote", "--data", join(root, "never"), "--ai", "fake"], { stdio: ["ignore", "pipe", "pipe"] });
  let remoteOutput = ""; remoteFlag.stderr.on("data", chunk => { remoteOutput += chunk; });
  const [remoteCode] = await once(remoteFlag, "exit");
  check("a remote execution flag is refused by the launcher", remoteCode !== 0 && /Remote execution flag --remote is refused/.test(remoteOutput));

  // A data directory whose local D1 holds an unrelated database: the host refuses to start and changes nothing.
  const foreign = join(root, "foreign-data");
  const prepareForeign = await startD1Runtime({ persist: join(foreign, "d1-state"), name: "article-cms-local" });
  let foreignBefore;
  try {
    const db = await prepareForeign.database();
    await db.batch([db.prepare("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)"), db.prepare("INSERT INTO notes (body) VALUES ('not an Article store')")]);
    foreignBefore = await snapshotD1Database(db);
  } finally { await prepareForeign.dispose(); }
  const foreignStart = await startWorkerArticleCms({ directory: foreign }).then(started => started.close().then(() => "started"), error => error);
  const inspectForeign = await startD1Runtime({ persist: join(foreign, "d1-state"), name: "article-cms-local" });
  try {
    check("a data directory holding an unrelated D1 database is refused at startup and left exactly as it was",
      foreignStart?.code === "storage-incompatible" && JSON.stringify(await snapshotD1Database(await inspectForeign.database())) === JSON.stringify(foreignBefore));
  } finally { await inspectForeign.dispose(); }

  // Launcher restarts on one directory: the first start seeds, later starts reopen; Host and Origin are checked.
  const data = join(root, "worker-data");
  let host = await startWorkerArticleCms({ directory: data, faults: { stopAfterVerified: true } });
  const port = Number(new URL(host.url).port);
  try {
    const api = async (path, body) => {
      const response = await fetch(`${host.url}${path}`, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const value = await response.json();
      if (!response.ok) throw Object.assign(new Error(value.message), { code: value.code, status: response.status });
      return value;
    };
    check("the first start seeds an absent local D1 database", host.seeded === true);
    const foreignHost = await new Promise((done, fail) => httpRequest(`${host.url}/api/state`, { headers: { host: "attacker.example" } }, response => { response.resume(); done(response.statusCode); }).on("error", fail).end());
    check("another Host name is refused", foreignHost === 421);
    check("a cross-origin write is refused", (await fetch(`${host.url}/api/execute`, { method: "POST", headers: { "content-type": "application/json", origin: "http://attacker.example" }, body: "{}" })).status === 403);
    check("the host reports Worker + local D1, local only and not deployed", JSON.stringify(await api("/api/host")) === JSON.stringify({ backend: "worker-d1", label: "Worker + local D1", local: true, deployed: false, sessionMode: "local-fixture", ai: "Fake provider (offline, deterministic)" }));

    // Interrupted publication: the proof binding stops it after the artifact is verified, before activation.
    await api("/api/execute", { kind: "set-fields", operationKey: "worker-publish-a", expected: identities(await api("/api/state")), entry: welcome, values: { title: "Worker A" }, clear: [] });
    const state = await api("/api/state");
    const snapshot = (await api("/api/execute", { kind: "capture-snapshot", operationKey: "worker-capture-a", expected: identities(state) })).snapshot;
    const submitted = (await api("/api/execute", { kind: "begin-publication", operationKey: "worker-submit-a", expected: identities(state), snapshotId: snapshot.id })).publication;
    let interrupted;
    for (let attempt = 0; attempt < 200 && interrupted?.status !== "verified"; attempt++) { interrupted = await api(`/api/publication?id=${submitted.id}`); await new Promise(done => setTimeout(done, 25)); }
    check("an interrupted publication stops verified, with artifact identity and digest recorded, and not activated",
      interrupted.status === "verified" && interrupted.facts?.artifact === submitted.id && /^[a-f0-9]{64}$/.test(interrupted.facts?.artifactDigest ?? "")
      && (await api(`/api/entry?q=${encodeURIComponent(JSON.stringify({ perspective: "published", entry: welcome }))}`)).values.title !== "Worker A");
    await host.close();
    host = await startWorkerArticleCms({ directory: data, port });
    await host.settled();
    const resumed = await api("/api/publication-status");
    const rows = (await (await host.database()).prepare("SELECT count(*) AS n FROM article_artifact").first()).n;
    check("after a runtime restart the persisted intent resumes to one activation and one artifact", host.seeded === false && resumed.submission.status === "integrated"
      && resumed.artifact === submitted.id && rows === 1 && resumed.deployed === false
      && (await api(`/api/entry?q=${encodeURIComponent(JSON.stringify({ perspective: "published", entry: welcome }))}`)).values.title === "Worker A");
    const artifact = await fetch(`${host.url}/artifacts/${submitted.id}/`).then(response => response.text());
    check("the local artifact is served from D1 and renders the reviewed snapshot", artifact.includes("Worker A"));
    // Late or repeated activation evidence cannot regress the baseline.
    await host.close();
    host = await startWorkerArticleCms({ directory: data, port });
    check("repeated starts never reseed or regress the activated baseline", host.seeded === false && (await api("/api/publication-status")).activated.integrationFence === resumed.activated.integrationFence);
  } finally { await host.close(); }

  // The documented launcher, as separate processes on one directory: fake, then off, then fake.
  const cli = join(root, "cli-data");
  let process1 = await launch(cli, ["--ai", "fake", "--port", "0"]);
  try {
    check("the launcher prints its local-only status, backend and seed state", /Worker \+ local D1/.test(process1.output()) && /seeded now/.test(process1.output()) && /not production login/.test(process1.output()));
    const saved = await fetch(`${process1.url}/api/state`).then(response => response.json());
    await fetch(`${process1.url}/api/execute`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "set-fields", operationKey: "cli-save", expected: identities(saved), entry: welcome, values: { title: "Saved through the launcher" }, clear: [] }) });
  } finally { await process1.stop(); }
  process1 = await launch(cli, ["--ai", "off", "--port", "0"]);
  try {
    const status = await fetch(`${process1.url}/api/ai`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "content-ai-status", payload: {} }) }).then(response => response.json());
    const value = await fetch(`${process1.url}/api/entry?q=${encodeURIComponent(JSON.stringify({ perspective: "working", entry: welcome }))}`).then(response => response.json());
    check("a separate --ai off process reopens the same D1 state and reports inference off", /reopened/.test(process1.output()) && status.value.inference.code === "off" && value.values.title === "Saved through the launcher");
  } finally { await process1.stop(); }
  if (!directory) await rm(root, { recursive: true, force: true });
  return evidence;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const evidence = await runWorkerHostProof({ directory: process.argv[2] });
  console.log(JSON.stringify({ proof: "article-worker-host", checks: evidence.checks.length, workerInputs: evidence.workerInputs.length }, null, 2));
  for (const name of evidence.checks) console.log(`PASS ${name}`);
}
