import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { join, relative } from "node:path";
import { resolveComponentPack } from "../../plugins/component-pack.mjs";
import { createModuleEvaluator } from "../module-evaluator.mjs";
import { loadHostConfig } from "../host-context.mjs";
import { collectPackSourceGraph } from "../site-project-local/pack-source-graph";
import { enforceComputedLoadBoundary } from "../site-project-local/load-boundary";
import type { ResolvedComposerConfig } from "../config/config";
import type { ContentValidationPolicy } from "../../src/content/validation";
export interface ContentValidationIdentity { id: string; version: string; module: string; digest: string }
export async function contentValidationIdentity(config: ResolvedComposerConfig): Promise<ContentValidationIdentity | undefined> {
  if (!config.contentValidation) return undefined;
  const entry = resolveComponentPack(config.workspaceRoot, config.contentValidation.module).entryPath;
  const graph = await collectPackSourceGraph({ hostRoot: config.workspaceRoot, entryPath: entry, sourceModules: [], extraRoots: [config.configPath], attestExternalFiles: true });
  enforceComputedLoadBoundary(graph);
  const files = await Promise.all((graph.attestedFiles ?? []).map(async path => {
    const before = await lstat(path), bytes = await readFile(path), after = await lstat(path);
    if (!before.isFile() || before.isSymbolicLink() || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error("Content policy source changed during capture.");
    return [relative(config.workspaceRoot, path), createHash("sha256").update(bytes).digest("hex")];
  }));
  if (!files.length) throw new Error("Content policy graph is unavailable.");
  files.sort(([a], [b]) => a!.localeCompare(b!));
  return { ...config.contentValidation, digest: createHash("sha256").update(JSON.stringify({ policy: config.contentValidation, files, dependencies: graph.dependencies })).digest("hex") };
}
export async function loadContentValidation(config: ResolvedComposerConfig): Promise<ContentValidationPolicy | undefined> {
  const identity = await contentValidationIdentity(config);
  // Native ESM caches bare dependencies across Vite evaluator instances.
  // A new loader must not attest changed bytes while executing old exports.
  const epochKey = Symbol.for("zudo-composer.content-validation-epochs.v1");
  const state = globalThis as typeof globalThis & { [key: symbol]: Map<string, string> | undefined };
  const epochs = state[epochKey] ??= new Map<string, string>();
  const root = await realpath(config.workspaceRoot), digest = JSON.stringify(identity ?? null);
  const prior = epochs.get(root);
  if (prior !== undefined && prior !== digest) throw new Error("Content validation source changed in this process. Restart authoring before loading a new policy.");
  epochs.set(root, digest);
  if (!identity) return undefined;
  const entry = resolveComponentPack(config.workspaceRoot, identity.module).entryPath;
  const module = await createModuleEvaluator(config.workspaceRoot)(entry);
  if (typeof module.validateContentField !== "function") throw new Error("Content policy must export validateContentField.");
  const assertCurrent = async () => {
    if (JSON.stringify(await contentValidationIdentity(config)) !== JSON.stringify(identity)) throw new Error("Content validation source changed. Restart authoring and review again.");
  };
  await assertCurrent();
  return { identity: identity.digest, validateContentField: module.validateContentField as ContentValidationPolicy["validateContentField"], assertCurrent };
}
/** Resolve only the host config, without loading a pack or touching authored data. */
export async function hostContentValidationConfig(workspaceRoot: string): Promise<ResolvedComposerConfig | undefined> {
  try { await lstat(join(workspaceRoot, "zudo-composer.config.ts")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  return loadHostConfig(workspaceRoot);
}
export async function loadHostContentValidation(workspaceRoot: string): Promise<ContentValidationPolicy | undefined> {
  const config = await hostContentValidationConfig(workspaceRoot);
  return config ? loadContentValidation(config) : undefined;
}
