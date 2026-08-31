import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const roots = ['src/shared', 'src/composer', 'src/content', 'src/mapping', 'src/site-project', 'plugins'].map((entry) => path.join(repositoryRoot, entry));
const files = [];
const violations = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'test' || entry.name === 'tests') continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(target);
    else if (/\.(?:mjs|mts|ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) files.push(target);
  }
}

for (const root of roots) await walk(root);
files.push(path.join(repositoryRoot, 'package.json'), path.join(repositoryRoot, 'vite.config.ts'));

const forbidden = [
  ['provider application coupling', /@zudo-sg\/ui|zudo-doc|@takazudo\/zfb|\bzfb\b/i],
  ['application alias', /(?:from|import\()\s*["']@\//],
  ['removed source adapter', /sourceAdapters?|JsxSourceAdapter/],
  ['removed schema compatibility', /COMPOSITION_SCHEMA_V1|decodedFromSchemaVersion|MigrationMeta|CleanupMeta|localStorage/i],
  ['headless Preact dependency', /(?:^|\n)\s*import\s+(?:type\s+)?(?:[^;\n]+?\s+from\s+)?["']preact(?:\/|["'])/],
  ['application-layer dependency', /(?:from|import\()\s*["'][^"']*(?:features|src\/app|\/app\/)[^"']*["']/],
];

for (const file of files) {
  const content = await readFile(file, 'utf8');
  for (const [rule, pattern] of forbidden) {
    const isRootConfig = file === path.join(repositoryRoot, 'package.json') || file === path.join(repositoryRoot, 'vite.config.ts');
    const applicablePattern = rule === 'provider application coupling' && isRootConfig
      // The standalone application intentionally installs its injected UI pack;
      // headless isolation is enforced against src/composer, src/shared, and plugins.
      ? /zudo-doc|@takazudo\/zfb(?!-md-wasm)|\bzfb\b(?!-md-wasm)/i
      : pattern;
    if (applicablePattern.test(content)) violations.push(`${path.relative(repositoryRoot, file)}: ${rule}`);
  }
}

const indexedDbTypes = await readFile(path.join(repositoryRoot, 'src/composer/storage/indexeddb/types.ts'), 'utf8');
if (!indexedDbTypes.includes('COMPOSER_DATABASE_NAME = "zudo-composer"')) {
  violations.push('src/composer/storage/indexeddb/types.ts: current database identity');
}
if (!indexedDbTypes.includes('COMPOSER_DATABASE_VERSION = 1')) {
  violations.push('src/composer/storage/indexeddb/types.ts: clean physical database version');
}

// Mapping is allowed to consume only the pure catalog/model seams required to
// resolve provider-qualified Content and Composition references.
const mappingImports = files.filter((file) => file.includes(`${path.sep}src${path.sep}mapping${path.sep}`));
const contentAndMapping = files.filter((file) => file.includes(`${path.sep}src${path.sep}content${path.sep}`) || file.includes(`${path.sep}src${path.sep}mapping${path.sep}`) || file.includes(`${path.sep}src${path.sep}site-project${path.sep}`));
for (const file of contentAndMapping) {
  const content = await readFile(file, 'utf8');
  if (/\b(?:window|localStorage)\b|globalThis\.document|\bHTMLElement\b/.test(content)) violations.push(`${path.relative(repositoryRoot, file)}: headless DOM dependency`);
  if (/\b(?:legacy|migration|migrate|compatibility shim|fallback registry)\b/i.test(content)) violations.push(`${path.relative(repositoryRoot, file)}: legacy or migration compatibility`);
  if (file.includes(`${path.sep}src${path.sep}site-project${path.sep}`) && /(?:from|import\()\s*["'](?:node:)?(?:fs|path|os|url|child_process)["']/.test(content)) {
    violations.push(`${path.relative(repositoryRoot, file)}: headless Node dependency`);
  }
}
for (const file of mappingImports) {
  const content = await readFile(file, 'utf8');
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
