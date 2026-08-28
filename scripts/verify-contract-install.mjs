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
const packageSubdirectory = 'packages/component-contract';
const packageName = '@zudo-composer/component-contract';
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

function validateSha(value, source) {
  assert(/^[0-9a-f]{40}$/u.test(value), `${source} must be a full 40-character lowercase commit SHA`);
  return value;
}

async function currentSha() {
  const result = await run('git', ['rev-parse', 'HEAD'], repositoryRoot);
  return validateSha(result.stdout.trim(), 'current commit');
}

function configuredSha() {
  return process.env.CONTRACT_GIT_SHA ?? process.env.GITHUB_HEAD_SHA ?? process.env.GITHUB_SHA;
}

async function remoteContainsSha(sha) {
  const result = await run('git', ['ls-remote', '--exit-code', repositoryUrl, sha], repositoryRoot, { allowFailure: true });
  if (result.exitCode === 0 && result.stdout.split(/\r?\n/u).some((line) => line.startsWith(`${sha}\t`))) {
    return { reachable: true, reason: '' };
  }
  const reason = result.stderr.trim().replace(/\s+/gu, ' ');
  return { reachable: false, reason: reason || 'the commit is not advertised by the public repository' };
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
  assert(manifest.dependencies?.[packageName] === gitSpec, 'fixture package.json must retain the quoted exact Git subdirectory spec');
  const workspaceConfig = await readFile(path.join(directory, 'pnpm-workspace.yaml'), 'utf8');
  assert(workspaceConfig.startsWith('packages: []\n'), 'external fixture must not prepare repository-root workspace projects');
  assert(workspaceConfig.includes(`'${packageName}': true`), 'external fixture must explicitly allow only the contract build');
  for (const forbidden of ['workspace:', 'file:', 'link:', '../', '..\\']) {
    assert(!workspaceConfig.includes(forbidden), `external fixture workspace config must not contain ${forbidden}`);
  }
  const lock = await readFile(path.join(directory, 'pnpm-lock.yaml'), 'utf8');
  assert(lock.includes(sha), 'fixture lockfile must contain the full 40-character commit SHA');
  assert(new RegExp(`commit:\\s*${sha}\\b`, 'u').test(lock), 'fixture lockfile must record the full Git commit resolution');
  assert(new RegExp(`path:\\s*${packageSubdirectory}\\b`, 'u').test(lock), 'fixture lockfile must record the component-contract subdirectory');
  for (const forbidden of ['workspace:', 'file:', 'link:']) {
    assert(!lock.includes(forbidden), `fixture lockfile must not contain ${forbidden}`);
  }
}

async function runExactInstall(sha) {
  const gitSpec = `git+${repositoryUrl}#${sha}&path:${packageSubdirectory}`;
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'zudo-composer-contract-install-'));
  try {
    await writeFixture(fixture, gitSpec);
    await run(pnpmExecutable, ['install', '--lockfile-only', '--ignore-scripts'], fixture);
    await assertExactLock(fixture, sha, gitSpec);
    await run(pnpmExecutable, ['install', '--frozen-lockfile'], fixture);
    await assertInstalledModule(fixture);
    console.log(`External exact-SHA install passed: ${repositoryUrl}#${sha}&path:${packageSubdirectory}`);
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

const sha = validateSha(configuredSha() ?? await currentSha(), configuredSha() ? 'configured commit' : 'current commit');

try {
  if (forceLocal) {
    await runPackageProof();
  } else if (isCi || forceExact) {
    await runExactInstall(sha);
  } else {
    const reachability = await remoteContainsSha(sha);
    if (reachability.reachable) {
      await runExactInstall(sha);
    } else {
      console.log(`Local exact-SHA install skipped: ${sha} is not externally reachable (${reachability.reason}).`);
      await runPackageProof();
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
