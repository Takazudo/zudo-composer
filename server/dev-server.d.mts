import type { InlineConfig, ViteDevServer } from "vite";
import type { ResolvedComposerConfig } from "./config";

export const OPTIMIZE_DEPS_EXCLUDE: readonly string[];

export function loadHostConfig(workspaceRoot: string, env?: Record<string, string | undefined>): Promise<ResolvedComposerConfig>;
export function resolveFsAllow(workspaceRoot: string): string[];
export function resolvePublicDir(workspaceRoot: string, publicMedia: string): string;

export interface ComposerDevServerOptions {
  workspaceRoot?: string;
  env?: Record<string, string | undefined>;
  port?: number;
  host?: string | boolean;
  strictPort?: boolean;
}

export function resolveComposerDevConfig(
  options?: ComposerDevServerOptions,
): Promise<{ composerConfig: ResolvedComposerConfig; inlineConfig: InlineConfig }>;

export function startComposerDevServer(
  options?: ComposerDevServerOptions,
): Promise<{ server: ViteDevServer; composerConfig: ResolvedComposerConfig }>;
