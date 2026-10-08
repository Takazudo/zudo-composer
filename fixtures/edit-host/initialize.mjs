import process from "node:process";
import { Buffer } from "node:buffer";
import { createFilesystemAssetStore, defineSite, initializeAuthoringWorkspace, node } from "zudo-composer/authoring";
import { loadHostContext } from "zudo-composer/vite";

const { composerConfig, pack } = await loadHostContext({ workspaceRoot: process.cwd() });
const assets = await createFilesystemAssetStore({ assetsStoreRoot: composerConfig.paths.assets });
// An original one-pixel PNG, uploaded through Assets rather than a loose URL.
const image = await assets.upload({ fileName: "native-proof.png", declaredMimeType: "image/png", bytes: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMwy9rwHwAEegJQ3vho/gAAAABJRU5ErkJggg==", "base64") });
const site = defineSite({ id: "native-edit-proof", name: "Native editing proof", componentPack: pack });
const home = site.page({ id: "home", name: "Native editing home", root: [
  node("native.paragraph", { text: "Before replacement" }, {}, "paragraph"),
  node("native.list", { items: ["First item", "Second item"] }, {}, "list"),
  node("native.table", { columns: ["Name", "Value"], rows: [["Alpha", "Before cell"]] }, {}, "table"),
] });
site.sitemap({ id: "main", name: "Native sitemap", root: { id: "home", title: "Home", page: home } });
await initializeAuthoringWorkspace({ composerConfig, pack, project: site.toSiteProject(), workspaceId: "native-proof" });
process.stdout.write(JSON.stringify({ workspaceId: "native-proof", pageId: "home", assetId: image.id }) + "\n");
