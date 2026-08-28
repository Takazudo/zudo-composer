import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFile = promisify(execFileCallback);
const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const packageRoot = path.join(repositoryRoot, 'packages', 'component-contract');
const repositoryUrl = 'https://github.com/Takazudo/zudo-composer.git';
const packageName = '@zudo-composer/component-contract';
const handoffPath = path.join(repositoryRoot, 'contract-handoff.json');
const pnpmExecutable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const forceExact = process.argv.slice(2).includes('--exact');
const forceLocal = process.argv.slice(2).includes('--local');
const isCi = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';

function fail(message) {
  throw new Error(`[contract install] ${message}`);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function assertNoDependencyProtocols(content, description) {
  for (const [label, pattern] of [
    ['workspace:', /(?:^|[^A-Za-z0-9_-])workspace:/u],
    ['file:', /(?:^|[^A-Za-z0-9_-])file:/u],
    ['link:', /(?:^|[^A-Za-z0-9_-])link:/u],
  ]) {
    assert(!pattern.test(content), `${description} must not contain ${label}`);
  }
}

const handoff = JSON.parse(await readFile(handoffPath, 'utf8'));
assert(handoff.packageName === packageName, 'contract handoff package name changed');
assert(handoff.sourcePath === 'packages/component-contract', 'contract handoff source path changed');
assert(typeof handoff.packageBranch === 'string' && handoff.packageBranch.length > 0, 'contract handoff package branch is missing');
assert(/^[0-9a-f]{40}$/u.test(handoff.packageCommit), 'contract handoff must contain a full 40-character lowercase package commit');
assert(handoff.rootGitSpec === `git+${repositoryUrl}#${handoff.packageCommit}`, 'contract handoff root Git spec must exactly identify the package commit');

async function run(command, args, cwd, { allowFailure = false } = {}) {
  try {
    const result = await execFile(command, args, {
      cwd,
      env: process.env,
      maxBuffer: 16 * 1024 * 1024,
    });
    return { ...result, exitCode: 0 };
  } catch (error) {
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
  const temporaryGitDirectory = await mkdtemp(path.join(os.tmpdir(), 'zudo-composer-contract-git-'));
  try {
    await run('git', ['init', '--bare', '--quiet', temporaryGitDirectory], repositoryRoot);
    await run('git', ['fetch', '--no-tags', '--depth=1', repositoryUrl, handoff.packageCommit], temporaryGitDirectory);
    const remoteTree = (await run('git', ['rev-parse', `${handoff.packageCommit}^{tree}`], temporaryGitDirectory)).stdout.trim();
    assert(remoteTree === localTree, `package branch tree ${remoteTree} does not equal HEAD:${handoff.sourcePath} tree ${localTree}`);
  } finally {
    await rm(temporaryGitDirectory, { recursive: true, force: true });
  }
}

async function writeFixture(directory, gitSpec) {
  await writeFile(path.join(directory, 'package.json'), `${JSON.stringify({
    name: 'zudo-composer-contract-install-fixture',
    version: '0.0.0',
    private: true,
    packageManager: 'pnpm@11.5.2',
    dependencies: { [packageName]: gitSpec },
  }, null, 2)}\n`);
  // pnpm 11 requires an explicit build allowlist for Git dependencies. Keep
  // this consumer workspace empty so the package does not inherit repository
  // projects; the only handoff permission is the contract build itself.
  await writeFile(path.join(directory, 'pnpm-workspace.yaml'), `packages: []\nallowBuilds:\n  '${packageName}': true\n`);
}

async function assertInstalledModule(directory) {
  const probe = [
    `const contract = await import(${JSON.stringify(packageName)});`,
    `const fixtures = await import(${JSON.stringify(`${packageName}/fixtures`)});`,
    "if (contract.CONTRACT_VERSION !== 1) throw new Error('unexpected contract version');",
    "if (fixtures.fixtureComponentPack?.manifest?.contractVersion !== 1) throw new Error('fixture export is unavailable');",
  ].join('\n');
  await run('node', ['--input-type=module', '--eval', probe], directory);
}

async function assertExactLock(directory, sha, gitSpec) {
  const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
  assert(manifest.dependencies?.[packageName] === gitSpec, 'fixture package.json must retain the quoted exact root Git spec');
  assert(!gitSpec.includes('&path:'), 'fixture dependency must not use a Git subdirectory selector');
  assertNoDependencyProtocols(gitSpec, 'fixture dependency spec');
  const workspaceConfig = await readFile(path.join(directory, 'pnpm-workspace.yaml'), 'utf8');
  assert(workspaceConfig.startsWith('packages: []\n'), 'external fixture must not prepare repository-root workspace projects');
  assert(workspaceConfig.includes(`'${packageName}': true`), 'external fixture must explicitly allow only the contract build');
  assertNoDependencyProtocols(workspaceConfig, 'external fixture workspace config');
  assert(!workspaceConfig.includes('../') && !workspaceConfig.includes('..\\'), 'external fixture workspace config must not contain sibling paths');
  const lock = await readFile(path.join(directory, 'pnpm-lock.yaml'), 'utf8');
  assert(lock.includes(sha), 'fixture lockfile must contain the full 40-character commit SHA');
  assert(!lock.includes('path:'), 'fixture lockfile must not record a Git subdirectory selector');
  assertNoDependencyProtocols(lock, 'fixture lockfile');
}

async function runExactInstall(sha) {
  const gitSpec = handoff.rootGitSpec;
  assert(sha === handoff.packageCommit, 'exact install SHA must match the committed package handoff');
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'zudo-composer-contract-install-'));
  try {
    await writeFixture(fixture, gitSpec);
    await run(pnpmExecutable, ['install', '--lockfile-only'], fixture);
    await assertExactLock(fixture, sha, gitSpec);
    await run(pnpmExecutable, ['install', '--frozen-lockfile'], fixture);
    await assertInstalledModule(fixture);
    console.log(`External exact package-root install passed: ${gitSpec}`);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
}

async function runPackageProof() {
  const artifactDirectory = await mkdtemp(path.join(os.tmpdir(), 'zudo-composer-contract-pack-'));
  const consumerDirectory = await mkdtemp(path.join(os.tmpdir(), 'zudo-composer-contract-consumer-'));
  try {
    await run(pnpmExecutable, ['run', 'build'], packageRoot);
    await run(pnpmExecutable, ['pack', '--pack-destination', artifactDirectory], packageRoot);
    const artifacts = (await readdir(artifactDirectory)).filter((entry) => entry.endsWith('.tgz'));
    assert(artifacts.length === 1, `expected one packed contract artifact, found ${artifacts.length}`);
    const artifact = path.join(artifactDirectory, artifacts[0]);
    await writeFile(path.join(consumerDirectory, 'package.json'), `${JSON.stringify({
      name: 'zudo-composer-contract-package-proof',
      version: '0.0.0',
      private: true,
    }, null, 2)}\n`);
    await run(npmExecutable, ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock', '--prefix', consumerDirectory, artifact], repositoryRoot);
    await assertInstalledModule(consumerDirectory);
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
      await runExactInstall(handoff.packageCommit);
    } else if (branch.status === 'reachable') {
      await assertPackageTree();
      await runExactInstall(handoff.packageCommit);
    } else {
      console.log(`Local exact package-ref install skipped: ${branch.reason}`);
      await runPackageProof();
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
