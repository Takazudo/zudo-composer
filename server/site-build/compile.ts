import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { TrustedComponentPack } from "@zudo-composer/component-contract";
import { createComponentCatalog } from "../../src/composer/model/types";
import { createFilesystemAssetStore } from "../../src/assets/storage/filesystem";
import type { VersionedAssetStore } from "../../src/assets/library";
import { captureSiteProjectAssetLock } from "../../src/site-project/assets/capture";
import { compileSiteProject, type SiteBuildPlan } from "../../src/site-project/compiler";
import { validateSiteProject } from "../../src/site-project/model/validation";
import type { SiteProject } from "../../src/site-project/model/types";
import { serializeSiteProject } from "../../src/site-project/model/canonical";

export interface StaticSiteCompilation {
  project: SiteProject;
  build: SiteBuildPlan;
  /** sha256 of the canonical site-project.json. */
  projectSourceRevision: string;
  /** Exact pinned asset versions, at their immutable `uploaded-assets/sha256-…` delivery paths. */
  assetFiles: { fileName: string; source: Uint8Array }[];
}

const sha256 = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function hostAssetStore(assetsStoreRoot: string): Promise<VersionedAssetStore | undefined> {
  try { await lstat(join(assetsStoreRoot, "catalog.json")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  return createFilesystemAssetStore({ assetsStoreRoot });
}

/** Compile a host's committed site-project.json the way a release does, without release state. */
export async function compileStaticSite(options: { projectPath: string; pack: TrustedComponentPack; assetsStoreRoot: string }): Promise<StaticSiteCompilation> {
  const parsed = JSON.parse(await readFile(options.projectPath, "utf8")) as SiteProject;
  const validated = validateSiteProject(parsed, { componentPack: options.pack.manifest });
  if (!validated.ok) throw new Error(`${options.projectPath} failed validation: ${validated.diagnostics.map(({ message }) => message).join(" ")}`);
  const catalog = createComponentCatalog(options.pack.manifest);
  const store = await hostAssetStore(options.assetsStoreRoot);
  const captured = await captureSiteProjectAssetLock(validated.project, catalog, store);
  if (captured.status !== "ready") throw new Error(`Assets capture blocked: ${captured.diagnostics.map(({ message }) => message).join(" ")}`);
  const compilation = await compileSiteProject(validated.project, { componentCatalog: catalog, policy: "release", assetLock: captured.lock });
  if (compilation.status === "blocked") throw new Error(`Site compilation blocked: ${compilation.diagnostics.map(({ message }) => message).join(" ")}`);
  const assetFiles: StaticSiteCompilation["assetFiles"] = [];
  for (const pin of captured.lock?.pins ?? []) {
    const source = await readFile(join(options.assetsStoreRoot, "versions", basename(pin.url)));
    if (source.byteLength !== pin.byteLength || sha256(source) !== pin.checksum) throw new Error(`Pinned asset bytes differ from the lock: ${pin.url}`);
    assetFiles.push({ fileName: pin.url.slice(1), source });
  }
  return { project: validated.project, build: compilation.build, projectSourceRevision: sha256(serializeSiteProject(parsed)), assetFiles };
}
