import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { relative } from "node:path";
import type { TrustedComponentPack } from "@zudo-composer/component-contract";
import { resolveComponentPack, type ResolvedComponentPack } from "../../plugins/component-pack.mjs";
import type { ResolvedComposerConfig } from "../config/config";
import { resolveLocalReleaseToolchain } from "../site-project-local/toolchain-config";
import { collectPackSourceGraph } from "../site-project-local/pack-source-graph";
import { enforceComputedLoadBoundary } from "../site-project-local/load-boundary";
import type { AuthoringPackIdentity, AuthoringRendererIdentity } from "./capture";

export async function resolveAuthoringPackIdentity(options: { composerConfig: ResolvedComposerConfig; pack: TrustedComponentPack; packIdentity: ResolvedComponentPack }): Promise<AuthoringPackIdentity> {
  const identity = await resolveLocalReleaseToolchain({ composerConfig: options.composerConfig, workspaceRoot: options.composerConfig.workspaceRoot, stylesPath: options.composerConfig.paths.styles, pack: options.pack, packIdentity: options.packIdentity });
  return { specifier: identity.packSpecifier, source: identity.packSource, digest: identity.installedPackDigest, compiler: identity.compiler, contractDigest: identity.contractDigest };
}
export async function resolveAuthoringRendererIdentity({ composerConfig: config }: { composerConfig: ResolvedComposerConfig }): Promise<AuthoringRendererIdentity> {
  if (!config.hostDocument) throw new Error("Renderer identity requires a configured hostDocument module.");
  const resolved = resolveComponentPack(config.workspaceRoot, config.hostDocument.module);
  const policyRoots = config.contentValidation ? [resolveComponentPack(config.workspaceRoot, config.contentValidation.module).entryPath] : [];
  const jsxRuntimes = ["jsx-runtime", "jsx-dev-runtime"].map(runtime => resolveComponentPack(config.workspaceRoot, `${config.hostDocument!.jsxImportSource ?? "preact"}/${runtime}`).entryPath);
  const graph = await collectPackSourceGraph({ hostRoot: config.workspaceRoot, entryPath: resolved.entryPath, sourceModules: [], extraRoots: [config.paths.styles, config.configPath, ...jsxRuntimes, ...policyRoots], attestExternalFiles: true });
  enforceComputedLoadBoundary(graph);
  const files = await Promise.all((graph.attestedFiles ?? []).map(async path => {
    const before = await lstat(path); const bytes = await readFile(path); const after = await lstat(path);
    if (!before.isFile() || before.isSymbolicLink() || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error("Renderer source changed during identity capture.");
    return [relative(config.workspaceRoot, path), createHash("sha256").update(bytes).digest("hex")];
  }));
  if (!files.length) throw new Error("Renderer graph is unavailable.");
  files.sort(([a], [b]) => a!.localeCompare(b!));
  return { id: config.hostDocument.rendererId, version: config.hostDocument.rendererVersion, module: config.hostDocument.module, digest: createHash("sha256").update(JSON.stringify({ files, dependencies: graph.dependencies })).digest("hex") };
}
