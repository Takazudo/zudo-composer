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
