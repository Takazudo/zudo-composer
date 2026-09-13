import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { componentPackManifestSchema, type ComponentPackManifest } from "@zudo-composer/component-contract";
import { createComponentCatalog } from "../../src/composer/model/types";
import { type AssetSnapshot } from "../../src/assets/model";
import { createDemoAsset } from "../../src/hosted-demo/assets";
import { serializeSiteProject } from "../../src/site-project/model/canonical";
import { validateSiteProject } from "../../src/site-project/model/validation";
import { type SiteProject } from "../../src/site-project/model/types";
import { compileWithCapturedAsset } from "../../src/site-project/assets/compile";
import { demoEditorRoutes } from "../routes.mjs";
import { activeDemoAssetSnapshot, demoAssetInventory } from "./asset-snapshot";

/** The same data is injected into the client and emitted for artifact verification. */
export interface DemoEditorSeed {
  hostId: string;
  project: SiteProject;
  componentPack: ComponentPackManifest;
  assets: AssetSnapshot;
}

/** Recompile only JSON data with trusted tool code, never a downloaded module. */
export async function inspectDemoEditorSeed(value: unknown, files: { path: string; source: Uint8Array }[]) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), "Demo editor seed must be an object");
  assert.deepEqual(Object.keys(value).sort(), ["assets", "componentPack", "hostId", "project"]);
  const seed = value as DemoEditorSeed;
  assert.ok(typeof seed.hostId === "string" && /^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(seed.hostId), "Demo editor seed must name its host package");
  const componentPack = componentPackManifestSchema.parse(seed.componentPack);
  const validated = validateSiteProject(seed.project, { componentPack });
  assert.ok(validated.ok, "Bundled demo editor project is incompatible with its component pack");
  assert.deepEqual(seed.assets, activeDemoAssetSnapshot(seed.assets), "Bundled demo assets must contain only active records and folders with a fresh mutation token");
  const assets = demoAssetInventory(seed.assets);
  assert.deepEqual(files.map(({ path }) => path).sort(), Object.keys(assets), "Uploaded assets must equal the bundled snapshot versions");
  const store = await createDemoAsset({
    snapshot: seed.assets,
    bytes: Object.fromEntries(files.map(({ path, source }) => [assets[path]!.sha256, source])),
  });
  const compilation = await compileWithCapturedAsset(validated.project, { catalog: createComponentCatalog(componentPack), assetStore: store.provider.store, snapshot: seed.assets });
  assert.ok(compilation.status === "ready", `Bundled demo editor site compilation blocked: ${compilation.diagnostics.map(({ message }) => message).join(" ")}`);
  return {
    hostId: seed.hostId,
    projectId: validated.project.id,
    projectSourceRevision: createHash("sha256").update(serializeSiteProject(validated.project)).digest("hex"),
    assets,
    routes: demoEditorRoutes(compilation.build.routes.map(({ pathname }) => pathname)),
  };
}
