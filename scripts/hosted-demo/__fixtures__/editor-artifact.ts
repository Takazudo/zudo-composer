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

export async function writeEditorArtifact(options: { emptyAssets?: boolean; sourceRevision?: string } = {}) {
  const root = await mkdtemp(join(tmpdir(), "demo-editor-artifact-"));
  context ??= loadHostContext({ workspaceRoot: join(repository, "packages/demo-sample"), env: {} });
  const host = await context;
  // The synthetic host uses the mixed image/document/archive catalog to cover
  // the whole delivery contract; real editor builds select their host catalog.
  const assets = await prepareDemoAsset(join(repository, "cms/assets"));
  if (options.emptyAssets) { assets.snapshot.records = []; assets.files = []; }
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
