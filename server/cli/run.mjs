// @ts-check
// `zudo-composer <command>`.
//
// The commands are deliberately asymmetric. `dev` boots Vite in
// this process — the server object is what has to be closed to release the
// port, so there is nothing to gain from a child. `release` is the JSON-stdin
// SiteProject release API. `release`, `seed`, `assets import`, `generate` and the one-shot
// `build-site` run in child processes, supervised by `spawnSupervised`.

import { constants as osConstants } from "node:os";
import { resolve } from "node:path";
import { APP_ROOT } from "../../plugins/roots.mjs";
import { forwardedSignals, spawnSupervised } from "./supervise.mjs";

/** How long a signal handler waits for `server.close()` before exiting anyway. */
export const CLOSE_GRACE_MS = 2000;

export const RELEASE_ENTRY_PATH = resolve(APP_ROOT, "server/cli/release-entry.mjs");
export const BUILD_SITE_ENTRY_PATH = resolve(APP_ROOT, "server/cli/build-site-entry.mjs");
export const ASSETS_IMPORT_ENTRY_PATH = resolve(APP_ROOT, "server/cli/assets-import-entry.mjs");
export const SEED_ENTRY_PATH = resolve(APP_ROOT, "server/cli/seed-entry.mjs");
export const GENERATE_ENTRY_PATH = resolve(APP_ROOT, "server/cli/generate-entry.mjs");
export const INIT_ENTRY_PATH = resolve(APP_ROOT, "server/cli/init-entry.mjs");

export const USAGE = `Usage: zudo-composer <command> [options]

Commands:
  init <dir>  Create a populated host in a new directory.
  dev         Start the authoring dev server, rooted at the current project.
  release     Run the SiteProject release API (one JSON request on stdin, one
              canonical JSON response on stdout).
  build-site  Build and verify the host's static website in dist-site.
  assets import [manifest]
              Import a host asset manifest, or read { "manifest": "path" } on
              stdin; write one canonical JSON response on stdout.
  generate    Generate site-project.json from site-project.ts.
  seed        Publish and activate a committed SiteProject; print its release
              identity and status (activated or unchanged) as JSON.

init options:
  --name <name>   Lowercase npm package name (default: directory basename).
  --tool-tarball <file> --contract-tarball <file>
                  Preview unpublished matching packages using temporary,
                  isolated overrides. Both archives are required together.
                  Creation runs install, generate, assets import and the ready
                  workspace producer; it never upgrades an existing project.

dev options:
  --root <dir>     Host project root (default: the current directory).
  --port <number>  Port to listen on (0 picks a free one).
  --host [addr]    Expose the server; bare --host listens on all addresses.
  --strict-port    Fail instead of moving to the next free port.

seed options:
  --root <dir>     Host project root (default: the current directory).
  --from <file>    Committed project JSON (relative to cwd; default:
                  site-project.json under the host project root).
  --ready-workspace
                  Produce a selected, complete, reproducible CMS workspace.
                  Uses a disposable release; no host activation is needed.
                  Identical output is unchanged; different existing state fails.
  --output <dir>  With --ready-workspace, use this fresh output tree (relative
                  to cwd), preserving the host's configured relative layout.
                  Print release identity, status, directories and file digests.

build-site options:
  --root <dir>     Host project root (default: the current directory).
  --print-routes   Verify an existing artifact and print its routes as JSON.
  --verify <dir>   Verify this artifact instead of building (relative to cwd).
                  Combine with --print-routes to print this artifact's routes.
  --source-revision <revision>
                  Host revision to record or verify exactly (default: GITHUB_SHA
                  when nonempty; omitted otherwise).

assets import options:
  --root <dir>     Host project root (default: the current directory).
  <manifest>      JSON manifest path, relative to the host root or absolute.
                  Files are relative to the manifest directory. The resolved
                  host config selects the asset store; reruns preserve edits.

generate options:
  --root <dir>     Host project root (default: the current directory).
  --check          Verify site-project.json is current without writing it.
`;

/**
 * @param {string[]} argv
 * @returns {import("./run.d.mts").ParsedComposerCommand}
 */
export function parseArguments(argv) {
  const [command, ...rest] = argv;
  if (command === undefined || command === "--help" || command === "-h" || command === "help") return { command: "help" };
  if (command === "release") return { command: "release", rest };
  if (command === "init") return parseInit(rest);
  if (command === "assets") return parseAssetsImport(rest);
  if (command !== "dev" && command !== "build-site" && command !== "seed" && command !== "generate") return { error: `Unknown command "${command}".` };

  /** @type {Record<string, unknown> & import("../site-build/run.d.mts").BuildSiteOptions & import("./run.d.mts").SeedOptions & import("./run.d.mts").GenerateOptions} */
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
    } else if (command === "seed") {
      if (argument === "--ready-workspace") options.readyWorkspace = true;
      else if (argument === "--from" || argument === "--output") {
        const path = value();
        if (path === undefined) return { error: `${argument} requires ${argument === "--from" ? "a file" : "a directory"}.` };
        if (argument === "--from") options.from = resolve(path);
        else options.outputRoot = resolve(path);
      } else return { error: `Unknown seed option "${argument}".` };
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
    } else if (command === "generate") {
      if (argument === "--check") options.check = true;
      else return { error: `Unknown generate option "${argument}".` };
    } else if (argument === "--strict-port") options.strictPort = true;
    else if (argument === "--host") options.host = value() ?? true;
    else if (argument === "--port") {
      const port = value();
      if (port === undefined || !/^\d+$/.test(port)) return { error: "--port requires a number." };
      options.port = Number(port);
    } else return { error: `Unknown dev option "${argument}".` };
  }
  if (command === "seed" && options.outputRoot !== undefined && !options.readyWorkspace) return { error: "--output requires --ready-workspace." };
  return { command, options };
}

/** @param {string[]} args @returns {import("./run.d.mts").ParsedComposerCommand} */
function parseInit(args) {
  /** @type {Partial<import("../creator/init.mjs").InitOptions>} */
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") return { command: "help" };
    if (["--name", "--tool-tarball", "--contract-tarball"].includes(argument)) {
      const value = args[++index];
      if (!value || value.trim() === "" || value.startsWith("-")) return { error: `${argument} requires ${argument === "--name" ? "a package name" : "a file"}.` };
      const key = argument === "--name" ? "name" : argument === "--tool-tarball" ? "toolTarball" : "contractTarball";
      if (options[key] !== undefined) return { error: `${argument} may be supplied only once.` };
      options[key] = key === "name" ? value : resolve(value);
    } else if (argument.startsWith("-")) return { error: `Unknown init option "${argument}".` };
    else if (options.target !== undefined) return { error: "init accepts one new directory." };
    else if (argument.trim() === "") return { error: "init requires a new directory." };
    else options.target = resolve(argument);
  }
  if (options.target === undefined) return { error: "init requires a new directory." };
  if ((options.toolTarball === undefined) !== (options.contractTarball === undefined)) return { error: "--tool-tarball and --contract-tarball must be supplied together." };
  return { command: "init", options: { ...options, target: options.target } };
}

/** @param {string[]} rest @returns {import("./run.d.mts").ParsedComposerCommand} */
function parseAssetsImport(rest) {
  const [verb, ...args] = rest;
  if (verb === "--help" || verb === "-h") return { command: "help" };
  if (verb !== "import") return { error: 'assets requires the "import" subcommand.' };
  /** @type {{workspaceRoot?: string, manifest?: string}} */
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") return { command: "help" };
    if (argument === "--root") {
      const root = args[++index];
      if (root === undefined || root === "" || root.startsWith("-")) return { error: "--root requires a directory." };
      options.workspaceRoot = resolve(root);
    } else if (argument.startsWith("-")) return { error: `Unknown assets import option "${argument}".` };
    else if (argument.trim() === "") return { error: "assets import requires a nonempty manifest path." };
    else if (options.manifest !== undefined) return { error: "assets import accepts one manifest path." };
    else options.manifest = argument;
  }
  return { command: "assets-import", options };
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
  if (parsed.command === "init") {
    const { target, name, toolTarball, contractTarball } = parsed.options;
    const args = [INIT_ENTRY_PATH, target];
    if (name !== undefined) args.push("--name", name);
    if (toolTarball !== undefined) args.push("--tool-tarball", toolTarball);
    if (contractTarball !== undefined) args.push("--contract-tarball", contractTarball);
    spawnSupervised({
      command: proc.execPath, args, label: "the host creator", entryPath: INIT_ENTRY_PATH,
      ...(deps.spawn ? { spawn: deps.spawn } : {}),
      ...(deps.exists ? { exists: deps.exists } : {}),
      proc,
    });
    return;
  }
  if (parsed.command === "assets-import") {
    const args = [ASSETS_IMPORT_ENTRY_PATH];
    if (parsed.options.manifest !== undefined) args.push(parsed.options.manifest);
    if (parsed.options.workspaceRoot !== undefined) args.push("--root", parsed.options.workspaceRoot);
    spawnSupervised({
      command: proc.execPath,
      args,
      label: "the Assets importer",
      entryPath: ASSETS_IMPORT_ENTRY_PATH,
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
  if (parsed.command === "seed") {
    const { workspaceRoot, from, readyWorkspace, outputRoot } = parsed.options;
    const args = [SEED_ENTRY_PATH];
    if (workspaceRoot !== undefined) args.push("--root", workspaceRoot);
    if (from !== undefined) args.push("--from", from);
    if (readyWorkspace) args.push("--ready-workspace");
    if (outputRoot !== undefined) args.push("--output", outputRoot);
    spawnSupervised({
      command: proc.execPath,
      args,
      label: "the SiteProject seed command",
      entryPath: SEED_ENTRY_PATH,
      ...(deps.spawn ? { spawn: deps.spawn } : {}),
      ...(deps.exists ? { exists: deps.exists } : {}),
      proc,
    });
    return;
  }
  if (parsed.command === "generate") {
    const { workspaceRoot, check } = parsed.options;
    const args = [GENERATE_ENTRY_PATH];
    if (workspaceRoot !== undefined) args.push("--root", workspaceRoot);
    if (check) args.push("--check");
    spawnSupervised({
      command: proc.execPath,
      args,
      label: "the SiteProject generator",
      entryPath: GENERATE_ENTRY_PATH,
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
