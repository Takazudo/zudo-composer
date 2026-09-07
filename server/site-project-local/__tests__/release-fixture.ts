import { createHash } from "node:crypto";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach } from "vitest";
import { createComponentCatalog } from "../../../src/composer/model/types";
import { componentCatalog } from "../../../src/site-project/compiler/__tests__/fixtures";
import { createLocalSiteProjectStore, type LocalSiteProjectStoreOptions } from "../store";
import { createSiteProjectApiService } from "../../../src/site-project/api/service";
import { createFilesystemMediaStore } from "../../../src/media/storage/filesystem";
import type { TrustedComponentPack } from "@zudo-composer/component-contract";
import type { ReleasePlan, SiteProjectApiDependencies, SiteProjectApiService, StagedRelease } from "../../../src/site-project/api/types";
import { releaseJson } from "../../../src/site-project/api/review";
import { serializeSiteProject } from "../../../src/site-project/model/canonical";
import type { SiteProject } from "../../../src/site-project/model";
export const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
export const sha = (text: string) => createHash("sha256").update(text).digest("hex");
export const catalog = createComponentCatalog({ ...componentCatalog.pack, components: componentCatalog.pack.components.map((component) => component.id !== "leaf" ? component : { ...component, fields: [...component.fields, { prop: "href", label: "Link", schema: { type: "string" }, editor: { kind: "text" } }] }) });
export const toolchain = { compiler: "fixture/2", componentPack: { packId: catalog.pack.packId, packVersion: catalog.pack.packVersion, contractVersion: catalog.pack.contractVersion }, packSpecifier: "@fixture/pack/composer-pack", packSource: "workspace:*", installedPackDigest: "e".repeat(64), contractDigest: "c".repeat(64) };
/** `createLocalSiteProjectApiService` reads only the manifest off the pack, and
 * these specs keep the storage/transport regression independent of provider JSX
 * rendering — so the runtime half is deliberately absent. */
export const pack = { manifest: catalog.pack } as unknown as TrustedComponentPack;
export const PNG = Uint8Array.from([137,80,78,71,13,10,26,10,1,2,3,4]);
export async function fixture(options: LocalSiteProjectStoreOptions & { media?: boolean } = {}) {
  // Resolved, because the host root a store is given is resolved too and macOS
  // `tmpdir()` is a symlink (`/var` -> `/private/var`).
  const parent = await realpath(await mkdtemp(join(tmpdir(), "release-v2-"))); roots.push(parent);
  const testRoot = join(parent, "release"), mediaRoot = join(parent, "media");
  const media = options.media ? await createFilesystemMediaStore({ mediaStoreRoot: mediaRoot }) : undefined;
  const store = createLocalSiteProjectStore({ ...options, testRoot, componentPack: catalog.pack, readMedia: async (pin) => (async function* () { yield new Uint8Array(await readFile(join(mediaRoot, "versions", pin.url.split("/").at(-1)!))); })() });
  const dependencies: SiteProjectApiDependencies = { componentCatalog: catalog, projectStore: store, buildStore: store, hash: async (text) => sha(text), toolchain, mediaStore: media };
  const service = createSiteProjectApiService(dependencies);
  return { parent, testRoot, mediaRoot, media, store, dependencies, service };
}
export async function call<T>(service: SiteProjectApiService, operation: string, fields: object = {}): Promise<T> { const result = await service.handle({ protocolVersion: 2, operation, ...fields }); if (!result.ok) throw new Error(releaseJson(result)); return result.result as T; }
export const review = (service: SiteProjectApiService, project: SiteProject, fields: object = {}) => call<ReleasePlan>(service, "plan", { project, workingPrecondition: null, selection: [], expectedRevision: null, expectedActive: null, ...fields });
export function stageFor(project: SiteProject): StagedRelease { const revision = sha(serializeSiteProject(project)); const mediaLock = null; return { schemaVersion: 2, projectId: project.id, revision, buildId: sha(releaseJson({ projectRevision: revision, mediaLock, toolchain })), mediaLock, toolchain, planDigest: sha("approval:" + revision), publication: [] }; }
