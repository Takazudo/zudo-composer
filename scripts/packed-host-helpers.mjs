// @ts-check
/* global AbortController, AbortSignal, structuredClone */
// Shared mechanics for the packed-install proof. Consumer commands always run
// from the copied host, with its own installed dependencies and no root overrides.
import { execFile as execFileCallback, spawn } from "node:child_process";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { discoverConsumerHosts } from "./check-consumer-boundary.mjs";
import { DEMOS_LANE_DIRECTORY } from "./demos-lane-paths.mjs";

/** @typedef {import("node:child_process").ExecFileOptionsWithStringEncoding} ExecFileOptions */
/** @typedef {Record<string, string>} Tarballs */
/** @typedef {{name: string, packageManager?: string, pnpm?: Record<string, unknown>, dependencies?: Record<string, string>, devDependencies?: Record<string, string>, optionalDependencies?: Record<string, string>, peerDependencies?: Record<string, string>}} HostManifest */
const execFile = promisify(execFileCallback);
export const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
export const FIRST_PARTY = ["zudo-composer", "@zudo-composer/component-contract"];
export const WRITABLE = ["node_modules", "cms", "public", ".zudo-site-project"];
const dependencySections = /** @type {const} */ (["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]);
const omittedDirectories = new Set(["node_modules", ".git", "dist", "dist-site", ".zudo-site-project", ".vite", "coverage", "test-results", "playwright-report", DEMOS_LANE_DIRECTORY]);

/** @param {string} root @param {string} candidate */
export function inside(root, candidate) {
  const part = relative(root, candidate);
  return part !== ".." && !part.startsWith(`..${sep}`) && !isAbsolute(part);
}

/**
 * Include the containing main checkout when invoked from a nested worktree.
 * @param {string} root
 */
export async function repositoryRoots(root) {
  const roots = [await realpath(root)];
  for (let parent = dirname(roots[0]); parent !== dirname(parent); parent = dirname(parent)) {
    if (await lstat(join(parent, ".git")).catch(() => undefined)) roots.push(parent);
  }
  return roots;
}

/** @param {string[]} roots @param {string} workspace */
export async function assertExternalWorkspace(roots, workspace) {
  const actual = await realpath(workspace);
  if (roots.some((root) => inside(root, actual))) throw new Error(`Packed hosts must be outside the repository: ${actual}`);
  // A parent workspace or ambient node_modules would make even a /tmp install
  // depend on something other than the consumer's declared dependencies.
  for (let parent = dirname(actual); ; parent = dirname(parent)) {
    for (const name of ["pnpm-workspace.yaml", "node_modules"]) {
      if (await lstat(join(parent, name)).catch(() => undefined)) {
        throw new Error(`Packed host isolation has an ambient parent ${join(parent, name)}`);
      }
    }
    if (parent === dirname(parent)) break;
  }
}

/** @param {string[]} roots */
export async function createPackedWorkspace(roots) {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), "zudo-composer-install-smoke-")));
  try {
    await assertExternalWorkspace(roots, workspace);
    return workspace;
  } catch (error) {
    await rm(workspace, { recursive: true, force: true });
    throw error;
  }
}

/** @param {string[]} roots @param {NodeJS.ProcessEnv} [source] @returns {NodeJS.ProcessEnv} */
export function isolatedEnvironment(roots, source = process.env) {
  const environment = { ...source };
  for (const key of Object.keys(environment)) {
    if (/^(?:ZUDO_|npm_|pnpm_)/iu.test(key) || ["NODE_ENV", "NODE_PATH", "NODE_OPTIONS", "INIT_CWD"].includes(key)) delete environment[key];
  }
  environment.PATH = (source.PATH ?? "").split(delimiter)
    .filter((path) => isAbsolute(path) && !roots.some((root) => inside(root, path)) && !path.split(sep).includes("node_modules"))
    .join(delimiter);
  return environment;
}

/** @param {string} command @param {string[]} args @param {string} cwd @param {ExecFileOptions} [options] */
export async function run(command, args, cwd, options = {}) {
  try {
    const { stdout, stderr } = await execFile(command, args, { cwd, env: process.env, maxBuffer: 64 * 1024 * 1024, encoding: "utf8", ...options });
    return { stdout, stderr };
  } catch (error) {
    if (error && typeof error === "object" && "stdout" in error) process.stderr.write(String(error.stdout));
    if (error && typeof error === "object" && "stderr" in error) process.stderr.write(String(error.stderr));
    throw error;
  }
}

/** Every relative path, sorted, excluding node_modules. @param {string} directory @param {string} [prefix] @returns {Promise<string[]>} */
export async function tree(directory, prefix = "") {
  const paths = [];
  for (const entry of await readdir(join(directory, prefix), { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    paths.push(path);
    if (entry.isDirectory()) paths.push(...await tree(directory, path));
  }
  return paths.sort();
}

/**
 * dist-site is allowed only after positive verification of that host artifact.
 * The callback must run the verifier from the installed package.
 * @param {string} hostRoot @param {string[]} before
 * @param {(() => Promise<unknown>)} [verifySiteArtifact]
 */
export async function assertConfinedWrites(hostRoot, before, verifySiteArtifact) {
  const after = await tree(hostRoot);
  const allowed = [...WRITABLE];
  if (after.includes("dist-site")) {
    if (!verifySiteArtifact) throw new Error("dist-site needs a positive verifySiteStaticArtifact assertion before its writes are allowed");
    await verifySiteArtifact();
    allowed.push("dist-site");
  }
  const baseline = new Set(before);
  const escaped = after.filter((path) => !baseline.has(path) && !allowed.includes(path.split("/")[0]));
  if (escaped.length) throw new Error(`Writes escaped the host's directories: ${escaped.join(", ")}`);
}

/** @param {string} root */
export function discoverPackedHosts(root) {
  // Reuse disk discovery; no workspace membership or private host-name array.
  // fixtures/self-host retains its stronger synthesized browser proof below.
  const hosts = discoverConsumerHosts(root).filter((host) => dirname(host) === join(root, "packages"));
  if (!hosts.length) throw new Error("No real packed host packages were discovered");
  return hosts;
}

/**
 * Also accepts a standalone/generated host directory for the later creator lane.
 * @param {string} source @param {string} destination
 */
export async function copyPackedHost(source, destination) {
  await cp(source, destination, {
    recursive: true,
    filter: async (path) => {
      if (relative(source, path).split(sep).some((part) => omittedDirectories.has(part))) return false;
      if ((await lstat(path)).isSymbolicLink()) throw new Error(`Host source must not carry a filesystem link into the install proof: ${path}`);
      return true;
    },
  });
}

/** @param {HostManifest} input @param {Tarballs} tarballs @param {string} packageManager */
export function packedHostManifest(input, tarballs, packageManager) {
  const manifest = structuredClone(input);
  // Never quietly replace an unknown consumer override or dependency protocol.
  if (manifest.pnpm && Object.keys(manifest.pnpm).length) throw new Error(`${manifest.name}: host pnpm settings must not override the packed proof`);
  for (const name of FIRST_PARTY) {
    if (!tarballs[name]?.startsWith("file:") || !isAbsolute(tarballs[name].slice(5)) || !tarballs[name].endsWith(".tgz")) throw new Error(`Missing absolute packed tarball for ${name}`);
    if (!dependencySections.some((section) => Object.hasOwn(manifest[section] ?? {}, name))) throw new Error(`${manifest.name} must declare ${name}`);
  }
  for (const section of dependencySections) {
    for (const [name, specifier] of Object.entries(manifest[section] ?? {})) {
      const firstParty = FIRST_PARTY.includes(name);
      if (/^(?:workspace|file|link|path):/iu.test(specifier) && !(firstParty && specifier === "workspace:*")) {
        throw new Error(`${manifest.name}: unsupported consumer dependency ${name}: ${specifier}`);
      }
      if (firstParty) /** @type {Record<string, string>} */ (manifest[section])[name] = tarballs[name];
    }
  }
  manifest.packageManager = packageManager;
  manifest.pnpm = { overrides: Object.fromEntries(FIRST_PARTY.map((name) => [name, tarballs[name]])) };
  return manifest;
}

/** @param {string} hostRoot @param {Tarballs} tarballs @param {string} packageManager */
export async function configurePackedHost(hostRoot, tarballs, packageManager) {
  const manifest = packedHostManifest(JSON.parse(await readFile(join(hostRoot, "package.json"), "utf8")), tarballs, packageManager);
  await writeFile(join(hostRoot, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  // pnpm 11 reads these settings from the workspace file. Mirror the two exact
  // package.json pnpm.overrides here, without inheriting repository settings.
  await writeFile(join(hostRoot, "pnpm-workspace.yaml"), `packages: []
nodeLinker: isolated
hoist: false
shamefullyHoist: false
strictPeerDependencies: true
linkWorkspacePackages: false
preferWorkspacePackages: false
resolvePeersFromWorkspaceRoot: false
allowBuilds:
  esbuild: true
  '@zudo-composer/component-contract': true
overrides:
${FIRST_PARTY.map((name) => `  ${JSON.stringify(name)}: ${JSON.stringify(tarballs[name])}`).join("\n")}
`);
  // Local package-manager settings may not undo the isolation policy above.
  if (await lstat(join(hostRoot, ".npmrc")).catch(() => undefined)) throw new Error(`${hostRoot}: a consumer .npmrc needs explicit packed-lane review`);
  await rm(join(hostRoot, "pnpm-lock.yaml"), { force: true });
  return manifest;
}

/** @param {string} directory @param {string} destination */
export async function packPackage(directory, destination) {
  await mkdir(destination, { recursive: true });
  const before = new Set(await readdir(destination));
  await run(pnpm, ["pack", "--pack-destination", destination], directory);
  const added = (await readdir(destination)).filter((path) => path.endsWith(".tgz") && !before.has(path));
  if (added.length !== 1) throw new Error(`Expected one new pnpm pack tarball from ${directory}, found ${added.length}`);
  return `file:${join(destination, added[0])}`;
}

/** @param {string} hostRoot @param {NodeJS.ProcessEnv} env @param {string[]} roots */
export async function assertInstalledHost(hostRoot, env, roots) {
  const { stdout } = await run(process.execPath, ["--input-type=module", "-e", `
    import assert from 'node:assert/strict';
    import { createRequire } from 'node:module';
    import { realpath } from 'node:fs/promises';
    import { resolve, relative, isAbsolute, sep } from 'node:path';
    const require = createRequire(resolve('package.json'));
    const inside = (root, path) => { const part = relative(root, path); return part !== '..' && !part.startsWith('..' + sep) && !isAbsolute(part); };
    const roots = JSON.parse(process.argv[1]);
    const installed = {};
    for (const name of ${JSON.stringify(FIRST_PARTY)}) {
      const path = await realpath(require.resolve(name + '/package.json'));
      assert.ok(inside(resolve('node_modules'), path), name + ' did not resolve from this host node_modules: ' + path);
      assert.ok(!roots.some(root => inside(root, path)), name + ' resolved into the repository');
      assert.ok(!require.resolve.paths(name).some(path => roots.some(root => inside(root, path))), 'Repository node_modules was in the host resolution path');
      installed[name] = path;
    }
    console.log(JSON.stringify(installed));
  `, JSON.stringify(roots)], hostRoot, { env });
  return JSON.parse(stdout);
}

/** @param {string} origin @param {AbortSignal} signal */
export async function waitForServer(origin, signal) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    signal.throwIfAborted();
    try {
      const response = await fetch(`${origin}/@vite/client`, { signal: AbortSignal.any([signal, AbortSignal.timeout(2_000)]) });
      if (response.ok) return;
    } catch {
      signal.throwIfAborted();
    }
    await delay(500, undefined, { signal });
  }
  throw new Error(`The installed dev server never answered on ${origin}.`);
}

/**
 * Keep the detached process-group ownership used by the original proof. Failed
 * startup must clean up too; no orphan server may satisfy the next host probe.
 * @param {string} hostRoot
 * @param {{port?: number, env?: NodeJS.ProcessEnv, command?: string, args?: string[]}} [options]
 */
export async function startHostServer(hostRoot, { port = 4175, env = process.env, command = pnpm, args = ["exec", "zudo-composer", "dev", "--host", "127.0.0.1", "--port", String(port), "--strict-port"] } = {}) {
  const origin = `http://127.0.0.1:${port}`;
  // Check that readiness cannot be supplied by an unrelated existing process.
  const { createServer } = await import("node:net");
  await new Promise((resolveFree, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(port, "127.0.0.1", () => probe.close(resolveFree));
  });
  const child = spawn(command, args, { cwd: hostRoot, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let output = "";
  child.stdout.on("data", (chunk) => { output += String(chunk); });
  child.stderr.on("data", (chunk) => { output += String(chunk); });
  const abort = new AbortController();
  const stopped = new Promise((settle) => child.once("exit", settle).once("error", settle));
  async function stop() {
    abort.abort();
    if (!child.pid) return;
    // Signal the group even when its leader exited before its children did.
    try { process.kill(-child.pid, "SIGTERM"); } catch { return; }
    const timeout = new AbortController();
    try {
      await Promise.race([stopped, delay(2_000, undefined, { signal: timeout.signal })]);
    } finally {
      timeout.abort();
      try { process.kill(-child.pid, "SIGKILL"); } catch { /* Group already gone. */ }
    }
  }
  /** @type {((code: number | null) => void) | undefined} */
  let onExit;
  /** @type {((error: Error) => void) | undefined} */
  let onError;
  const exited = new Promise((_, reject) => {
    onExit = (code) => reject(new Error(`The installed dev server exited with ${code}:\n${output}`));
    onError = (error) => reject(error);
    child.once("exit", onExit).once("error", onError);
  });
  try {
    await Promise.race([waitForServer(origin, abort.signal), exited]);
    return { output: () => output, stop };
  } catch (error) {
    await stop();
    throw error;
  } finally {
    abort.abort();
    if (onExit) child.off("exit", onExit);
    if (onError) child.off("error", onError);
  }
}

/** @param {string[]} args @param {string[]} discovered */
export function selectPackedHosts(args, discovered) {
  const requested = [];
  let negative;
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    const value = args[++index];
    if (option === "--host" && value && !value.startsWith("--")) requested.push(value);
    else if (option === "--negative" && ["missing-runtime", "hoisted-dependency"].includes(value) && !negative) negative = value;
    else throw new Error(`Usage: smoke-host-install.mjs [--host <name>]... [--negative missing-runtime|hoisted-dependency]; invalid option ${option}`);
  }
  const hosts = requested.length ? [...new Set(requested.map((name) => {
    const matches = discovered.filter((host) => basename(host) === name || host === resolve(name));
    if (matches.length !== 1) throw new Error(`Unknown or ambiguous packed host: ${name}`);
    return matches[0];
  }))] : discovered;
  if (negative && (!requested.length || hosts.length !== 1)) throw new Error("A negative proof requires exactly one --host");
  return { hosts, negative, fixture: requested.length === 0 };
}
