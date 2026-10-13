// Local synthetic publication/render proof; never invokes a live publisher or deployment.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runFixturePublicationProof } from "./publication-proof.mjs";
import { buildRenderer, rendererRoot } from "./render-proof.mjs";
const hostRoot = dirname(fileURLToPath(import.meta.url));
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
async function inventory(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(join(directory, prefix), { withFileTypes: true })) {
    const relative = join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await inventory(directory, relative));
    else if (entry.isFile()) files.push({ path: relative, sha256: sha256(await readFile(join(directory, relative))) });
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}
export async function provePublicationRendering(artifactDirectory) {
  const artifacts = resolve(artifactDirectory);
  await mkdir(artifacts, { recursive: true });
  const result = await runFixturePublicationProof({ directory: join(artifacts, "persisted-systems"), artifactDirectory: join(artifacts, "publication") });
  const packageManifest = JSON.parse(await readFile(join(hostRoot, "package.json"), "utf8"));
  const rendererManifest = JSON.parse(await readFile(join(rendererRoot, "package.json"), "utf8"));
  assert.equal(rendererManifest.dependencies["zudo-composer"], packageManifest.dependencies["zudo-composer"], "Node publication and visitor use the same installed public package identity");
  const toolSpec = rendererManifest.dependencies["zudo-composer"];
  assert.match(toolSpec, /^git\+https:\/\/github\.com\/Takazudo\/zudo-composer\.git#[a-f0-9]{40}$/);
  const evidence = { installedToolSpec: toolSpec, installedToolSha: toolSpec.split("#")[1], node: process.version,
    publication: result.evidence, cycles: [], browser: "not executed by this Node/static proof; separate real browser acceptance required",
    system: "persisted local synthetic publication sink; no live Git/API publication or deployment" };
  for (const trace of result.snapshots) {
    assert.notEqual(trace.A.id, trace.B.id, "Each publication names its own immutable saved snapshot");
    assert.notEqual(trace.A.digest, trace.B.digest, "A and B must represent distinct candidate content");
    const targetField = trace.scenario === "new-entry" ? "question" : "title";
    for (const cycle of ["A", "B"]) {
      const snapshot = trace[cycle];
      const candidateEntry = snapshot.providers.find(provider => provider.providerId === trace.target.providerId)?.entries.find(entry => entry.id === trace.target.recordId);
      assert(candidateEntry, "Complete publication candidate contains its original target Entry");
      const mappedValue = trace.scenario === "new-entry" ? snapshot.renderData.questions.find(question => question.id === trace.target.recordId)?.question : snapshot.renderData.title;
      assert.equal(mappedValue, candidateEntry.values[targetField], "Shared host projection maps the exact persisted publication candidate");
      if (trace.scenario === "new-entry") assert.equal(candidateEntry.lifecycle, "published", "Delivery includes the new Entry while newer authoring work may remain a draft");
      await writeFile(join(rendererRoot, "src/snapshot.json"), JSON.stringify(snapshot, null, 2));
      await buildRenderer();
      const output = join(artifacts, `${trace.scenario}-${cycle}`);
      await mkdir(output, { recursive: true });
      await cp(join(rendererRoot, "dist"), join(output, "dist"), { recursive: true });
      await cp(join(rendererRoot, "preview-metafile.json"), join(output, "preview-metafile.json"));
      await writeFile(join(output, "snapshot.json"), JSON.stringify(snapshot, null, 2));
      const visitor = await readFile(join(output, "dist/index.html"), "utf8");
      const styleguide = await readFile(join(output, "dist/styleguide/index.html"), "utf8");
      assert(visitor.includes(mappedValue) && styleguide.includes(mappedValue), "Real static visitor and registered SG story both render this publication's exact target value");
      const graph = JSON.parse(await readFile(join(output, "preview-metafile.json"), "utf8"));
      assert(!Object.keys(graph.inputs).some(input => /preact|codemirror|src\/hosted-content\/editor|node:|virtual:/.test(input)), "Same neutral browser bundle retains no editor/Node graph");
      const staticFiles = await inventory(join(output, "dist"));
      const deliveredImage = staticFiles.find(file => file.path === snapshot.renderData.image.url.slice(1));
      assert.equal(deliveredImage?.sha256, snapshot.renderData.image.checksum, "Actual emitted image bytes match the exact publication pin");
      evidence.cycles.push({ scenario: trace.scenario, cycle, snapshotId: snapshot.id, digest: snapshot.digest,
        draftRevision: snapshot.draftRevision, targetEntryId: trace.target.recordId, targetField, exactMappedValue: mappedValue,
        faqIds: snapshot.renderData.questions.map(question => question.id), image: snapshot.renderData.image,
        checks: { realZfbStatic: "PASS", registeredSgStory: "PASS", exactCandidateMapping: "PASS", formattedMarkdownHeadingBoldSafeLink: "PASS", hostMarkdownUnsafeSourceRejection: "PASS", completeFaqMembershipAndOrder: "PASS", exactAssetPin: "PASS", exactEmittedAssetBytes: "PASS", sharedNeutralPreviewByteGraph: "PASS", browserRuntime: "NOT RUN" },
        artifactDirectory: output, staticFiles });
      console.log(JSON.stringify({ proof: "publication-static-cycle", scenario: trace.scenario, cycle, snapshotId: snapshot.id, digest: snapshot.digest, exactMappedValue: mappedValue }));
    }
  }
  assert.equal(evidence.cycles.length, 4, "Existing/new Entry each require A and B real static render proofs");
  await writeFile(join(artifacts, "publication-render-evidence.json"), JSON.stringify(evidence, null, 2));
  return evidence;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = process.argv[2];
  if (!output) throw Error("Supply a new local artifact directory for the persisted publication/render proof");
  const evidence = await provePublicationRendering(output);
  console.log(JSON.stringify({ proof: "two-publications-real-static", installedToolSha: evidence.installedToolSha, cycles: evidence.cycles.length,
    publicationAssertions: evidence.publication.assertions, artifactDirectory: resolve(output), browser: evidence.browser }));
}
