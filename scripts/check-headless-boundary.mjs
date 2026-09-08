import { boundarySource } from './boundary-source.mjs';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const roots = ['src/shared', 'src/composer', 'src/content', 'src/media', 'src/mapping', 'src/site-project', 'plugins'].map((entry) => path.join(repositoryRoot, entry));
const files = [];
const violations = [];

async function walk(directory, collected = files) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'test' || entry.name === 'tests') continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(target, collected);
    else if (/\.(?:mjs|mts|ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) collected.push(target);
  }
}

for (const root of roots) await walk(root);
files.push(path.join(repositoryRoot, 'package.json'), path.join(repositoryRoot, 'vite.config.ts'));

const forbidden = [
  ['provider application coupling', /@zudo-sg\/ui|zudo-doc|@takazudo\/zfb|\bzfb\b/i],
  ['application alias', /(?:from|import\()\s*["']@\//],
  ['removed source adapter', /sourceAdapters?|JsxSourceAdapter/],
  ['removed schema compatibility', /COMPOSITION_SCHEMA_V1|decodedFromSchemaVersion|MigrationMeta|CleanupMeta|\blocalStorage\b/i],
  ['headless Preact dependency', /(?:^|\n)\s*import\s+(?:type\s+)?(?:[^;\n]+?\s+from\s+)?["']preact(?:\/|["'])/],
  ['application-layer dependency', /(?:from|import\()\s*["'][^"']*(?:features|src\/app|\/app\/)[^"']*["']/],
];

for (const file of files) {
  const source = await readFile(file, 'utf8');
  const content = boundarySource(source, { fileName: file });
  const code = boundarySource(source, { fileName: file, strings: false });
  for (const [rule, pattern] of forbidden) {
    const isRootConfig = file === path.join(repositoryRoot, 'package.json') || file === path.join(repositoryRoot, 'vite.config.ts');
    const applicablePattern = rule === 'provider application coupling' && isRootConfig
      // The standalone application intentionally installs its injected UI pack;
      // headless isolation is enforced against the production-domain roots above.
      ? /zudo-doc|@takazudo\/zfb(?!-md-wasm)|\bzfb\b(?!-md-wasm)/i
      : pattern;
    if (applicablePattern.test(['removed source adapter', 'removed schema compatibility'].includes(rule) ? code : content)) violations.push(`${path.relative(repositoryRoot, file)}: ${rule}`);
  }
}

// Persistence never touches browser storage. Authored data, workspace snapshots,
// preconditions and digests live in project files behind the file-provider
// protocol; `localStorage` is permitted only for the per-browser UI preferences
// inventoried in `docs/workspace-design.md`, none of which live under these
// paths. IndexedDB is gone entirely, so its globals are forbidden outright.
const BROWSER_STORAGE = /\b(?:localStorage|sessionStorage|indexedDB|IDBDatabase|IDBFactory|IDBOpenDBRequest|IDBTransaction)\b/;
const persistenceRoots = [
  'src/composer/storage', 'src/content/storage', 'src/mapping/storage', 'src/sitemapper/storage', 'src/media/storage',
  'src/site-project', 'src/features/release', 'src/shared', 'server', 'plugins',
];
const persistenceFiles = [
  'src/app/workspace-storage.ts', 'src/app/workspace-seeding.ts', 'src/app/workspace-snapshot.ts', 'src/app/provider-integration.ts',
];
const persistenceScanned = [];
for (const root of persistenceRoots) {
  const target = path.join(repositoryRoot, root);
  // #265/#266 removed some of these trees; a path that no longer exists is not a violation.
  if (!existsSync(target)) continue;
  await walk(target, persistenceScanned);
}
for (const file of persistenceFiles) {
  const target = path.join(repositoryRoot, file);
  if (existsSync(target)) persistenceScanned.push(target);
}
for (const file of persistenceScanned) {
  if (BROWSER_STORAGE.test(boundarySource(await readFile(file, 'utf8'), { fileName: file, strings: false }))) {
    violations.push(`${path.relative(repositoryRoot, file)}: browser storage in a persistence layer`);
  }
}

// Mapping is allowed to consume only the pure catalog/model seams required to
// resolve provider-qualified Content and Composition references.
const mappingImports = files.filter((file) => file.includes(`${path.sep}src${path.sep}mapping${path.sep}`));
const contentAndMapping = files.filter((file) => file.includes(`${path.sep}src${path.sep}content${path.sep}`) || file.includes(`${path.sep}src${path.sep}mapping${path.sep}`) || file.includes(`${path.sep}src${path.sep}site-project${path.sep}`));
for (const file of contentAndMapping) {
  const source = await readFile(file, 'utf8');
  const content = boundarySource(source, { fileName: file });
  const code = boundarySource(source, { fileName: file, strings: false });
  if (/\b(?:window|localStorage)\b|globalThis\.document|\bHTMLElement\b/.test(code)) violations.push(`${path.relative(repositoryRoot, file)}: headless DOM dependency`);
  if (/\b(?:legacy|migration|migrate|compatibility shim|fallback registry)\b/i.test(code)) violations.push(`${path.relative(repositoryRoot, file)}: legacy or migration compatibility`);
  if (file.includes(`${path.sep}src${path.sep}site-project${path.sep}`) && /(?:from|import\()\s*["'](?:node:)?(?:fs|path|os|url|child_process)["']/.test(content)) {
    violations.push(`${path.relative(repositoryRoot, file)}: headless Node dependency`);
  }
}
for (const file of mappingImports) {
  const content = boundarySource(await readFile(file, 'utf8'), { fileName: file });
  for (const match of content.matchAll(/from\s+["'](\.\.\/\.\.\/(?:content|composer)\/[^"']+)["']/g)) {
    if (!/(?:content\/(?:catalog|model)|composer\/(?:library|model))/.test(match[1])) violations.push(`${path.relative(repositoryRoot, file)}: undocumented cross-domain seam ${match[1]}`);
  }
}

if (violations.length > 0) {
  console.error('Headless production boundary scan failed:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log('Headless production boundary scan passed.');
}
