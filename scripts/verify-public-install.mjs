// @ts-check
// A bounded Node/type proof. No browser, dev server or application build: the
// consumer lives outside the repository and imports only installed subpaths.
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const root = resolve(import.meta.dirname, "..");
const temporary = await realpath(await mkdtemp(join(tmpdir(), "zudo-composer-public-install-")));
const host = join(temporary, "host");
const packs = join(temporary, "packs");
const toolPackage = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const fromRepository = relative(root, temporary);
assert.ok(fromRepository === ".." || fromRepository.startsWith(`..${sep}`) || isAbsolute(fromRepository), "The install proof must run outside the repository");

/** @param {string[]} args @param {string} cwd */
async function pnpm(args, cwd) {
  try {
    return await execFile("corepack", ["pnpm", ...args], { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    if (error && typeof error === "object" && "stdout" in error) console.error(error.stdout);
    if (error && typeof error === "object" && "stderr" in error) console.error(error.stderr);
    throw error;
  }
}

try {
  await mkdir(host);
  await mkdir(packs);
  /** @type {Record<string, string>} */
  const tarballs = {};
  for (const [name, cwd] of [["zudo-composer", root], ["@zudo-composer/component-contract", join(root, "packages/component-contract")]]) {
    const before = new Set(await readdir(packs));
    await pnpm(["pack", "--pack-destination", packs], cwd);
    const added = (await readdir(packs)).filter((path) => path.endsWith(".tgz") && !before.has(path));
    assert.equal(added.length, 1, `Expected one tarball for ${name}`);
    tarballs[name] = `file:${join(packs, added[0])}`;
  }
  await writeFile(join(host, "package.json"), JSON.stringify({
    name: "public-entry-host", private: true, version: "0.0.0", type: "module", packageManager: toolPackage.packageManager,
    exports: { "./components": "./pack.mjs" },
    dependencies: { ...tarballs, preact: toolPackage.peerDependencies.preact ?? toolPackage.devDependencies.preact ?? toolPackage.dependencies.preact },
    devDependencies: { typescript: toolPackage.devDependencies.typescript, "@types/node": toolPackage.devDependencies["@types/node"] },
  }, null, 2));
  await writeFile(join(host, "pnpm-workspace.yaml"), `packages: []\nstrictPeerDependencies: true\noverrides:\n  zudo-composer: '${tarballs["zudo-composer"]}'\n  '@zudo-composer/component-contract': '${tarballs["@zudo-composer/component-contract"]}'\n`);
  await writeFile(join(host, "zudo-composer.config.ts"), 'import { defineComposerConfig } from "zudo-composer/config";\nexport default defineComposerConfig({ pack: "public-entry-host/components" });\n');
  await writeFile(join(host, "pack.mjs"), `import { defineComponent, defineComponentPack } from "@zudo-composer/component-contract";
export function Banner() { return null; }
export const componentPack = defineComponentPack({ packId: "public-entry-host", packVersion: "1.0.0", components: [defineComponent()(Banner, {
  id: "proof.banner", schemaVersion: 1, title: "Banner", category: "Proof", description: "Installed entry proof",
  source: { module: "public-entry-host/components", exportKind: "named", exportName: "Banner" },
  defaults: { headline: "Banner" }, fields: [{ prop: "headline", label: "Headline", schema: { type: "string" }, editor: { kind: "text" } }],
})] });\n`);
  for (const file of ["probe.mjs", "types.mts"]) await copyFile(join(root, "scripts/fixtures/public-install", file), join(host, file));
  await copyFile(join(root, "type-tests/site-project.ts"), join(host, "site-project.ts"));
  await pnpm(["install"], host);
  await pnpm(["install", "--frozen-lockfile"], host);
  const lock = await readFile(join(host, "pnpm-lock.yaml"), "utf8");
  assert.ok(!lock.includes("@zudo-sg/ui"), "An installed host must not receive the repository's demo provider");
  const probe = await execFile(process.execPath, [join(host, "probe.mjs")], { cwd: host, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  console.log(probe.stdout.trim());
  await pnpm(["exec", "tsc", "--ignoreConfig", "--noEmit", "--strict", "--verbatimModuleSyntax", "--module", "ESNext", "--moduleResolution", "Bundler", "--target", "ES2023", "types.mts", "site-project.ts"], host);
  // The generated Node entries also support a NodeNext consumer. The Vite
  // plugin's existing declaration graph is checked in Bundler mode above.
  await pnpm(["exec", "tsc", "--ignoreConfig", "--noEmit", "--strict", "--verbatimModuleSyntax", "--types", "node", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2023", "site-project.ts"], host);
  console.log("Packed public declarations passed: strict Bundler consumer and NodeNext SiteProject demo, with no repository aliases.");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
