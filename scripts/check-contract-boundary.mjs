import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const packageRoot = path.join(repositoryRoot, 'packages', 'component-contract');
const textExtensions = new Set(['.json', '.md', '.mjs', '.ts', '.tsx', '.yaml', '.yml', '.npmrc']);
const violations = [];

function record(file, rule, detail) {
  violations.push(`${path.relative(repositoryRoot, file)}: ${rule} (${detail})`);
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'dist' || entry.name === 'node_modules') continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(file);
      continue;
    }
    if (textExtensions.has(path.extname(entry.name)) || entry.name === '.npmrc') {
      const content = await readFile(file, 'utf8');
      scan(file, content);
    }
  }
}

function scan(file, content) {
  const forbiddenHandoff = [
    ['workspace protocol', /workspace:/i],
    ['file protocol', /file:/i],
    ['link protocol', /link:/i],
    ['sibling repository path', /(?:^|[\\/'"`])\.\.(?:[\\/]|$)/],
    ['workspace-root preparation', /pnpm\s+(?:--workspace-root|-w\b|--filter\b)/i],
    ['recursive preparation', /pnpm\s+(?:-r\b|recursive\b)/i],
    ['explicit install preparation', /(?:pnpm|npm)\s+install\b/i],
    ['parent-directory preparation', /(?:pnpm|npm)\s+(?:[^\n]*\s)?(?:-C|--dir|--prefix)\s+\.\./i],
  ];
  for (const [rule, pattern] of forbiddenHandoff) {
    if (pattern.test(content)) record(file, rule, 'external package handoff must be self-contained');
  }

  for (const name of ['StoryMeta', 'zudo-sg', 'zudo-doc', 'zfb']) {
    if (new RegExp(`\\b${name}\\b`, 'i').test(content)) {
      record(file, 'application dependency', `${name} is not allowed in generic contract code`);
    }
  }
}

await walk(packageRoot);

if (violations.length > 0) {
  console.error('Contract boundary scan failed:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log('Contract boundary scan passed: no workspace/file/link/sibling/root-workspace/application dependencies found.');
}
