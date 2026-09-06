import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readFile, readdir, realpath } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { installedPackageDigest } from "./installed-identity";
import { componentPack } from "@zudo-sg/ui/composer-pack";
import { createComponentCatalog } from "../../src/composer/model/types";
import { createSiteProjectApiService } from "../../src/site-project/api/service";
import type { SiteProjectApiService, ReleaseToolchain } from "../../src/site-project/api/types";
import { createFilesystemMediaStore } from "../../src/media/storage/filesystem";
import type { VersionedMediaStore } from "../../src/media/library";
import { createLocalSiteProjectStore, type LocalSiteProjectStoreOptions } from "./store";
import { releaseJson } from "../../src/site-project/api/review";

export interface LocalSiteProjectServiceOptions extends LocalSiteProjectStoreOptions { mediaStoreRoot?: string; mediaStore?: VersionedMediaStore; toolchain?: ReleaseToolchain }
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
async function compilerIdentity(): Promise<string> {
  const root = resolve(import.meta.dirname, "../../src"), files: [string, string][] = [];
  const visit = async (relativePath: string): Promise<void> => { for (const entry of await readdir(join(root, relativePath), { withFileTypes: true })) {
    if (entry.name === "__tests__") continue; if (entry.isSymbolicLink()) throw new Error("Compiler identity cannot follow symlinks.");
    const path = `${relativePath}/${entry.name}`; if (entry.isDirectory()) await visit(path); else if (entry.name.endsWith(".ts")) files.push([path, await readFile(join(root, path), "utf8")]);
  } };
  for (const domain of ["site-project", "composer", "content", "mapping", "sitemapper", "media", "shared", "../packages/component-contract/src"]) await visit(domain);
  files.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  return `site-project-release/2:${sha(releaseJson(files))}`;
}
export function createLocalSiteProjectApiService(options: LocalSiteProjectServiceOptions = {}): SiteProjectApiService {
  const mediaRoot = resolve(options.mediaStoreRoot ?? resolve(import.meta.dirname, "../../media-store"));
  const catalog = createComponentCatalog(componentPack.manifest);
  const store = createLocalSiteProjectStore({ ...options, componentPack: catalog.pack, readMedia: options.readMedia ?? (async (pin) => {
    for (const path of [mediaRoot, join(mediaRoot, "versions")]) { const info = await lstat(path); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Unsafe pinned Media source directory."); }
    const root = await realpath(mediaRoot), versions = await realpath(join(mediaRoot, "versions")); if (versions !== join(root, "versions")) throw new Error("Pinned source escaped Media root.");
    const handle = await open(join(versions, basename(pin.url)), constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat(); if (!stat.isFile() || stat.size !== pin.byteLength) { await handle.close(); throw new Error("Pinned Media source is unavailable."); }
    return (async function* () { try { for await (const chunk of handle.createReadStream({ autoClose: false })) yield new Uint8Array(chunk); } finally { await handle.close(); } })();
  }) });
  const create = async () => {
    const packageJson = JSON.parse(await readFile(resolve(import.meta.dirname, "../../package.json"), "utf8"));
    const providerCommit = String(packageJson.dependencies["@zudo-sg/ui"]).split("#").at(-1)!;
    const contractText = await readFile(resolve(import.meta.dirname, "../../contract-handoff.json"), "utf8");
    if (!options.toolchain && providerCommit !== "6b0826cdaa14d9888e58c795ee015f70e2c5cbdf") throw new Error("Pinned provider tree identity needs explicit verification.");
    const installedRoot = await realpath(dirname(dirname(fileURLToPath(import.meta.resolve("@zudo-sg/ui/composer-pack")))));
    const toolchain: ReleaseToolchain = options.toolchain ?? { compiler: await compilerIdentity(), componentPack: { packId: catalog.pack.packId, packVersion: catalog.pack.packVersion, contractVersion: catalog.pack.contractVersion }, providerCommit, providerTree: "1c3cbfd3a25d1425f447cdadd5ba538916394309", installedProviderDigest: await installedPackageDigest(installedRoot), contractDigest: sha(contractText) };
    let mediaStore = options.mediaStore;
    if (!mediaStore) { try { await lstat(join(mediaRoot, "catalog.json")); mediaStore = await createFilesystemMediaStore({ mediaStoreRoot: mediaRoot }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } }
    return createSiteProjectApiService({ componentCatalog: catalog, projectStore: store, buildStore: store, hash: async (text) => sha(text), toolchain, mediaStore });
  };
  const handle: SiteProjectApiService["handle"] = async (request) => { try { return await (await create()).handle(request); } catch { return { ok: false, error: { code: "unavailable", message: "Release toolchain or Media capability is unavailable." } }; } };
  return { handle, serialize: async (request) => releaseJson(await handle(request)) };
}
