// @ts-check
// Child-process discipline for the CLI, taken from `@takazudo/zfb`'s
// `bin/zfb.mjs`.
//
// Every line here exists because a long-running dev process outlived its
// wrapper. Supervisors (`concurrently --kill-others`, Playwright's webServer
// teardown, `timeout(1)`, CI runners) signal the wrapper only; without
// forwarding, the child survives with PPID 1 and keeps its port bound. The
// exit path re-raises the child's terminating signal on ourselves so the caller
// sees the real cause of death rather than a plain exit code.

import { spawn as nodeSpawn } from "node:child_process";
import { existsSync } from "node:fs";
import { constants as osConstants } from "node:os";

/**
 * SIGHUP is POSIX-only: on Windows `child.kill("SIGHUP")` throws, and the OS
 * tears console processes down on window close anyway.
 * @param {string} platform
 */
export function forwardedSignals(platform) {
  return platform === "win32" ? ["SIGINT", "SIGTERM"] : ["SIGINT", "SIGTERM", "SIGHUP"];
}

/**
 * Install the wrapper→child signal bridge and the exit/error handling.
 * @param {import("node:child_process").ChildProcess} child
 * @param {{label: string, entryPath: string, proc?: any, signalNumbers?: Record<string, number | undefined>}} options
 */
export function superviseChild(child, { label, entryPath, proc = process, signalNumbers = osConstants.signals }) {
  const forwarders = new Map();
  for (const signal of forwardedSignals(proc.platform)) {
    const forward = () => child.kill(/** @type {NodeJS.Signals} */ (signal));
    forwarders.set(signal, forward);
    proc.on(signal, forward);
  }

  // Without this a non-executable or unreadable entry is swallowed and the
  // process exits with a bare code 1, leaving the operator nothing to inspect.
  child.on("error", (error) => {
    proc.stderr.write(`[zudo-composer] failed to start ${label}: ${error.message}\n      ${entryPath}\n`);
    proc.exit(1);
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      // Remove our forwarder first or it would swallow the re-raise.
      const forward = forwarders.get(signal);
      if (forward) proc.off(signal, forward);
      try {
        proc.kill(proc.pid, signal);
      } catch {
        // The platform cannot re-raise this signal (Windows emulation).
      }
      // Reached only if the re-raised signal did not terminate us — fall back
      // to the shell's 128+n convention for death-by-signal.
      const number = signalNumbers[signal];
      proc.exit(number ? 128 + number : 1);
      return;
    }
    proc.exit(code ?? 1);
  });

  return child;
}

/**
 * Spawn a package-owned entry under the discipline above. The existence check
 * is explicit so a partial install reports the resolved absolute path instead
 * of an opaque ENOENT from `spawn`.
 * @param {{command: string, args: string[], label: string, entryPath: string, requiredPaths?: string[], spawn?: typeof nodeSpawn, proc?: any, exists?: (path: string) => boolean}} options
 */
export function spawnSupervised({ command, args, label, entryPath, requiredPaths = [entryPath], spawn = nodeSpawn, proc = process, exists = existsSync }) {
  for (const path of requiredPaths) {
    if (exists(path)) continue;
    proc.stderr.write(`[zudo-composer] cannot start ${label}: missing package file\n      ${path}\n      The zudo-composer installation is incomplete; reinstall the package.\n`);
    proc.exit(1);
    return undefined;
  }
  return superviseChild(spawn(command, args, { stdio: "inherit" }), { label, entryPath, proc });
}
