// @ts-check
// `zudo-composer <command>`.
//
// The commands are deliberately asymmetric. `dev` boots Vite in
// this process — the server object is what has to be closed to release the
// port, so there is nothing to gain from a child. `release` is the JSON-stdin
// SiteProject release API. `release` and the one-shot `build-site` run in
// child processes, supervised by `spawnSupervised`.

import { constants as osConstants } from "node:os";
import { resolve } from "node:path";
import { APP_ROOT } from "../../plugins/roots.mjs";
import { forwardedSignals, spawnSupervised } from "./supervise.mjs";

/** How long a signal handler waits for `server.close()` before exiting anyway. */
export const CLOSE_GRACE_MS = 2000;

export const RELEASE_ENTRY_PATH = resolve(APP_ROOT, "server/cli/release-entry.mjs");
export const BUILD_SITE_ENTRY_PATH = resolve(APP_ROOT, "server/cli/build-site-entry.mjs");

export const USAGE = `Usage: zudo-composer <command> [options]

Commands:
  dev         Start the authoring dev server, rooted at the current project.
  release     Run the SiteProject release API (one JSON request on stdin, one
              canonical JSON response on stdout).
  build-site  Build and verify the host's static website in dist-site.

dev options:
  --root <dir>     Host project root (default: the current directory).
  --port <number>  Port to listen on (0 picks a free one).
  --host [addr]    Expose the server; bare --host listens on all addresses.
  --strict-port    Fail instead of moving to the next free port.

build-site options:
  --root <dir>     Host project root (default: the current directory).
  --print-routes   Verify an existing artifact and print its routes as JSON.
  --verify <dir>   Verify this artifact instead of building (relative to cwd).
                  Combine with --print-routes to print this artifact's routes.
  --source-revision <revision>
                  Host revision to record or verify exactly (default: GITHUB_SHA
                  when nonempty; omitted otherwise).
`;

/**
 * @param {string[]} argv
 * @returns {import("./run.d.mts").ParsedComposerCommand}
 */
export function parseArguments(argv) {
  const [command, ...rest] = argv;
  if (command === undefined || command === "--help" || command === "-h" || command === "help") return { command: "help" };
  if (command === "release") return { command: "release", rest };
  if (command !== "dev" && command !== "build-site") return { error: `Unknown command "${command}".` };

  /** @type {Record<string, unknown> & import("../site-build/run.d.mts").BuildSiteOptions} */
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    const value = () => {
      const next = rest[index + 1];
      if (next === undefined || next === "" || next.startsWith("-")) return undefined;
      index += 1;
      return next;
    };
    if (argument === "--help" || argument === "-h") return { command: "help" };
    else if (argument === "--root") {
      const root = value();
      if (root === undefined) return { error: "--root requires a directory." };
      options.workspaceRoot = resolve(root);
    } else if (command === "build-site") {
      if (argument === "--print-routes") options.printRoutes = true;
      else if (argument === "--verify") {
        const directory = value();
        if (directory === undefined) return { error: "--verify requires a directory." };
        options.verifyDirectory = resolve(directory);
      } else if (argument === "--source-revision") {
        const revision = value();
        if (revision === undefined || revision.trim() === "") return { error: "--source-revision requires a nonempty revision." };
        options.sourceRevision = revision;
      } else return { error: `Unknown build-site option "${argument}".` };
    } else if (argument === "--strict-port") options.strictPort = true;
    else if (argument === "--host") options.host = value() ?? true;
    else if (argument === "--port") {
      const port = value();
      if (port === undefined || !/^\d+$/.test(port)) return { error: "--port requires a number." };
      options.port = Number(port);
    } else return { error: `Unknown dev option "${argument}".` };
  }
  return { command, options };
}

/**
 * Close the dev server on a terminating signal, then exit with the shell's
 * 128+n convention for death-by-signal. Without the close, an in-process
 * server keeps its port bound for as long as Node takes to unwind.
 *
 * There is no child here whose cause of death has to be relayed, so this
 * exits rather than re-raising: re-raising an in-process signal races an
 * already-empty event loop and would report a signal or a plain 0 depending
 * on which won.
 * @param {{close(): Promise<void>}} server
 * @param {any} proc
 */
export function superviseDevServer(server, proc = process) {
  let closing = false;
  for (const signal of forwardedSignals(proc.platform)) {
    proc.on(signal, async () => {
      if (closing) return;
      closing = true;
      // The grace timer is load-bearing twice over. It bounds a `close()` that
      // never settles — Vite's does not always, once the dependency optimizer
      // is mid-flight — and, because it is a live handle, it stops Node from
      // draining to a silent exit 0 while that unsettled promise is awaited.
      await Promise.race([
        server.close().catch((error) => {
          proc.stderr.write(`[zudo-composer] dev server did not shut down cleanly: ${error instanceof Error ? error.message : String(error)}\n`);
        }),
        new Promise((settle) => globalThis.setTimeout(settle, CLOSE_GRACE_MS)),
      ]);
      const number = osConstants.signals[/** @type {NodeJS.Signals} */ (signal)];
      proc.exit(number ? 128 + number : 1);
    });
  }
  return server;
}

/**
 * @param {string[]} argv
 * @param {{proc?: any, start?: (options: Record<string, unknown>) => Promise<{server: any}>, spawn?: typeof import("node:child_process").spawn, exists?: (path: string) => boolean}} [deps]
 */
export async function runComposerCli(argv, deps = {}) {
  const proc = deps.proc ?? process;
  const parsed = parseArguments(argv);

  if ("error" in parsed) {
    proc.stderr.write(`[zudo-composer] ${parsed.error}\n\n${USAGE}`);
    proc.exitCode = 1;
    return;
  }
  if (parsed.command === "help") {
    proc.stdout.write(USAGE);
    return;
  }
  if (parsed.command === "release") {
    spawnSupervised({
      command: proc.execPath,
      args: [RELEASE_ENTRY_PATH, ...parsed.rest],
      label: "the SiteProject release API",
      entryPath: RELEASE_ENTRY_PATH,
      ...(deps.spawn ? { spawn: deps.spawn } : {}),
      ...(deps.exists ? { exists: deps.exists } : {}),
      proc,
    });
    return;
  }
  if (parsed.command === "build-site") {
    const { workspaceRoot, printRoutes, verifyDirectory, sourceRevision } = parsed.options;
    const args = [BUILD_SITE_ENTRY_PATH];
    if (workspaceRoot !== undefined) args.push("--root", workspaceRoot);
    if (printRoutes) args.push("--print-routes");
    if (verifyDirectory !== undefined) args.push("--verify", verifyDirectory);
    if (sourceRevision !== undefined) args.push("--source-revision", sourceRevision);
    spawnSupervised({
      command: proc.execPath,
      args,
      label: "the static website builder",
      entryPath: BUILD_SITE_ENTRY_PATH,
      ...(deps.spawn ? { spawn: deps.spawn } : {}),
      ...(deps.exists ? { exists: deps.exists } : {}),
      proc,
    });
    return;
  }

  const start = deps.start ?? (async (options) => (await import("../dev-server.mjs")).startComposerDevServer(options));
  const { server } = await start(parsed.options);
  superviseDevServer(server, proc);
  server.printUrls?.();
  return server;
}
