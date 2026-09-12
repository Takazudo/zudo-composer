import type { spawn as nodeSpawn } from "node:child_process";
import type { ViteDevServer } from "vite";
import type { ComposerProcess } from "./supervise.d.mts";
import type { BuildSiteOptions } from "../site-build/run.mjs";

export const RELEASE_ENTRY_PATH: string;
export const BUILD_SITE_ENTRY_PATH: string;
export const CLOSE_GRACE_MS: number;
export const USAGE: string;

export type ParsedComposerCommand =
  | { command: "dev"; options: Record<string, unknown> }
  | { command: "release"; rest: string[] }
  | { command: "build-site"; options: BuildSiteOptions }
  | { command: "help" }
  | { error: string };

export function parseArguments(argv: string[]): ParsedComposerCommand;
export function superviseDevServer<T extends { close(): Promise<void> }>(server: T, proc?: ComposerProcess): T;

export function runComposerCli(
  argv: string[],
  deps?: {
    proc?: ComposerProcess;
    start?: (options: Record<string, unknown>) => Promise<{ server: ViteDevServer }>;
    spawn?: typeof nodeSpawn;
    exists?: (path: string) => boolean;
  },
): Promise<ViteDevServer | undefined>;
