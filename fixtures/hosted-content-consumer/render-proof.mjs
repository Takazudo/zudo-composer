import assert from "node:assert/strict";
import { mkdir, writeFile, copyFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createFixtureSeed, createFixtureService, fixtureActor, fixtureEntry } from "./fixture-data.mjs";
import { initializeSqliteDatabase, openSqliteHandle } from "./sqlite-storage.mjs";
import { projectHostedContent } from "./renderer/src/project.ts";
export const rendererRoot = join(dirname(fileURLToPath(import.meta.url)), "renderer");
const identities = state => ({ draftRevision: state.draftRevision, baseline: state.baseline, definition: state.definition });
export async function prepareRenderProof(filename) {
  await initializeSqliteDatabase(filename, createFixtureSeed());
  const handle = openSqliteHandle(filename);
  try {
    const service = createFixtureService(handle.storage, projectHostedContent);
    let state = await service.readState(fixtureActor);
    const created = await service.execute(fixtureActor, { kind: "create-entry", operationKey: "render-create-faq", expected: identities(state),
      collectionId: "questions", values: { question: "新規ドラフトの質問", answer: "保存された同じ順序で表示します。" }, before: null });
    state = created.state;
    assert(created.createdEntry, "Creation must return the server-issued Entry identity");
    const original = state.providers[0].entries.find(entry => entry.id === "home").values.questions;
    const reordered = [...original].reverse();
    const ordered = await service.execute(fixtureActor, { kind: "reorder", operationKey: "render-reorder-faq", expected: identities(state), collectionId: "questions", entries: reordered });
    state = ordered.state;
    const captured = await service.execute(fixtureActor, { kind: "capture-snapshot", operationKey: "render-capture", expected: identities(state) });
    const snapshot = captured.snapshot;
    assert(snapshot && snapshot.renderData.questions[0].id === created.createdEntry.recordId);
    assert.equal(snapshot.providers[0].entries.find(entry => entry.id === created.createdEntry.recordId).lifecycle, "draft");
    await mkdir(join(rendererRoot, "src"), { recursive: true });
    await writeFile(join(rendererRoot, "src/snapshot.json"), JSON.stringify(snapshot, null, 2));
    await writeFile(join(rendererRoot, "public/approved.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#d3b779"/><circle cx="160" cy="90" r="50" fill="#172b36"/></svg>');
    return snapshot;
  } finally { handle.close(); }
}
export function run(command, args, cwd = rendererRoot) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? resolveRun() : reject(Error(`${command} exited ${code ?? signal}`)));
  });
}
export async function buildRenderer() {
  await run(process.execPath, ["scripts/build-preview.mjs"]);
  await run("corepack", ["pnpm", "exec", "zfb", "build"]);
  await run(process.execPath, ["scripts/verify-static.mjs"]);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const filename = resolve(process.argv[2] ?? "work/render-proof.sqlite");
  const snapshot = await prepareRenderProof(filename);
  await buildRenderer();
  console.log(JSON.stringify({ proof: "real-zfb-sg-static", snapshotId: snapshot.id, digest: snapshot.digest, draftRevision: snapshot.draftRevision }));
}
