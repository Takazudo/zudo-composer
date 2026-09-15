// @ts-check

// External handoff gate for the owned UI pack (#701), mirroring
// verify-contract-install.mjs: the package-only branch must advertise the
// recorded commit, that commit's tree must equal HEAD:packages/ui, and an
// external consumer must install it through the one exact root Git spec.

import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

/** @typedef {Error & {stdout?: string, stderr?: string, code?: number | string | null}} ExecFailure */
/** @typedef {{packageName: string, sourcePath: string, packageBranch: string, packageCommit: string, rootGitSpec: string}} PackageHandoff */
/** @typedef {{status: "unavailable" | "mismatch" | "reachable", reason: string}} BranchStatus */
/** @typedef {[string, RegExp]} ProtocolRule */
/** @typedef {{dependencies?: Record<string, string>}} FixtureManifest */

const execFile = promisify(execFileCallback);
const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const packageRoot = path.join(repositoryRoot, 'packages', 'ui');
const repositoryUrl = 'https://github.com/Takazudo/zudo-composer.git';
const packageName = '@zudo-composer/ui';
const contractName = '@zudo-composer/component-contract';
const pnpmExecutable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const forceExact = process.argv.slice(2).includes('--exact');
const forceLocal = process.argv.slice(2).includes('--local');
const isCi = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
const expectedSidecars = 12;
const expectedMarkdownRuntime = '2.10.1';

/** @param {string} message @returns {never} */
function fail(message) {
  throw new Error(`[ui install] ${message}`);
}

/**
 * @param {unknown} condition
 * @param {string} message
 */
function assert(condition, message) {
  if (!condition) fail(message);
}

/**
 * @param {string} content
 * @param {string} description
 */
function assertNoDependencyProtocols(content, description) {
  for (const [label, pattern] of /** @type {ProtocolRule[]} */ ([
    ['workspace:', /(?:^|[^A-Za-z0-9_-])workspace:/u],
    ['file:', /(?:^|[^A-Za-z0-9_-])file:/u],
    ['link:', /(?:^|[^A-Za-z0-9_-])link:/u],
    ['path:', /(?:^|[^A-Za-z0-9_-])path:/u],
  ])) {
    assert(!pattern.test(content), `${description} must not contain ${label}`);
  }
}

/** @param {unknown} value @returns {value is ExecFailure} */
function isExecFailure(value) {
  if (!(value instanceof Error)) return false;
  if ("stdout" in value && value.stdout !== undefined && typeof value.stdout !== "string") return false;
  if ("stderr" in value && value.stderr !== undefined && typeof value.stderr !== "string") return false;
  if ("code" in value && value.code !== undefined && value.code !== null && typeof value.code !== "number" && typeof value.code !== "string") return false;
  return true;
}

/** @param {string} file @param {string} label @returns {Promise<PackageHandoff>} */
async function readHandoff(file, label) {
  /** @type {PackageHandoff} */
  const handoff = JSON.parse(await readFile(path.join(repositoryRoot, file), 'utf8'));
  assert(/^[0-9a-f]{40}$/u.test(handoff.packageCommit), `${label} handoff must contain a full 40-character lowercase package commit`);
  assert(handoff.rootGitSpec === `git+${repositoryUrl}#${handoff.packageCommit}`, `${label} handoff root Git spec must exactly identify the package commit`);
  return handoff;
}

const handoff = await readHandoff('ui-handoff.json', 'ui');
assert(handoff.packageName === packageName, 'ui handoff package name changed');
assert(handoff.sourcePath === 'packages/ui', 'ui handoff source path changed');
assert(handoff.packageBranch === 'package/ui-v1', 'ui handoff package branch changed');
const contractHandoff = await readHandoff('contract-handoff.json', 'contract');
assert(contractHandoff.packageName === contractName, 'contract handoff package name changed');

/**
 * @param {string} command
 * @param {string[]} args
 * @param {string} cwd
 * @param {{allowFailure?: boolean}} [options]
 * @returns {Promise<{stdout: string, stderr: string, exitCode: number}>}
 */
async function run(command, args, cwd, { allowFailure = false } = {}) {
  try {
    const result = await execFile(command, args, {
      cwd,
      env: process.env,
      maxBuffer: 16 * 1024 * 1024,
      encoding: 'utf8',
    });
    return { ...result, exitCode: 0 };
  } catch (error) {
    if (!isExecFailure(error)) throw error;
    if (allowFailure) {
      return {
        stdout: error.stdout ?? '',
        stderr: error.stderr ?? '',
        exitCode: typeof error.code === 'number' ? error.code : 1,
      };
    }
    const output = [error.stdout, error.stderr].filter(Boolean).join('\n');
    fail(`${command} ${args.join(' ')} failed${output ? `:\n${output}` : ''}`);
  }
}

/** @returns {Promise<BranchStatus>} */
async function packageBranchStatus() {
  const ref = `refs/heads/${handoff.packageBranch}`;
  const result = await run('git', ['ls-remote', '--exit-code', repositoryUrl, ref], repositoryRoot, { allowFailure: true });
  const match = result.stdout.split(/\r?\n/u).map((line) => line.trim().split(/\s+/u)).find((parts) => parts[1] === ref);
  if (match === undefined) {
    const reason = result.stderr.trim().replace(/\s+/gu, ' ');
    return { status: 'unavailable', reason: reason || `${ref} is not advertised by the public repository` };
  }
  if (match[0] !== handoff.packageCommit) {
    return { status: 'mismatch', reason: `${ref} points at ${match[0]}, expected ${handoff.packageCommit}` };
  }
  return { status: 'reachable', reason: '' };
}

async function assertPackageTree() {
  const localTree = (await run('git', ['rev-parse', `HEAD:${handoff.sourcePath}`], repositoryRoot)).stdout.trim();
  const temporaryGitDirectory = await mkdtemp(path.join(os.tmpdir(), 'zudo-composer-ui-git-'));
  try {
    await run('git', ['init', '--bare', '--quiet', temporaryGitDirectory], repositoryRoot);
    await run('git', ['fetch', '--no-tags', '--depth=1', repositoryUrl, handoff.packageCommit], temporaryGitDirectory);
    const remoteTree = (await run('git', ['rev-parse', `${handoff.packageCommit}^{tree}`], temporaryGitDirectory)).stdout.trim();
    assert(remoteTree === localTree, `package branch tree ${remoteTree} does not equal HEAD:${handoff.sourcePath} tree ${localTree}`);
  } finally {
    await rm(temporaryGitDirectory, { recursive: true, force: true });
  }
}

/** @returns {Promise<Record<string, string>>} */
async function peerVersions() {
  const manifest = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  return { preact: manifest.peerDependencies.preact, tailwindcss: manifest.peerDependencies.tailwindcss };
}

/**
 * @param {string} directory
 * @param {Record<string, string>} dependencies
 */
async function writeFixture(directory, dependencies) {
  await writeFile(path.join(directory, 'package.json'), `${JSON.stringify({
    name: 'zudo-composer-ui-install-fixture',
    version: '0.0.0',
    private: true,
    type: 'module',
    packageManager: 'pnpm@11.5.2',
    dependencies,
  }, null, 2)}\n`);
  // Keep this consumer workspace empty so neither package inherits repository
  // projects; the contract build is the only lifecycle permission needed.
  await writeFile(path.join(directory, 'pnpm-workspace.yaml'), `packages: []\nallowBuilds:\n  '${contractName}': true\n`);
}

/** @returns {Promise<string[]>} */
async function packedFileList() {
  const { stdout } = await run(pnpmExecutable, ['pack', '--dry-run', '--json'], packageRoot);
  const metadata = JSON.parse(stdout.slice(stdout.indexOf('{')));
  return metadata.files.map((/** @type {{path: string}} */ entry) => entry.path).sort();
}

/** @param {string} directory @param {string} [prefix] @returns {Promise<string[]>} */
async function listFiles(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    if (entry.name === 'node_modules') return [];
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? listFiles(path.join(directory, entry.name), relative) : [relative];
  }));
  return files.flat();
}

/** @param {string} directory */
async function assertInstalledPackage(directory) {
  const probe = [
    "import { createRequire } from 'node:module';",
    "import { readFileSync, realpathSync } from 'node:fs';",
    "import { dirname, join } from 'node:path';",
    `const root = realpathSync(join(process.cwd(), 'node_modules', ${JSON.stringify(packageName)}));`,
    "const packageRequire = createRequire(join(root, 'package.json'));",
    "const consumerRequire = createRequire(join(process.cwd(), 'package.json'));",
    "const wasm = JSON.parse(readFileSync(join(dirname(packageRequire.resolve('@takazudo/zfb-md-wasm/package.json')), 'package.json'), 'utf8'));",
    "consumerRequire.resolve('dompurify', { paths: [root] });",
    "console.log(JSON.stringify({ root, wasm: wasm.version }));",
  ].join('\n');
  const { root, wasm } = JSON.parse((await run('node', ['--input-type=module', '--eval', probe], directory)).stdout);
  assert(wasm === expectedMarkdownRuntime, `@takazudo/zfb-md-wasm resolved to ${wasm}, expected ${expectedMarkdownRuntime}`);

  const installedFiles = (await listFiles(root)).sort();
  const packedFiles = await packedFileList();
  assert(JSON.stringify(installedFiles) === JSON.stringify(packedFiles), `installed file list differs from pnpm pack of packages/ui:\n${installedFiles.filter((file) => !packedFiles.includes(file)).concat(packedFiles.filter((file) => !installedFiles.includes(file))).join('\n')}`);
  const [installedManifest, sourceManifest] = await Promise.all([
    readFile(path.join(root, 'package.json')),
    readFile(path.join(packageRoot, 'package.json')),
  ]);
  assert(installedManifest.equals(sourceManifest), 'installed package.json bytes must equal packages/ui/package.json');

  const packSource = await readFile(path.join(root, 'src/composer-pack.ts'), 'utf8');
  assert(new RegExp(`packId:\\s*["']${packageName.replace('/', '\\/')}["']`, 'u').test(packSource), `composer pack must declare packId ${packageName}`);
  const sidecars = [...packSource.matchAll(/from\s+["']\.\/[^"']+\.composer["']/gu)].length;
  assert(sidecars === expectedSidecars, `composer pack must import ${expectedSidecars} sidecars, found ${sidecars}`);
}

/**
 * @param {string} directory
 * @param {string} sha
 * @param {Record<string, string>} dependencies
 */
async function assertExactLock(directory, sha, dependencies) {
  const manifest = /** @type {FixtureManifest} */ (JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8')));
  for (const [name, spec] of Object.entries(dependencies)) {
    assert(manifest.dependencies?.[name] === spec, `fixture package.json must retain ${name}@${spec}`);
  }
  for (const gitSpec of [handoff.rootGitSpec, contractHandoff.rootGitSpec]) {
    assert(!gitSpec.includes('&path:'), 'fixture dependency must not use a Git subdirectory selector');
    assertNoDependencyProtocols(gitSpec, 'fixture dependency spec');
  }
  const workspaceConfig = await readFile(path.join(directory, 'pnpm-workspace.yaml'), 'utf8');
  assert(workspaceConfig.startsWith('packages: []\n'), 'external fixture must not prepare repository-root workspace projects');
  assertNoDependencyProtocols(workspaceConfig, 'external fixture workspace config');
  assert(!workspaceConfig.includes('../') && !workspaceConfig.includes('..\\'), 'external fixture workspace config must not contain sibling paths');
  const lock = await readFile(path.join(directory, 'pnpm-lock.yaml'), 'utf8');
  assert(lock.includes(sha), 'fixture lockfile must contain the full 40-character ui package commit');
  assert(lock.includes(contractHandoff.packageCommit), 'fixture lockfile must contain the full 40-character contract package commit');
  assertNoDependencyProtocols(lock, 'fixture lockfile');
}

async function runExactInstall() {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'zudo-composer-ui-install-'));
  try {
    const dependencies = { [packageName]: handoff.rootGitSpec, [contractName]: contractHandoff.rootGitSpec, ...(await peerVersions()) };
    await writeFixture(fixture, dependencies);
    await run(pnpmExecutable, ['install', '--lockfile-only'], fixture);
    await assertExactLock(fixture, handoff.packageCommit, dependencies);
    await run(pnpmExecutable, ['install', '--frozen-lockfile'], fixture);
    await assertInstalledPackage(fixture);
    console.log(`External exact package-root install passed: ${handoff.rootGitSpec}`);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
}

async function runPackageProof() {
  const artifactDirectory = await mkdtemp(path.join(os.tmpdir(), 'zudo-composer-ui-pack-'));
  const consumerDirectory = await mkdtemp(path.join(os.tmpdir(), 'zudo-composer-ui-consumer-'));
  try {
    await run(pnpmExecutable, ['pack', '--pack-destination', artifactDirectory], packageRoot);
    const artifacts = (await readdir(artifactDirectory)).filter((entry) => entry.endsWith('.tgz'));
    assert(artifacts.length === 1, `expected one packed ui artifact, found ${artifacts.length}`);
    const artifact = path.join(artifactDirectory, artifacts[0]);
    await run('tar', ['-xzf', artifact, '-C', consumerDirectory], repositoryRoot);
    const packedFiles = await packedFileList();
    const extracted = (await listFiles(path.join(consumerDirectory, 'package'))).sort();
    assert(JSON.stringify(extracted) === JSON.stringify(packedFiles), 'packed ui artifact differs from pnpm pack --dry-run');
    console.log(`Local package proof passed from ${path.basename(artifact)}; the current commit was not claimed as externally reachable.`);
  } finally {
    await Promise.all([
      rm(artifactDirectory, { recursive: true, force: true }),
      rm(consumerDirectory, { recursive: true, force: true }),
    ]);
  }
}

try {
  if (forceLocal) {
    await runPackageProof();
  } else {
    const branch = await packageBranchStatus();
    if (branch.status === 'mismatch') {
      fail(`advertised package branch is stale: ${branch.reason}`);
    }
    if (isCi || forceExact) {
      assert(branch.status === 'reachable', `advertised package branch is unavailable: ${branch.reason}`);
      await assertPackageTree();
      await runExactInstall();
    } else if (branch.status === 'reachable') {
      await assertPackageTree();
      await runExactInstall();
    } else {
      console.log(`Local exact package-ref install skipped: ${branch.reason}`);
      await runPackageProof();
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
