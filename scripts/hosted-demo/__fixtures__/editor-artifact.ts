import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { loadHostContext } from "../../../server/host-context.mjs";
import { hostedAssetHeaders } from "../../../src/assets/model/asset-kinds.mjs";
import { prepareDemoAsset } from "../prepare";
import { createDemoEditorManifest, DEMO_EDITOR_MANIFEST, DEMO_EDITOR_SEED, HOSTED_DEMO_HEADERS } from "../artifact.mjs";
import type { DemoEditorSeed } from "../seed";

const repository = resolve(import.meta.dirname, "../../..");
let context: ReturnType<typeof loadHostContext> | undefined;

type PreparedDemoAsset = Awaited<ReturnType<typeof prepareDemoAsset>>;

/** Add `extra`'s records/files on top of `base`, skipping anything `extra`
 * already shares a version URL with (the two fixture catalogs both happen
 * to carry Sample Studio's own webp bytes). */
function mergeDemoAssets(base: PreparedDemoAsset, extra: PreparedDemoAsset): PreparedDemoAsset {
  const usedUrls = new Set(base.snapshot.records.flatMap(({ document }) => document.versions.map(({ url }) => url)));
  const usedFileNames = new Set(base.files.map(({ fileName }) => fileName));
  return {
    snapshot: {
      ...base.snapshot,
      records: [...base.snapshot.records, ...extra.snapshot.records.filter(({ document }) => !document.versions.some(({ url }) => usedUrls.has(url)))],
      folders: [...base.snapshot.folders, ...extra.snapshot.folders],
    },
    files: [...base.files, ...extra.files.filter(({ fileName }) => !usedFileNames.has(fileName))],
  };
}

export async function writeEditorArtifact(options: { minimalAssets?: boolean; sourceRevision?: string } = {}) {
  const root = await mkdtemp(join(tmpdir(), "demo-editor-artifact-"));
  context ??= loadHostContext({ workspaceRoot: join(repository, "packages/demo-sample"), env: {} });
  const host = await context;
  // Sample Studio's own committed project pins its five real seeded images
  // (see #695), so every variant must bundle them from the same host Assets
  // store the project was validated against, exactly like a real editor
  // build (vite.demo-editor.config.ts uses `paths.assets`). The default
  // variant also merges in the repo's generic image/document/archive fixture
  // catalog so this artifact-packaging test still covers non-webp MIME kinds
  // and Content-Disposition/attachment behavior that Sample Studio's own
  // images alone don't exercise.
  const required = await prepareDemoAsset(host.composerConfig.paths.assets);
  const assets = options.minimalAssets ? required : mergeDemoAssets(required, await prepareDemoAsset(join(repository, "cms/assets")));
  const seed: DemoEditorSeed = {
    hostId: "artifact-fixture",
    project: JSON.parse(await readFile(join(host.workspaceRoot, "site-project.json"), "utf8")),
    componentPack: host.pack.manifest,
    assets: assets.snapshot,
  };
  const files = new Map<string, Buffer>([
    ["index.html", Buffer.from("<!doctype html><html><body>live</body></html>\n")],
    ["hosted-demo-assets-worker.js", Buffer.from("export default {};\n")],
    ["assets/preview-entry-test.js", Buffer.from("export const preview = true;\n")],
    ["assets/visitor-entry-test.js", Buffer.from("export const visitor = true;\n")],
    [HOSTED_DEMO_HEADERS, Buffer.from(hostedAssetHeaders(assets.files.map(({ fileName, source }) => ({ path: fileName, byteLength: source.byteLength }))))],
    [DEMO_EDITOR_SEED, Buffer.from(JSON.stringify(seed))],
    ...assets.files.map(({ fileName, source }): [string, Buffer] => [fileName, Buffer.from(source)]),
  ]);
  const saveFile = async (path: string, source: Buffer | string) => {
    const bytes = Buffer.from(source);
    files.set(path, bytes);
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), bytes);
  };
  for (const [path, bytes] of files) await saveFile(path, bytes);
  const manifest = await createDemoEditorManifest({ directory: root, sourceRevision: options.sourceRevision ?? "c".repeat(40) });
  const saveManifest = () => writeFile(join(root, DEMO_EDITOR_MANIFEST), JSON.stringify(manifest));
  await saveManifest();
  return { root, manifest, seed, files, saveFile, saveManifest };
}
