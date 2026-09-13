// @vitest-environment node

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkConsumerLedger, discoverConsumerHosts, scanConsumerHost } from '../check-consumer-boundary.mjs';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const scanner = join(repositoryRoot, 'scripts/check-consumer-boundary.mjs');
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture(manifest: Record<string, unknown> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'consumer-boundary-'));
  roots.push(root);
  const hostRoot = join(root, 'packages/demo-example');
  function write(file: string, content: string, directory = hostRoot) {
    const target = join(directory, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  write('package.json', JSON.stringify({ name: 'demo-example', type: 'module', ...manifest }));
  const scan = () => scanConsumerHost({ root, hostRoot });
  const ledgerFile = join(root, 'ledger.json');
  function cli(ledger: unknown = [], args: string[] = []) {
    writeFileSync(ledgerFile, JSON.stringify(ledger));
    return spawnSync(process.execPath, [scanner, '--root', root, '--ledger', ledgerFile, ...args], { encoding: 'utf8', cwd: tmpdir(), timeout: 15_000 });
  }
  return { root, hostRoot, write, scan, cli };
}

describe('consumer boundary import direction', () => {
  it('admits host-local paths, declared dependencies, builtins and package self-references', () => {
    const host = fixture({ dependencies: { preact: '1', '@scope/pack': '1', 'zudo-composer': '1', '@types/node': '1' }, imports: { '#local': './components/pack.ts' } });
    host.write('src/entry.mts', `
      import 'node:path'; import { readFile } from 'fs/promises';
      import 'preact/hooks'; export * from '@scope/pack/components';
      import 'zudo-composer/site-project'; import 'demo-example/components'; import '#local';
      import '../components/pack'; export * from './nested/../local.ts';
      const local = await import('../components/pack');
      const worker = new URL('../worker.ts', import.meta.url);
      // import '../../../src/private.ts'; pnpm -w test; file:../tool
      const prose = 'An import from ../../../src is forbidden';
    `);
    host.write('styles/base.css', `/* @import '../../../src/hidden.css'; */
      @import 'tailwindcss/preflight'; @reference 'tailwindcss/utilities';
      @import '@scope/pack/styles.css'; @source '../components';
    `);
    host.write('images-src/manifest.json', '[{"file":"example.webp"}]');
    host.write('env.d.ts', '/// <reference types="node" />');
    expect(host.scan()).toEqual([]);
  });

  it.each([
    `import '../../../src/private.ts';`,
    `import type { Record } from '../../../src/private';`,
    `export { value } from '../../../scripts/build';`,
    `export * from '../../../fixtures/shared';`,
    `import value = require('../../../src/private');`,
    `type Record = import('../../../src/private').Record;`,
    `await import('../../../src/' + 'private');`,
    'await import(`../../../${"src"}/private`);',
    `require('../../../src/private');`,
    `module.require('../../../src/private');`,
    `require.resolve('../../../src/private');`,
    `import.meta.resolve('../../../src/private');`,
    `import.meta.glob(['./*.ts', '../../../src/*.ts']);`,
    `import { createRequire as create } from 'node:module'; const load = create(import.meta.url); load('../../../src/private');`,
    `import { createRequire } from 'node:module'; createRequire(import.meta.url).resolve('../../../src/private');`,
    `import * as module from 'node:module'; const load = module.createRequire(import.meta.url); load('../../../src/private');`,
    String.raw`import '\x2e\x2e/../../../src/private';`,
    `import '%2e%2e/%2e%2e/%2e%2e/src/private?raw';`,
    String.raw`import '..\\..\\..\\src\\private';`,
  ])('rejects source reach-back: %s', (source) => {
    const host = fixture();
    host.write('src/entry.ts', source);
    expect(host.scan()).toEqual(expect.arrayContaining([expect.objectContaining({ rule: 'outside-host-import' })]));
  });

  it('does not confuse an adjacent package whose name begins with the host name for host-local source', () => {
    const host = fixture();
    host.write('entry.ts', `import '../demo-example-extra/src';`);
    expect(host.scan()).toEqual([expect.objectContaining({ rule: 'outside-host-import' })]);
  });

  it('fails closed on imports and resolutions whose targets cannot be determined statically', () => {
    const host = fixture();
    host.write('entry.ts', 'const target = getTarget(); import(target); require(target); import.meta.resolve(target);');
    expect(host.scan()).toHaveLength(3);
    expect(host.scan().every((entry) => entry.rule === 'computed-import')).toBe(true);
  });

  it('checks JSDoc dependency imports while ignoring comment prose', () => {
    const host = fixture();
    host.write('entry.js', `
      /** @type {import('../../src/private').Record} */ let value;
      /** @import { Record } from 'undeclared' */
      const record = {};
      /** Prose can describe pnpm -w, file:../tool, and imports from ../../src. */
      export const local = true;
    `);
    expect(host.scan()).toEqual([
      expect.objectContaining({ rule: 'outside-host-import', count: 1 }),
      expect.objectContaining({ rule: 'undeclared-package', count: 1 }),
    ]);
  });

  it.each(['vitest', '@testing-library/preact', 'undeclared/subpath', 'tailwindcss/preflight', 'virtual:root-only', '#missing'])('rejects undeclared JS package %s even if the root declares it', (specifier) => {
    const host = fixture();
    host.write('package.json', JSON.stringify({ dependencies: { [specifier]: '1' } }), host.root);
    host.write('entry.ts', `import '${specifier}';`);
    expect(host.scan()).toEqual([expect.objectContaining({ rule: 'undeclared-package' })]);
  });

  it.each(['scripts/private', 'src/private', 'fixtures/private', 'packages/private', 'zudo-composer/src/private', 'zudo-composer/scripts/private', '@scope/pack/../../src'])('rejects repository-only import %s even when its package is declared', (specifier) => {
    const host = fixture({ dependencies: { scripts: '1', src: '1', fixtures: '1', packages: '1', 'zudo-composer': '1', '@scope/pack': '1' } });
    host.write('entry.ts', `import '${specifier}';`);
    expect(host.scan()).toEqual([expect.objectContaining({ rule: 'repository-import' })]);
  });

  it('rejects CSS dependencies, config aliases and file URLs reaching beyond the host', () => {
    const host = fixture({ imports: { '#private': '../../src/private.ts' } });
    host.write('styles/base.css', `@import url(../../../src/private.css); @import 'unknown/styles'; @source '../../../src';`);
    host.write('tsconfig.json', '{/* keep JSONC support */ "extends": "../../tsconfig.json", "compilerOptions": {"paths": {"root/*": ["../../src/*"]}}}');
    host.write('entry.ts', `const asset = new URL('../../fixtures/data.json', import.meta.url);`);
    expect(host.scan().map((entry) => entry.rule)).toEqual(expect.arrayContaining(['outside-host-import', 'undeclared-package', 'outside-host-path']));
    expect(host.scan().filter((entry) => entry.rule === 'outside-host-path')).toHaveLength(4);
  });

  it('keeps the Tailwind allowance limited to public CSS imports and requires other CSS packages', () => {
    const host = fixture();
    host.write('style.css', `@import 'tailwindcss/preflight'; @reference 'tailwindcss/utilities'; @plugin 'tailwindcss/private'; @import 'unknown/styles';`);
    expect(host.scan()).toEqual([
      expect.objectContaining({ detail: '@import: unknown/styles', rule: 'undeclared-package' }),
      expect.objectContaining({ detail: '@plugin: tailwindcss/private', rule: 'undeclared-package' }),
    ]);
  });

  it('checks declared component-pack specifiers in host config', () => {
    const host = fixture({ dependencies: { 'zudo-composer': '1' } });
    host.write('zudo-composer.config.ts', `import { defineComposerConfig } from 'zudo-composer/config'; export default defineComposerConfig({ pack: '@scope/missing/pack' });`);
    expect(host.scan()).toEqual([expect.objectContaining({ detail: 'component pack: @scope/missing/pack' })]);
  });

  it('rejects escaping symlinks while keeping an installed package CSS source independent of pnpm link layout', () => {
    const host = fixture({ dependencies: { '@scope/pack': '1' } });
    host.write('shared/pack/src/index.ts', '', host.root);
    host.write('style.css', `@source './node_modules/@scope/pack/src';`);
    const beforeInstall = host.scan();
    mkdirSync(join(host.hostRoot, 'node_modules/@scope'), { recursive: true });
    symlinkSync(join(host.root, 'shared/pack'), join(host.hostRoot, 'node_modules/@scope/pack'), 'dir');
    expect(beforeInstall).toEqual([]);
    expect(host.scan()).toEqual(beforeInstall);
    symlinkSync(join(host.root, 'shared/pack'), join(host.hostRoot, 'linked-source'), 'dir');
    host.write('entry.ts', `import './linked-source/src/index';`);
    expect(host.scan().map((entry) => entry.rule)).toEqual(['outside-host-import', 'outside-host-symlink']);
  });

  it('rejects undeclared packages reached through CSS source paths', () => {
    const host = fixture();
    host.write('style.css', `@source './node_modules/@scope/undeclared/src';`);
    expect(host.scan()).toEqual([expect.objectContaining({ rule: 'undeclared-package' })]);
  });
});

describe('consumer boundary protocols and commands', () => {
  it('admits verified first-party workspace dependencies only for in-repository authoring', () => {
    const host = fixture({ devDependencies: { 'zudo-composer': 'workspace:*', '@zudo-composer/component-contract': 'workspace:*' } });
    host.write('package.json', '{"name":"zudo-composer"}', host.root);
    host.write('packages/component-contract/package.json', '{"name":"@zudo-composer/component-contract"}', host.root);
    host.write('entry.ts', "import 'zudo-composer/authoring';");
    expect(host.scan()).toEqual([]);

    // The identical manifest is not an installable external/generated host.
    expect(scanConsumerHost({ root: host.hostRoot, hostRoot: '.' }).filter((entry) => entry.rule === 'dependency-protocol')).toHaveLength(2);
    host.write('entry.ts', "import 'workspace:*'; import '../../../src/private';");
    expect(host.scan().map((entry) => entry.rule)).toEqual(expect.arrayContaining(['dependency-protocol', 'outside-host-import']));
  });

  it('requires the actual first-party package identity and never accepts the provider as a workspace', () => {
    const host = fixture({ dependencies: { '@zudo-composer/component-contract': 'workspace:*', '@zudo-sg/ui': 'workspace:*' } });
    host.write('package.json', '{"name":"zudo-composer"}', host.root);
    expect(host.scan()).toHaveLength(2);
    host.write('packages/component-contract/package.json', '{"name":"wrong-package"}', host.root);
    expect(host.scan()).toHaveLength(2);
    host.write('packages/component-contract/package.json', '{"name":"@zudo-composer/component-contract"}', host.root);
    expect(host.scan()).toEqual([expect.objectContaining({ detail: 'dependencies.@zudo-sg/ui: workspace:*' })]);
    host.write('package.json', '{"name":"consumer"}', host.root);
    expect(host.scan()).toHaveLength(2);
  });

  it('does not extend the authoring allowance to alternate protocols, overrides or nested manifests', () => {
    const host = fixture({ dependencies: { 'zudo-composer': 'workspace:^', '@zudo-composer/component-contract': 'file:../component-contract' }, pnpm: { overrides: { 'zudo-composer': 'workspace:*' } } });
    host.write('package.json', '{"name":"zudo-composer"}', host.root);
    host.write('nested/package.json', '{"dependencies":{"zudo-composer":"workspace:*"}}');
    expect(host.scan().filter((entry) => entry.rule === 'dependency-protocol')).toHaveLength(4);
  });

  it('does not trust a first-party package manifest linked outside the repository', () => {
    const host = fixture({ dependencies: { '@zudo-composer/component-contract': 'workspace:*' } });
    const external = fixture();
    host.write('package.json', '{"name":"zudo-composer"}', host.root);
    external.write('contract.json', '{"name":"@zudo-composer/component-contract"}', external.root);
    mkdirSync(join(host.root, 'packages/component-contract'), { recursive: true });
    symlinkSync(join(external.root, 'contract.json'), join(host.root, 'packages/component-contract/package.json'));
    expect(host.scan()).toEqual([expect.objectContaining({ rule: 'dependency-protocol' })]);
  });

  it.each(['workspace:*', 'file:../../tool', 'link:../tool'])('rejects dependency protocol %s in every manifest dependency section', (value) => {
    for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      const host = fixture({ [section]: { 'new-package': value } });
      expect(host.scan()).toEqual([expect.objectContaining({ rule: 'dependency-protocol', detail: `${section}.new-package: ${value}` })]);
    }
  });

  it('also scans pnpm overrides, npmrc, dependency URLs in source and install commands', () => {
    const host = fixture({ pnpm: { overrides: { library: 'file:../library' } }, scripts: { add: 'pnpm add workspace:*' } });
    host.write('.npmrc', 'registry=file:../private\n');
    host.write('entry.ts', `import 'file:../../../src/private.ts'; new URL('file:///repository/private', import.meta.url);`);
    expect(host.scan()).toHaveLength(5);
    expect(host.scan().every((entry) => entry.rule === 'dependency-protocol')).toBe(true);
  });

  it.each([
    'pnpm -w test', 'corepack pnpm --workspace-root test', 'pnpm --filter demo-example test',
    'pnpm --filter=demo-example test', 'pnpm --filter-prod demo-example test', 'pnpm --silent -w test',
    'pnpm -rw test', 'pnpm run test --workspace-root', 'pnpm test && pnpm -w build',
    'pnpm \\\n --filter demo-example test', '/usr/local/bin/pnpm --workspace-root test',
  ])('rejects root workspace command %s', (command) => {
    const host = fixture({ scripts: { test: command } });
    expect(host.scan()).toEqual([expect.objectContaining({ rule: 'workspace-command' })]);
  });

  it('catches shell scripts, documented commands and child-process argument arrays', () => {
    const host = fixture();
    host.write('run.sh', '#!/bin/sh\ncorepack pnpm --workspace-root test\n');
    host.write('README.md', '```sh\npnpm --filter demo-example test\n```\n```ts\nimport "../../scripts/root-only";\n```');
    host.write('run.mjs', `import { spawn as launch } from 'node:child_process'; launch('corepack', ['pnpm', '--workspace-root', 'test']);`);
    expect(host.scan().filter((entry) => entry.rule === 'workspace-command')).toHaveLength(3);
    expect(host.scan()).toEqual(expect.arrayContaining([expect.objectContaining({ file: 'README.md', rule: 'outside-host-import' })]));
  });

  it('checks shell command strings and counts a protocol argument only once', () => {
    const host = fixture();
    host.write('run.mjs', `import { execSync, spawn } from 'node:child_process'; execSync('node ../../scripts/private.mjs'); spawn('pnpm', ['add', 'file:../tool']);`);
    expect(host.scan()).toEqual([
      expect.objectContaining({ rule: 'dependency-protocol', count: 1 }),
      expect.objectContaining({ rule: 'outside-host-path', count: 1 }),
    ]);
  });

  it('permits local commands and forwarded flags, while rejecting parent-directory commands', () => {
    const host = fixture({ scripts: { test: 'pnpm test -- -w --filter=local', local: 'pnpm --dir ./src test', bad: 'node ../../scripts/run.mjs' } });
    host.write('run.sh', '# pnpm -w is forbidden\npnpm test\n');
    expect(host.scan()).toEqual([expect.objectContaining({ rule: 'outside-host-path', detail: 'scripts.bad: ../../scripts/run.mjs' })]);
  });

  it('rejects absolute workspace-directory overrides without confusing a system executable for a host path', () => {
    const host = fixture({ scripts: { bad: 'pnpm --dir /repository test', alsoBad: 'cd /repository && pnpm test', good: '/usr/bin/node ./run.mjs' } });
    expect(host.scan()).toHaveLength(2);
    expect(host.scan().every((entry) => entry.rule === 'outside-host-path')).toBe(true);
  });
});

describe('consumer boundary ledger and CLI', () => {
  it('requires zero violations and refuses even an exactly matching former ledger entry', () => {
    const host = fixture();
    host.write('entry.ts', `import '../../src/private';`);
    const ledger = host.scan().map((entry) => ({ ...entry, issue: 551 }));
    expect(checkConsumerLedger(host.scan(), [])).toMatchObject({ ok: false, unexpected: host.scan(), remaining: 0 });
    expect(host.cli().status).toBe(1);
    expect(host.cli().stderr).toContain('NEW packages/demo-example/entry.ts');
    expect(() => checkConsumerLedger(host.scan(), ledger)).toThrow('must be empty');
    expect(host.cli(ledger).stderr).toContain('must be empty');
    host.write('entry.ts', 'export const local = true;');
    expect(host.cli(ledger).status).toBe(1);
    const clean = host.cli();
    expect(clean.status).toBe(0);
    expect(clean.stdout).toContain('zero violations and an empty ledger');
  });

  it.each([{}, null, [{}], [false]])('rejects a malformed or nonempty ledger: %j', (ledger) => {
    expect(() => checkConsumerLedger([], ledger)).toThrow();
  });

  it('discovers all fixture and future host packages independently of workspace membership', () => {
    const host = fixture();
    for (const directory of ['fixtures/self-host', 'packages/demo-studio', 'packages/custom-host', 'fixtures/configured']) {
      host.write('package.json', JSON.stringify({ name: directory, ...(directory.endsWith('custom-host') ? { dependencies: { 'zudo-composer': '1' } } : {}) }), join(host.root, directory));
      if (directory.startsWith('fixtures/')) host.write('zudo-composer.config.ts', 'export default {};', join(host.root, directory));
    }
    host.write('package.json', '{"name":"internal-library"}', join(host.root, 'packages/internal-library'));
    expect(discoverConsumerHosts(host.root)).toHaveLength(5);
    host.write('entry.ts', `import '../../src/private';`, join(host.root, 'packages/demo-studio'));
    expect(host.cli().stderr).toContain('NEW packages/demo-studio/entry.ts');
    expect(host.cli([], ['--host', host.hostRoot]).status).toBe(0);
    rmSync(join(host.hostRoot, 'package.json'));
    expect(host.cli().status).toBe(1);
    expect(discoverConsumerHosts(host.root)).toContain(host.hostRoot);
  });

  it('rejects missing hosts and unknown or duplicate CLI arguments', () => {
    const host = fixture();
    expect(host.cli([], ['--wrong', 'argument']).status).toBe(1);
    expect(host.cli([], ['--host', host.hostRoot, '--host', host.hostRoot]).stderr).toContain('duplicate hosts');
    rmSync(join(host.root, 'packages'), { recursive: true });
    expect(host.cli().stderr).toContain('found no hosts');
  });

  it('matches the committed ledger, scans the demos and fixtures, and is included in check', () => {
    const hosts = discoverConsumerHosts(repositoryRoot);
    expect(hosts.map((host) => host.slice(repositoryRoot.length + 1))).toEqual(expect.arrayContaining(['fixtures/self-host', 'fixtures/host', 'fixtures/themeset-host', 'packages/demo-blog', 'packages/demo-landing', 'packages/demo-studio', 'packages/demo-webshop']));
    const actual = hosts.flatMap((hostRoot) => scanConsumerHost({ root: repositoryRoot, hostRoot }));
    const ledger: unknown = JSON.parse(readFileSync(join(repositoryRoot, 'scripts/consumer-boundary-ledger.json'), 'utf8'));
    expect(ledger).toEqual([]);
    expect(actual).toEqual([]);
    expect(checkConsumerLedger(actual, ledger).ok).toBe(true);
    const manifest = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(manifest.scripts['consumer:boundary']).toBe('node scripts/check-consumer-boundary.mjs && node scripts/check-creator.mjs');
    expect(manifest.scripts.check.split(' && ')).toContain('pnpm consumer:boundary');
  });

  it('preserves the independent contract-only negative scan and its strict rules', () => {
    const host = fixture();
    host.write('package.json', '{"name":"contract"}', join(host.root, 'packages/component-contract'));
    mkdirSync(join(host.root, 'scripts'));
    const script = join(host.root, 'scripts/check-contract-boundary.mjs');
    copyFileSync(join(repositoryRoot, 'scripts/check-contract-boundary.mjs'), script);
    const run = () => spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 15_000 });
    host.write('bad.ts', `import '../../src/private';`);
    expect(run().status).toBe(0);
    for (const violation of ['workspace:*', 'file:../other', 'link:../other', 'pnpm -w test', 'pnpm -r build', 'pnpm install', 'zudo-doc', 'import "../sibling"']) {
      host.write('marker.md', violation, join(host.root, 'packages/component-contract'));
      expect(run().status).toBe(1);
    }
  });
});
