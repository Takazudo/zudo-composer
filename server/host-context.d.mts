import type { TrustedComponentPack } from "@zudo-composer/component-contract";
import type { ResolvedComposerConfig } from "./config/config";
import type { ResolvedComponentPack } from "../plugins/component-pack.d.mts";

export function loadHostConfig(
  workspaceRoot: string,
  env?: Record<string, string | undefined>,
): Promise<ResolvedComposerConfig>;

export interface HostContext {
  composerConfig: ResolvedComposerConfig;
  pack: TrustedComponentPack;
  packIdentity: ResolvedComponentPack;
  workspaceRoot: string;
}

export function loadHostContext(options?: {
  workspaceRoot?: string;
  env?: Record<string, string | undefined>;
}): Promise<HostContext>;
