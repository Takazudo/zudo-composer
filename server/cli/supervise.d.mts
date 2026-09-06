import type { ChildProcess, spawn as nodeSpawn } from "node:child_process";

/**
 * The slice of `process` the CLI actually touches. Narrower than
 * `NodeJS.Process` on purpose: it is the seam tests substitute.
 */
export interface ComposerProcess {
  platform: string;
  execPath: string;
  pid: number;
  exitCode?: number | undefined;
  stdout: { write(value: string): unknown };
  stderr: { write(value: string): unknown };
  on(signal: string, handler: () => void): unknown;
  off(signal: string, handler: () => void): unknown;
  kill(pid: number, signal: string): unknown;
  exit(code?: number): void;
}

export function forwardedSignals(platform: string): string[];

export interface SuperviseOptions {
  label: string;
  entryPath: string;
  proc?: ComposerProcess;
  signalNumbers?: Record<string, number | undefined>;
}

export function superviseChild(child: ChildProcess, options: SuperviseOptions): ChildProcess;

export function spawnSupervised(options: {
  command: string;
  args: string[];
  label: string;
  entryPath: string;
  requiredPaths?: string[];
  spawn?: typeof nodeSpawn;
  proc?: ComposerProcess;
  exists?: (path: string) => boolean;
}): ChildProcess | undefined;
