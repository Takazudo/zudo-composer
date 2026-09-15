// @ts-check

import { execFile as execFileCallback } from 'node:child_process';
import { access, readFile, readdir } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPackedConsumerBoundary } from './package-host-boundary.mjs';
import { CONTRACT_IDENTITY_ENTRIES } from '../server/site-project-local/contract-entries.mjs';

const execFile = promisify(execFileCallback);
const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const packageRoot = path.join(repositoryRoot, 'packages', 'component-contract');
const packageJsonPath = path.join(packageRoot, 'package.json');

/** @typedef {{files?: Array<{path: string}>}} PackMetadata */

/** @param {string} message @returns {never} */
function fail(message) {
  throw new Error(`[package conformance] ${message}`);
}

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function assert(condition, message) {
  if (!condition) fail(message);
}

/** @param {string} relativePath @returns {Promise<void>} */
async function assertFile(relativePath) {
  try {
    await access(path.join(packageRoot, relativePath));
  } catch {
    fail(`required package output is missing: ${relativePath} (run the package build first)`);
  }
}

/** @param {string} stdout @returns {PackMetadata} */
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
assert(JSON.stringify(packageJson.files) === JSON.stringify(CONTRACT_IDENTITY_ENTRIES.filter((entry) => entry !== 'package.json')), 'contract files must match the published release identity entries');
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
/** @type {PackMetadata | undefined} */
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

// Compare the exact published inputs release identity hashes, including new
// dist chunks and declarations. Documentation is not a release identity input.
/** @param {string} entry @returns {Promise<string[]>} */
async function contractIdentityFiles(entry) {
  if (entry === 'package.json') return [entry];
  const files = [];
  for (const child of await readdir(path.join(packageRoot, entry), { withFileTypes: true })) {
    const name = `${entry}/${child.name}`;
    assert(!child.isSymbolicLink(), `contract identity must not follow a link: ${name}`);
    if (child.isDirectory()) files.push(...await contractIdentityFiles(name));
    else { assert(child.isFile(), `contract identity contains a non-regular file: ${name}`); files.push(name); }
  }
  return files;
}
const contractIdentityPaths = (await Promise.all(CONTRACT_IDENTITY_ENTRIES.map(contractIdentityFiles))).flat().sort();
const packedContractIdentityPaths = [...packedPaths].filter((entry) => CONTRACT_IDENTITY_ENTRIES.some((root) => entry === root || entry.startsWith(`${root}/`))).sort();
assert(JSON.stringify(packedContractIdentityPaths) === JSON.stringify(contractIdentityPaths), 'packed contract release identity entries must match disk exactly');

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
  rootPackageJson.peerDependencies?.['@zudo-composer/component-contract'] === '^1.0.0',
  'the contract must be a 1.x peer, supplied by the host from the exact handoff or a packed artifact',
);
assert(rootPackageJson.dependencies?.['@zudo-sg/ui'] === undefined, 'the demo provider must not be a runtime dependency');
assert(rootPackageJson.devDependencies?.['@zudo-sg/ui'] !== undefined, 'the demo provider must remain a development dependency');

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
  './config': { types: './server/config-public.d.mts', default: './server/config/define.mjs' },
  './vite': { types: './server/vite.d.mts', default: './plugins/index.mjs' },
  './authoring': { types: './server/authoring.d.mts', default: './server/authoring.mjs' },
  './site-build': { types: './server/site-build.d.mts', default: './server/site-build.mjs' },
  './site-project': { types: './server/site-project.d.mts' },
  './styles': './src/style.css',
  './package.json': './package.json',
};
assert(JSON.stringify(rootPackageJson.exports) === JSON.stringify(expectedRootExports), 'the root package exports map changed');

/** @type {PackMetadata | undefined} */
let rootPackedMetadata;
try {
  const result = await execFile(pnpmExecutable, ['pack', '--dry-run', '--json'], { cwd: repositoryRoot, maxBuffer: 32 * 1024 * 1024 });
  rootPackedMetadata = parsePackJson(result.stdout);
} catch (error) {
  fail(`root pnpm pack conformance check failed: ${error instanceof Error ? error.message : String(error)}`);
}
const rootPackedPaths = new Set((rootPackedMetadata.files ?? []).map((entry) => entry.path));

assertPackedConsumerBoundary(rootPackedPaths, repositoryRoot);

// Every `exports` and `bin` target, resolved against what actually ships.
const exportTargets = Object.values(expectedRootExports).flatMap((entry) => (typeof entry === 'string' ? [entry] : Object.values(entry)));
for (const target of [...exportTargets, rootPackageJson.bin['zudo-composer']]) {
  assert(rootPackedPaths.has(target.replace(/^\.\//u, '')), `packed archive omits the declared entry point ${target}`);
}

// Sources the launcher loads, plus the inputs release identity is derived from.
for (const required of [
  'index.html',
  'contract-handoff.json',
  'src/main.tsx',
  'src/App.tsx',
  'server/cli/run.mjs',
  'server/cli/release-entry.mjs',
  'server/cli/build-site-entry.mjs',
  'server/cli/generate-entry.mjs',
  'server/cli/generate.ts',
  'server/cli/init-entry.mjs',
  'server/creator/init.mjs',
  'server/creator/project.mjs',
  'server/cli/run.d.mts',
  'server/module-evaluator.mjs',
  'server/config/index.ts',
  'server/site-project-local/toolchain-config.ts',
  'server/site-project-local/contract-entries.mjs',
  'server/host-context.mjs',
  'server/public/authoring.mts',
  'server/public/site-build.mts',
  'server/public/site-project.mts',
  'server/public/vite.mts',
  'server/public/config.mts',
  'server/site-build/compile.ts',
  'server/site-build/artifact.mjs',
  'server/site-build/assets.ts',
  'server/site-build/vite-config.ts',
  'server/site-build/run.mjs',
  'server/site-build/run.d.mts',
  'server/site-build/source-revision.mjs',
  'server/site-build/source-revision.d.mts',
  'server/site-build/print-routes.ts',
  'server/site-build/client/main.tsx',
  'server/site-build/client/styles.css',
  'server/site-build/client/site-static-project.d.ts',
  'plugins/component-pack.mjs',
  'plugins/component-pack-plugin.mjs',
  'plugins/host-styles-plugin.mjs',
  'plugins/roots.mjs',
  'plugins/composer-app-html.mjs',
  'templates/host/components/pack.ts',
  'templates/host/components/page.tsx',
  'templates/host/styles/base.css',
  'templates/host/site-project.ts',
  'templates/host/images-src/manifest.json',
  'templates/host/images-src/starter.png',
  'templates/host/tests/starter.spec.tsx',
  'templates/host/README.md',
]) {
  assert(rootPackedPaths.has(required), `packed archive omits the runtime file ${required}`);
}

for (const packed of rootPackedPaths) {
  assert(!packed.startsWith('packages/component-contract/'), `packed tool must use its contract peer: ${packed}`);
  assert(!/(?:^|\/)__tests__\//u.test(packed), `packed archive exposes a test directory: ${packed}`);
  assert(!/(?:^|\/)type-tests\//u.test(packed), `packed archive exposes type tests: ${packed}`);
  assert(!/(?:^|\/)test-support\//u.test(packed), `packed archive exposes test support: ${packed}`);
  assert(!/\.test\./u.test(packed), `packed archive exposes a test file: ${packed}`);
  assert(!packed.startsWith('src/test/'), `packed archive exposes test helpers: ${packed}`);
  assert(!packed.startsWith('tests/'), `packed archive exposes browser tests: ${packed}`);
  assert(!/^playwright[.a-z-]*\.config\.ts$/u.test(packed), `packed archive exposes Playwright configuration: ${packed}`);
  assert(!packed.startsWith('scripts/'), `packed archive exposes repository scripts: ${packed}`);
}

console.log(`Package conformance passed: ${rootPackageJson.name} (${rootPackedPaths.size} packed files)`);

// Nested private package manifests disable parent negations: allowlist each runtime file.
/** @param {string} directory @returns {Promise<string[]>} */
async function editorRuntimeSources(directory) {
 const result = [];
 for (const entry of await readdir(path.join(repositoryRoot, directory), {withFileTypes:true})) {
  if (entry.name === '__tests__' || entry.name === 'type-tests') continue;
  const name = `${directory}/${entry.name}`;
  if (entry.isDirectory()) result.push(...await editorRuntimeSources(name));
  else if (/\.(?:ts|tsx|css)$/u.test(name) && !/\.(?:test|spec)\./u.test(name)) result.push(name);
 }
 return result.sort();
}
const editorSources = await editorRuntimeSources('packages/image-editor/src');
const packedEditorSources = [...rootPackedPaths].filter(name => name.startsWith('packages/image-editor/')).sort();
assert(JSON.stringify(editorSources) === JSON.stringify(packedEditorSources), 'packed editor runtime sources must match disk exactly and omit tests and manifest');
assert(editorSources.every(name => rootPackageJson.files.includes(name)), 'editor runtime sources must be individually allowlisted');
assert(rootPackageJson.devDependencies?.['@zudo-composer/image-editor'] === 'workspace:*', 'private editor must be a workspace devDependency');
assert(!rootPackageJson.dependencies?.['@zudo-composer/image-editor'] && !rootPackageJson.peerDependencies?.['@zudo-composer/image-editor'], 'private editor must not be a runtime dependency');

// File-list checks cannot prove a Node import graph. Exercise the public APIs
// and declarations from tarballs in a host outside this workspace as well.
try {
  const result = await execFile(process.execPath, [path.join(repositoryRoot, 'scripts/verify-public-install.mjs')], { cwd: repositoryRoot, maxBuffer: 16 * 1024 * 1024 });
  console.log(result.stdout.trim());
} catch (error) {
  fail(`packed public entry proof failed: ${error instanceof Error ? error.message : String(error)}`);
}
