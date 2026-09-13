// @ts-check
import { execFile } from "node:child_process";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { forwardedSignals } from "../cli/supervise.mjs";
import { assertCreatorVersionParity, readCreatorMetadata, validateHostName, writeHostProject } from "./project.mjs";

/** @typedef {{target: string, name?: string, toolTarball?: string, contractTarball?: string}} InitOptions */
/** @typedef {{cwd: string, env: NodeJS.ProcessEnv, timeout: number}} CommandOptions */
/** @typedef {(command: string, args: string[], options: CommandOptions) => Promise<string>} InitCommand */

/** Forward cancellation to every bootstrap child and close JSON-stdin commands.
 * @type {InitCommand} */
export function runInitCommand(command, args, options) {
  return new Promise((settle, reject) => {
    const handlers = new Map();
    const child = execFile(command, args, { ...options, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      for (const [signal, handler] of handlers) process.off(signal, handler);
      if (error) reject(new Error(`${basename(command)} ${args.join(" ")} failed: ${stderr || error.message}`, { cause: error }));
      else settle(stdout);
    });
    child.stdin?.end();
    for (const signal of forwardedSignals(process.platform)) {
      const forward = () => child.kill(/** @type {NodeJS.Signals} */ (signal));
      handlers.set(signal, forward);
      process.on(signal, forward);
    }
  });
}

/** Read the archive's real package metadata; filenames never attest a version.
 * No archive entries are extracted into the host.
 * @param {string} path @param {string} name @param {string} version */
export async function assertCreatorTarball(path, name, version) {
  if (!(await lstat(path)).isFile()) throw new Error(`Expected a package tarball file: ${path}`);
  const { stdout } = await promisify(execFile)("tar", ["-xOf", path, "package/package.json"], { encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024 });
  const manifest = JSON.parse(stdout);
  if (manifest.name !== name || manifest.version !== version) {
    throw new Error(`Creator tarball mismatch: expected ${name}@${version}, received ${manifest.name}@${manifest.version}.`);
  }
}

async function mustBeAbsent(/** @type {string} */ target) {
  try { await lstat(target); }
  catch (error) { if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") return; throw error; }
  throw new Error(`Creation requires a new directory; existing path was preserved: ${target}`);
}

/** Do not inherit the invoking workspace's data roots, Vite mode, or Node loader.
 * @param {NodeJS.ProcessEnv} source */
export function creatorEnvironment(source) {
  const env = { ...source };
  for (const key of Object.keys(env)) {
    if (/^ZUDO_/.test(key) || ["NODE_PATH", "NODE_OPTIONS", "INIT_CWD", "GITHUB_SHA", "NODE_ENV", "VITE_USER_NODE_ENV"].includes(key)
      || /^npm_(?:config_(?:workspace|filter|prefix|dir)|execpath|node_execpath|lifecycle_)/i.test(key)) delete env[key];
  }
  return env;
}

/** Bootstrap outside every parent workspace, then publish a complete, portable tree.
 * This is create-only: it cannot upgrade, seed, or overwrite an existing project.
 * @param {InitOptions} options
 * @param {{run?: InitCommand, metadata?: import("./project.mjs").CreatorMetadata, log?: (message: string) => void}} [dependencies] */
export async function initHostProject(options, dependencies = {}) {
  const target = resolve(options.target);
  const name = options.name ?? basename(target);
  validateHostName(name);
  const preview = options.toolTarball !== undefined || options.contractTarball !== undefined;
  if (preview && (!options.toolTarball || !options.contractTarball)) throw new Error("--tool-tarball and --contract-tarball must be supplied together.");
  await mustBeAbsent(target);
  const parent = await realpath(dirname(target));
  if (!(await lstat(parent)).isDirectory()) throw new Error("The target's parent must be an existing directory.");
  const destination = join(parent, basename(target));
  const metadata = dependencies.metadata ?? await readCreatorMetadata();
  if (options.toolTarball && options.contractTarball) {
    await assertCreatorTarball(resolve(options.toolTarball), "zudo-composer", metadata.tool.version);
    await assertCreatorTarball(resolve(options.contractTarball), "@zudo-composer/component-contract", metadata.contractVersion);
  } else if (metadata.tool.version === "0.0.0") {
    throw new Error("zudo-composer@0.0.0 is unpublished. Supply --tool-tarball and --contract-tarball from this build to preview creation.");
  }
  const stage = await realpath(await mkdtemp(join(tmpdir(), "zudo-composer-init-")));
  const root = join(stage, "host");
  const run = dependencies.run ?? runInitCommand;
  const log = dependencies.log ?? (() => {});
  const env = creatorEnvironment(process.env);
  let ownsDestination = false;
  try {
    await writeHostProject(root, name, metadata);
    const workspacePath = join(root, "pnpm-workspace.yaml");
    const workspace = await readFile(workspacePath, "utf8");
    if (options.toolTarball && options.contractTarball) {
      // Keep a private copy: even an archive path with spaces is a YAML string,
      // and neither overrides nor its lockfile leave this temporary workspace.
      /** @type {[string, string][]} */
      const archives = [[options.toolTarball, "tool.tgz"], [options.contractTarball, "contract.tgz"]];
      for (const [source, file] of archives) {
        await cp(resolve(source), join(stage, file), { force: false, errorOnExist: true });
      }
      await writeFile(workspacePath, `${workspace}\noverrides:\n  zudo-composer: ${JSON.stringify(`file:${join(stage, "tool.tgz")}`)}\n  '@zudo-composer/component-contract': ${JSON.stringify(`file:${join(stage, "contract.tgz")}`)}\n`);
    }
    log("Installing matching dependencies in an isolated temporary project…");
    await run("corepack", ["pnpm", "install", "--no-frozen-lockfile"], { cwd: root, env, timeout: 300_000 });
    // Require host-local physical resolution. An accidental parent workspace
    // install or a root node_modules symlink must fail before any producer runs.
    for (const [packageName, expected] of [["zudo-composer", metadata.tool.version], ["@zudo-composer/component-contract", metadata.contractVersion]]) {
      const installedRoot = await realpath(join(root, "node_modules", packageName));
      const part = relative(stage, installedRoot);
      if (part === ".." || part.startsWith(`..${sep}`) || isAbsolute(part)) throw new Error(`Creator dependency resolved outside its isolated install: ${packageName}`);
      const installed = JSON.parse(await readFile(join(installedRoot, "package.json"), "utf8"));
      if (installed.name !== packageName || installed.version !== expected) throw new Error(`Creator installed version mismatch for ${packageName}: expected ${expected}, received ${installed.version}.`);
    }
    const bin = join(root, "node_modules/zudo-composer/bin/zudo-composer.mjs");
    for (const args of [["generate"], ["assets", "import", "images-src/manifest.json"], ["seed", "--ready-workspace"]]) {
      log(`Producing starter state: zudo-composer ${args.join(" ")}…`);
      await run(process.execPath, [bin, ...args], { cwd: root, env, timeout: 60_000 });
    }
    // Canonical Assets import owns the catalog and version bytes. The default
    // public delivery directory receives those exact immutable bytes.
    await cp(join(root, "cms/assets/versions"), join(root, "public/uploaded-assets"), { recursive: true, force: false, errorOnExist: true });
    await writeFile(workspacePath, workspace);
    if (preview) await rm(join(root, "pnpm-lock.yaml"), { force: true });
    assertCreatorVersionParity(JSON.parse(await readFile(join(root, "package.json"), "utf8")), metadata);
    await mustBeAbsent(destination);
    // mkdir is the exclusive claim, including races after the first check.
    await mkdir(destination);
    ownsDestination = true;
    for (const entry of await readdir(root)) {
      if (["node_modules", ".zudo-site-project", ".vite"].includes(entry)) continue;
      await cp(join(root, entry), join(destination, entry), { recursive: true, force: false, errorOnExist: true });
    }
    return { directory: destination, name, preview, populated: true };
  } catch (error) {
    if (ownsDestination) await rm(destination, { recursive: true, force: true });
    throw error;
  } finally { await rm(stage, { recursive: true, force: true }); }
}
