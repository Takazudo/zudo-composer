import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import type { ResolvedComposerConfig } from "../config/config";
import { workspaceDomainRoots } from "../../src/shared/workspace-scope";

export async function hostDocumentEditAuthority(config: ResolvedComposerConfig, workspaceId: string) {
  const root = workspaceDomainRoots(config.paths, workspaceId).compositions;
  const [path, stat] = await Promise.all([realpath(root), lstat(root, { bigint: true })]);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.ino === 0n || stat.birthtimeNs === 0n) return undefined;
  return createHash("sha256").update(JSON.stringify([workspaceId, path, String(stat.dev), String(stat.ino), String(stat.birthtimeNs)])).digest("hex");
}
