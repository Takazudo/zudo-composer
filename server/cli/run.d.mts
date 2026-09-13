import type { spawn as nodeSpawn } from "node:child_process";
import type { ViteDevServer } from "vite";
import type { ComposerProcess } from "./supervise.d.mts";
import type { BuildSiteOptions } from "../site-build/run.mjs";

export const RELEASE_ENTRY_PATH: string;
export const BUILD_SITE_ENTRY_PATH: string;
export const ASSETS_IMPORT_ENTRY_PATH: string;
export const SEED_ENTRY_PATH: string;
export const GENERATE_ENTRY_PATH: string;
export const INIT_ENTRY_PATH: string;
export const CLOSE_GRACE_MS: number;
export const USAGE: string;

export interface SeedOptions {
  /** Absolute resolved host path; defaults to the current working directory. */
  workspaceRoot?: string;
  /** Absolute resolved JSON source; defaults to site-project.json in the host root. */
  from?: string;
  /** Produce a reproducible selected CMS workspace through the seed service. */
  readyWorkspace?: boolean;
  /** Absolute output tree for --ready-workspace; default is the host root. */
  outputRoot?: string;
}

export interface GenerateOptions {
  /** Absolute resolved host path; defaults to the current working directory. */
  workspaceRoot?: string;
  /** Compare generated output without writing site-project.json. */
  check?: boolean;
}

export type ParsedComposerCommand =
  | { command: "init"; options: import("../creator/init.mjs").InitOptions }
  | { command: "dev"; options: Record<string, unknown> }
  | { command: "release"; rest: string[] }
  | { command: "build-site"; options: BuildSiteOptions }
  | { command: "assets-import"; options: { workspaceRoot?: string; manifest?: string } }
  | { command: "generate"; options: GenerateOptions }
  | { command: "seed"; options: SeedOptions }
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
