import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { componentPack } from "@zudo-sg/ui/composer-pack";
import { createLocalSiteProjectApiService } from "../server/site-project-local/service";
import { releaseJson } from "../src/site-project/api/review";
import type { CompletedRelease, ReleasePlan, SiteProjectApiRequest, SiteProjectApiResponse } from "../src/site-project/api/types";
import { loadSampleSiteProject } from "../src/site-project/sample";

const repositoryRoot = resolve(import.meta.dirname, "..");
const artifactPath = join(repositoryRoot, "artifacts/site-release/bundled-release.json");
const mode = process.argv[2];
if ((mode !== "--write" && mode !== "--check") || process.argv.length !== 3) {
  throw new Error("Usage: tsx scripts/generate-bundled-release.ts --write|--check");
}

function result<T>(response: SiteProjectApiResponse, operation: SiteProjectApiRequest["operation"]): T {
  if (!response.ok) throw new Error(`${operation} failed: ${response.error.code}: ${response.error.message}`);
  return response.result as T;
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "zudo-composer-bundled-release-"));
try {
  const service = createLocalSiteProjectApiService({
    testRoot: join(temporaryRoot, "release"),
    mediaStoreRoot: join(temporaryRoot, "media"),
  });
  const project = loadSampleSiteProject({ componentPack: componentPack.manifest });
  const selection = project.providers.content.flatMap((provider) => provider.entries.map((entry) => ({
    ref: { providerId: provider.id, modelId: entry.modelId, recordId: entry.id },
    action: "publish" as const,
  }))).sort((left, right) => JSON.stringify(left.ref).localeCompare(JSON.stringify(right.ref), "en"));
  const planRequest = { protocolVersion: 2, operation: "plan", project, workingPrecondition: null, selection, expectedRevision: null, expectedActive: null } as const;
  const plan = result<ReleasePlan>(await service.handle(planRequest), "plan");
  if (plan.checks.some(({ severity }) => severity === "blocking")) throw new Error("Bundled sample release has blocking checks.");
  result(await service.handle({ protocolVersion: 2, operation: "apply", plan }), "apply");
  const completed = result<CompletedRelease>(await service.handle({ protocolVersion: 2, operation: "build", projectId: plan.candidate.id, buildId: plan.buildId }), "build");
  const output = releaseJson({ status: "ready", artifact: {
    kind: "bundled-static",
    identity: completed.identity,
    project: plan.candidate,
    build: completed.build,
    completionDigest: completed.completionDigest,
    files: completed.files,
    mediaPins: completed.stage.mediaLock?.pins ?? [],
    toolchain: completed.stage.toolchain,
  } });
  if (mode === "--check") {
    const existing = await readFile(artifactPath, "utf8").catch(() => "");
    if (existing !== output) throw new Error("Bundled release artifact drifted; run pnpm site-project:bundle.");
  } else {
    const temporaryArtifact = join(dirname(artifactPath), `.bundled-release-${process.pid}-${randomUUID()}.tmp`);
    try { await writeFile(temporaryArtifact, output, { encoding: "utf8", flag: "wx" }); await rename(temporaryArtifact, artifactPath); }
    finally { await unlink(temporaryArtifact).catch(() => undefined); }
  }
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
