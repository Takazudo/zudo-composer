import { project } from "../../../src/site-project/compiler/__tests__/fixtures";
import { createLocalSiteProjectStore } from "../store";
import { createHash } from "node:crypto";
import { componentCatalog } from "../../../src/site-project/compiler/__tests__/fixtures";
import { serializeSiteProject } from "../../../src/site-project/model/canonical";
import { releaseJson } from "../../../src/site-project/api/review";

const testRoot = process.argv[2];
if (!testRoot) throw new Error("test root required");
const value = project(); value.name = process.argv[3] ?? "Worker";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const revision = hash(serializeSiteProject(value)), mediaLock = null, toolchain = { compiler: "fixture/2", componentPack: { packId: componentCatalog.pack.packId, packVersion: componentCatalog.pack.packVersion, contractVersion: componentCatalog.pack.contractVersion }, providerCommit: "a".repeat(40), providerTree: "b".repeat(40), contractDigest: "c".repeat(64) };
const stage = { schemaVersion: 2 as const, projectId: value.id, revision, buildId: hash(releaseJson({ projectRevision: revision, mediaLock, toolchain })), mediaLock, toolchain, planDigest: "d".repeat(64), publication: [] };
const result = await createLocalSiteProjectStore({ testRoot, componentPack: componentCatalog.pack }).apply({ project: value, stage, expectedRevision: null, expectedActive: null, expectedGeneration: 0 });
process.stdout.write(JSON.stringify(result));
