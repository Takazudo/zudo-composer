import { execFile as execFileCallback } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFile = promisify(execFileCallback);
const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const packageRoot = path.join(repositoryRoot, 'packages', 'component-contract');
const packageJsonPath = path.join(packageRoot, 'package.json');

function fail(message) {
  throw new Error(`[package conformance] ${message}`);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

async function assertFile(relativePath) {
  try {
    await access(path.join(packageRoot, relativePath));
  } catch {
    fail(`required package output is missing: ${relativePath} (run the package build first)`);
  }
}

function parsePackJson(stdout) {
  const start = stdout.lastIndexOf('\n{');
  const json = (start === -1 ? stdout : stdout.slice(start + 1)).trim();
  try {
    return JSON.parse(json);
  } catch {
    fail(`pnpm pack --dry-run --json did not return parseable metadata:\n${stdout}`);
  }
}

const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
assert(packageJson.name === '@zudo-composer/component-contract', 'package name changed');
assert(packageJson.version === '1.0.0', 'contract package version must remain 1.0.0');
assert(packageJson.sideEffects === false, 'contract package must remain side-effect free');
assert(Array.isArray(packageJson.files) && packageJson.files.includes('dist'), 'package files must include dist');
assert(packageJson.dependencies === undefined || Object.keys(packageJson.dependencies).length === 0, 'generic contract must not have runtime dependencies');
assert(packageJson.scripts?.prepare === 'pnpm run build', 'Git consumers must prepare from the package directory');

const expectedExports = {
  '.': { types: './dist/index.d.ts', import: './dist/index.js' },
  './fixtures': { types: './dist/fixtures.d.ts', import: './dist/fixtures.js' },
};
assert(JSON.stringify(packageJson.exports) === JSON.stringify(expectedExports), 'package exports must point at the built public entrypoints');

for (const output of [
  'dist/index.js',
  'dist/index.d.ts',
  'dist/fixtures.js',
  'dist/fixtures.d.ts',
]) {
  await assertFile(output);
}

const pnpmExecutable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
let packedMetadata;
try {
  const result = await execFile(pnpmExecutable, ['pack', '--dry-run', '--json'], { cwd: packageRoot, maxBuffer: 4 * 1024 * 1024 });
  packedMetadata = parsePackJson(result.stdout);
} catch (error) {
  fail(`pnpm pack conformance check failed: ${error instanceof Error ? error.message : String(error)}`);
}

const packedPaths = new Set((packedMetadata.files ?? []).map((entry) => entry.path));
for (const output of [
  'dist/index.js',
  'dist/index.d.ts',
  'dist/fixtures.js',
  'dist/fixtures.d.ts',
]) {
  assert(packedPaths.has(output), `packed artifact omits ${output}`);
}
assert([...packedPaths].every((entry) => !entry.startsWith('src/')), 'packed artifact must not expose TypeScript sources');
assert([...packedPaths].every((entry) => !entry.endsWith('.test.ts')), 'packed artifact must not expose package tests');

console.log(`Package conformance passed: ${packageJson.name}@${packageJson.version}`);

// ---------------------------------------------------------------------------
// The root package a host installs.
//
// Its allowlist is the whole risk: `zudo-composer dev` evaluates the package's
// TypeScript sources through Vite, so anything the launcher touches has to be
// in the archive, and a missing entry surfaces only inside a consumer. Every
// assertion below is checked against the packed file list, never against the
// allowlist that produced it.
// ---------------------------------------------------------------------------

const rootPackageJson = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'));

assert(rootPackageJson.private === undefined, 'the root package must stay publishable (no `private`)');
assert(rootPackageJson.bin?.['zudo-composer'] === './bin/zudo-composer.mjs', 'the `zudo-composer` bin must point at ./bin/zudo-composer.mjs');
assert(
  rootPackageJson.peerDependencies?.['@zudo-composer/component-contract'] === '1.0.0',
  'the contract must be a peerDependency so a host resolves one instance',
);

// Dev-only for this repository, runtime-required for a host: the installed
// launcher imports all four.
for (const runtime of ['vite', '@preact/preset-vite', '@tailwindcss/vite', 'tailwindcss']) {
  assert(rootPackageJson.dependencies?.[runtime] !== undefined, `${runtime} is loaded by the installed launcher and must be a runtime dependency`);
  assert(rootPackageJson.devDependencies?.[runtime] === undefined, `${runtime} must not also be a devDependency`);
}
for (const [field, specs] of Object.entries({ dependencies: rootPackageJson.dependencies, peerDependencies: rootPackageJson.peerDependencies })) {
  for (const [name, spec] of Object.entries(specs ?? {})) {
    assert(!String(spec).startsWith('workspace:'), `${field}.${name} must not ship a workspace: spec`);
  }
}

const expectedRootExports = {
  '.': { types: './server/dev-server.d.mts', default: './server/dev-server.mjs' },
  './config': { types: './server/config/define.d.mts', default: './server/config/define.mjs' },
  './vite': { types: './plugins/index.d.mts', default: './plugins/index.mjs' },
  './styles': './src/style.css',
  './package.json': './package.json',
};
assert(JSON.stringify(rootPackageJson.exports) === JSON.stringify(expectedRootExports), 'the root package exports map changed');

let rootPackedMetadata;
try {
  const result = await execFile(pnpmExecutable, ['pack', '--dry-run', '--json'], { cwd: repositoryRoot, maxBuffer: 32 * 1024 * 1024 });
  rootPackedMetadata = parsePackJson(result.stdout);
} catch (error) {
  fail(`root pnpm pack conformance check failed: ${error instanceof Error ? error.message : String(error)}`);
}
const rootPackedPaths = new Set((rootPackedMetadata.files ?? []).map((entry) => entry.path));

// Every `exports` and `bin` target, resolved against what actually ships.
const exportTargets = Object.values(expectedRootExports).flatMap((entry) => (typeof entry === 'string' ? [entry] : Object.values(entry)));
for (const target of [...exportTargets, rootPackageJson.bin['zudo-composer']]) {
  assert(rootPackedPaths.has(target.replace(/^\.\//u, '')), `packed archive omits the declared entry point ${target}`);
}

// Sources the launcher loads, and the two files `compilerIdentity()` walks.
for (const required of [
  'index.html',
  'contract-handoff.json',
  'src/main.tsx',
  'src/App.tsx',
  'server/cli/run.mjs',
  'server/cli/api-entry.mjs',
  'server/module-evaluator.mjs',
  'server/config/index.ts',
  'server/site-project-local/toolchain-config.mjs',
  'plugins/roots.mjs',
  'plugins/composer-app-html.mjs',
  'packages/component-contract/src/index.ts',
]) {
  assert(rootPackedPaths.has(required), `packed archive omits the runtime file ${required}`);
}

for (const packed of rootPackedPaths) {
  assert(!/(?:^|\/)__tests__\//u.test(packed), `packed archive exposes a test directory: ${packed}`);
  assert(!/(?:^|\/)type-tests\//u.test(packed), `packed archive exposes type tests: ${packed}`);
  assert(!/\.test\./u.test(packed), `packed archive exposes a test file: ${packed}`);
  assert(!packed.startsWith('src/test/'), `packed archive exposes test helpers: ${packed}`);
  assert(!packed.startsWith('fixtures/'), `packed archive exposes the host fixture: ${packed}`);
  assert(!packed.startsWith('tests/'), `packed archive exposes browser tests: ${packed}`);
  assert(!/^playwright[.a-z-]*\.config\.ts$/u.test(packed), `packed archive exposes Playwright configuration: ${packed}`);
  assert(!packed.startsWith('scripts/'), `packed archive exposes repository scripts: ${packed}`);
}

console.log(`Package conformance passed: ${rootPackageJson.name} (${rootPackedPaths.size} packed files)`);
