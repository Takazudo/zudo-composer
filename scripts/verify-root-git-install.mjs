// @ts-check
// Prove a host can install the WHOLE tool from an exact root Git commit, next
// to the component contract's package-root commit, with nothing from this
// checkout: no sibling path, no tarball, no workspace. The consumer lives in a
// temporary directory outside the repository, resolves both packages from
// GitHub into a fresh lockfile, installs under --frozen-lockfile, imports
// every public subpath and runs the same public-entry probe the packed-install
// proof uses. It then runs fixtures/hosted-content-host inside that host: the
// Worker-style service over the portable entries, its WebWorker-only type
// check, and the restricted editor built through `zudo-composer/vite`.
//
// Usage: node scripts/verify-root-git-install.mjs [--sha <40-hex>]
// The commit defaults to HEAD and must already be reachable on the public
// repository (push the branch first). The proof never claims a commit it did
// not install.
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { cp, copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { PUBLIC_ENTRIES } from "./public-entries.mjs";

const execFile = promisify(execFileCallback);
const root = resolve(import.meta.dirname, "..");
const repositoryUrl = "https://github.com/Takazudo/zudo-composer.git";
const toolPackage = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
/** @type {{packageName: string, packageCommit: string, rootGitSpec: string}} */
const contractHandoff = JSON.parse(await readFile(join(root, "contract-handoff.json"), "utf8"));
const shaIndex = process.argv.indexOf("--sha");
const sha = (shaIndex === -1 ? (await execFile("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" })).stdout : process.argv[shaIndex + 1] ?? "").trim();
assert.match(sha, /^[0-9a-f]{40}$/, "A full 40-character lowercase commit SHA is required");
assert.match(contractHandoff.packageCommit, /^[0-9a-f]{40}$/, "contract handoff must carry a full package commit");
const toolSpec = `git+${repositoryUrl}#${sha}`;

/** @param {string[]} args @param {string} cwd */
async function pnpm(args, cwd) {
  try {
    return await execFile("corepack", ["pnpm", ...args], { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  } catch (error) {
    if (error && typeof error === "object" && "stdout" in error) console.error(error.stdout);
    if (error && typeof error === "object" && "stderr" in error) console.error(error.stderr);
    throw error;
  }
}

/** @param {string} text @param {string} description */
function assertNoLocalProtocols(text, description) {
  for (const protocol of ["file:", "link:", "workspace:", "path:"]) {
    assert.ok(!new RegExp(`(?:^|[^A-Za-z0-9_-])${protocol}`, "u").test(text), `${description} must not contain ${protocol}`);
  }
}

const advertised = (await execFile("git", ["ls-remote", repositoryUrl], { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 })).stdout;
if (!advertised.includes(sha)) console.warn(`[root git install] ${sha} is not a branch or tag tip on ${repositoryUrl}; the install succeeds only if the commit is otherwise reachable.`);
const status = (await execFile("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" })).stdout.trim();
if (status) console.warn("[root git install] The checkout has uncommitted changes; the proof installs the pushed commit, not this working tree.");

const temporary = await realpath(await mkdtemp(join(tmpdir(), "zudo-composer-root-git-install-")));
const host = join(temporary, "host");
const fromRepository = relative(root, temporary);
assert.ok(fromRepository === ".." || fromRepository.startsWith(`..${sep}`) || isAbsolute(fromRepository), "The install proof must run outside the repository");

try {
  await mkdir(join(host, "components"), { recursive: true });
  await mkdir(join(host, "styles"), { recursive: true });
  await writeFile(join(host, "package.json"), `${JSON.stringify({
    name: "public-entry-host", private: true, version: "0.0.0", type: "module", packageManager: toolPackage.packageManager,
    exports: { "./components": "./components/pack.mjs" },
    // Written verbatim rather than through `pnpm add`, which rewrites the spec
    // to the `github:` shorthand; the host keeps the exact spec it pins.
    dependencies: { "zudo-composer": toolSpec, [contractHandoff.packageName]: contractHandoff.rootGitSpec, preact: toolPackage.peerDependencies.preact },
    // The consumer type check needs the same TypeScript/Vite identities the packed proof uses.
    devDependencies: { typescript: toolPackage.devDependencies.typescript, "@types/node": toolPackage.devDependencies["@types/node"], vite: toolPackage.dependencies.vite },
  }, null, 2)}\n`);
  // No workspace packages, no overrides: the only way to the tool is the Git spec.
  await writeFile(join(host, "pnpm-workspace.yaml"), `packages: []\nstrictPeerDependencies: true\nallowBuilds:\n  '${contractHandoff.packageName}': true\n  esbuild: true\n`);
  await writeFile(join(host, "zudo-composer.config.ts"), 'import { defineComposerConfig } from "zudo-composer/config";\nexport default defineComposerConfig({ pack: "public-entry-host/components" });\n');
  await writeFile(join(host, "components/pack.mjs"), `import { defineComponent, defineComponentPack } from "@zudo-composer/component-contract";
export function Banner() { return null; }
export const componentPack = defineComponentPack({ packId: "public-entry-host", packVersion: "1.0.0", components: [defineComponent()(Banner, {
  id: "proof.banner", schemaVersion: 1, title: "Banner", category: "Proof", description: "Root Git install proof",
  source: { module: "public-entry-host/components", exportKind: "named", exportName: "Banner" },
  defaults: { headline: "Banner" }, fields: [{ prop: "headline", label: "Headline", schema: { type: "string" }, editor: { kind: "text" } }],
})] });\n`);
  await copyFile(join(root, "templates/host/styles/base.css"), join(host, "styles/base.css"));
  for (const file of ["probe.mjs", "types.mts"]) await copyFile(join(root, "scripts/fixtures/public-install", file), join(host, file));
  await copyFile(join(root, "type-tests/site-project.ts"), join(host, "site-project.ts"));

  await pnpm(["install", "--lockfile-only"], host);
  const manifest = JSON.parse(await readFile(join(host, "package.json"), "utf8"));
  assert.equal(manifest.dependencies["zudo-composer"], toolSpec, "package.json must retain the exact root Git spec");
  assert.equal(manifest.dependencies[contractHandoff.packageName], contractHandoff.rootGitSpec, "package.json must retain the exact contract Git spec");
  const lock = await readFile(join(host, "pnpm-lock.yaml"), "utf8");
  assert.ok(lock.includes(sha), "lockfile must record the full tool commit");
  assert.ok(lock.includes(contractHandoff.packageCommit), "lockfile must record the full contract package commit");
  assertNoLocalProtocols(lock, "lockfile");
  assertNoLocalProtocols(manifest.dependencies["zudo-composer"], "tool dependency spec");
  assert.ok(!lock.includes("&path:"), "lockfile must not record a Git subdirectory selector");

  await pnpm(["install", "--frozen-lockfile"], host);
  assert.equal(await readFile(join(host, "pnpm-lock.yaml"), "utf8"), lock, "frozen reinstall must not rewrite the lockfile");

  const installed = join(host, "node_modules/zudo-composer");
  const installedPackage = JSON.parse(await readFile(join(installed, "package.json"), "utf8"));
  assert.equal(installedPackage.name, "zudo-composer");
  // `./content-editor` is browser source (TSX + CSS) a host bundles; the
  // hosted-content-host fixture below builds it instead of importing it in Node.
  const subpaths = Object.keys(installedPackage.exports).filter((key) => key !== "./styles" && key !== "./package.json" && key !== "./content-editor" && installedPackage.exports[key].default !== undefined);
  for (const name of Object.keys(PUBLIC_ENTRIES.portableEntries)) {
    assert.ok(subpaths.includes(`./${name}`), `installed package must export ./${name}`);
    // The Git install ships the committed public output byte for byte.
    assert.equal(await readFile(join(installed, "server", `${name}.mjs`), "utf8"), await readFile(join(root, "server", `${name}.mjs`), "utf8"), `installed server/${name}.mjs differs from the checkout; commit the generated output`);
  }
  const importAll = subpaths.map((key) => `await import(${JSON.stringify(`zudo-composer${key.slice(1)}`)});`).join("\n");
  await execFile(process.execPath, ["--input-type=module", "--eval", `${importAll}\nconsole.log(${JSON.stringify(`Imported ${subpaths.length} public subpaths: ${subpaths.join(", ")}`)});`], { cwd: host, encoding: "utf8" }).then(({ stdout }) => console.log(stdout.trim()));
  const probe = await execFile(process.execPath, [join(host, "probe.mjs")], { cwd: host, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  console.log(probe.stdout.trim());
  await pnpm(["exec", "tsc", "--ignoreConfig", "--noEmit", "--strict", "--verbatimModuleSyntax", "--module", "ESNext", "--moduleResolution", "Bundler", "--target", "ES2023", "types.mts", "site-project.ts"], host);
  await pnpm(["exec", "tsc", "--ignoreConfig", "--noEmit", "--strict", "--verbatimModuleSyntax", "--types", "node", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2023", "types.mts", "site-project.ts"], host);
  // The consumer fixture resolves every package from this host's install.
  const hostedContent = join(host, "hosted-content-host");
  await cp(join(root, "fixtures/hosted-content-host"), hostedContent, { recursive: true, filter: (path) => !/(?:^|[\\/])(?:node_modules|dist)(?:[\\/]|$)/.test(relative(join(root, "fixtures/hosted-content-host"), path)) });
  const hosted = await execFile(process.execPath, ["verify.mjs"], { cwd: hostedContent, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  console.log(hosted.stdout.trim());
  console.log(`Root Git install passed: zudo-composer@${toolSpec} with ${contractHandoff.packageName}@${contractHandoff.rootGitSpec}; frozen reinstall, public imports, probe, strict consumer type checks and the hosted content host (Worker service, Worker type check, editor build) succeeded outside the repository.`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
