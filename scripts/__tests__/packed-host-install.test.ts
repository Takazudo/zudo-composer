// @vitest-environment node
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, delimiter, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  FIRST_PARTY, assertConfinedWrites, assertExternalWorkspace, assertInstalledHost,
  configurePackedHost, copyPackedHost, discoverPackedHosts, isolatedEnvironment,
  packedHostManifest, packPackage, pnpm, repositoryRoots, run, selectPackedHosts,
  startHostServer, tree,
} from "../packed-host-helpers.mjs";
import { MISSING_RUNTIME, packMissingRuntime, plantHoistedDependency } from "../packed-host-negatives.mjs";
import { SITE_HEADERS, SITE_MANIFEST, createSiteManifest, siteHeaders, verifySiteStaticArtifact } from "../../server/site-build/artifact.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const packageManager = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8")).packageManager as string;
const temporaries: string[] = [];
afterEach(async () => { await Promise.all(temporaries.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

async function temporary() {
  const path = await mkdtemp(join(tmpdir(), "packed-host-helper-test-"));
  temporaries.push(path);
  return path;
}

async function put(root: string, path: string, content = "fixture") {
  await mkdir(resolve(root, path, ".."), { recursive: true });
  await writeFile(join(root, path), content);
}

const declared = () => ({
  name: "demo-proof", version: "0.0.0", private: true, type: "module",
  exports: { "./components": "./components/pack.ts" },
  scripts: { test: "vitest run", seed: "zudo-composer seed" },
  devDependencies: { "zudo-composer": "workspace:*", "@zudo-composer/component-contract": "workspace:*", preact: "^10.29.8" },
});
const archiveSpecs = { "zudo-composer": "file:/tmp/tool.tgz", "@zudo-composer/component-contract": "file:/tmp/contract.tgz" };

describe("packed host discovery and manifest isolation", () => {
  it("covers all four real hosts from disk and retains the default synthesized proof", () => {
    const hosts = discoverPackedHosts(repositoryRoot);
    expect(hosts.map((host) => basename(host))).toEqual(["demo-blog", "demo-landing", "demo-studio", "demo-webshop"]);
    expect(selectPackedHosts([], hosts)).toEqual({ hosts, fixture: true, negative: undefined });
    expect(selectPackedHosts(["--host", "demo-blog"], hosts)).toEqual({ hosts: [hosts[0]], fixture: false, negative: undefined });
    expect(selectPackedHosts(["--host", "demo-blog", "--negative", "missing-runtime"], hosts).negative).toBe("missing-runtime");
    expect(() => selectPackedHosts(["--negative", "missing-runtime"], hosts)).toThrow("exactly one --host");
    expect(() => selectPackedHosts(["--host", "absent"], hosts)).toThrow("Unknown");
    expect(() => selectPackedHosts(["--skip-build"], hosts)).toThrow("invalid option");
  });

  it("discovers future host names without workspace membership and fails on an empty fleet", async () => {
    const root = await temporary();
    expect(() => discoverPackedHosts(root)).toThrow("No real");
    await put(root, "packages/future-host/zudo-composer.config.mjs", "export default {};");
    await put(root, "fixtures/self-host/package.json", JSON.stringify(declared()));
    await put(root, "packages/demo-missing-manifest/site-project.ts");
    expect(discoverPackedHosts(root).map((host) => basename(host))).toEqual(["demo-missing-manifest", "future-host"]);
  });

  it("rewrites and overrides exactly the two first-party packages, preserving the host", () => {
    const original = declared();
    const result = packedHostManifest(original, archiveSpecs, packageManager);
    expect(result.devDependencies).toEqual({ ...original.devDependencies, ...archiveSpecs });
    expect(result.pnpm).toEqual({ overrides: archiveSpecs });
    expect(result.packageManager).toBe(packageManager);
    expect(result).toMatchObject({ exports: original.exports, scripts: original.scripts });
    expect(original.devDependencies["zudo-composer"]).toBe("workspace:*");
    const installedHost = { name: "generated-host", dependencies: { "zudo-composer": "0.0.0", "@zudo-composer/component-contract": "^1.0.0" } };
    expect(packedHostManifest(installedHost, archiveSpecs, packageManager).dependencies).toEqual(archiveSpecs);
    const peers = { name: "peer-host", peerDependencies: { ...installedHost.dependencies }, optionalDependencies: { ...installedHost.dependencies } };
    expect(packedHostManifest(peers, archiveSpecs, packageManager)).toMatchObject({ peerDependencies: archiveSpecs, optionalDependencies: archiveSpecs });
  });

  it.each(["workspace:^", "workspace:../tool", "file:../tool", "link:../tool", "path:../tool"])("rejects the broader first-party protocol %s", (specifier) => {
    const host = declared();
    host.devDependencies["zudo-composer"] = specifier;
    expect(() => packedHostManifest(host, archiveSpecs, packageManager)).toThrow("unsupported consumer dependency");
  });

  it("rejects undeclared peers, arbitrary workspaces, unknown overrides and relative tarballs", () => {
    expect(() => packedHostManifest({ name: "missing", dependencies: { "zudo-composer": "workspace:*" } }, archiveSpecs, packageManager)).toThrow("must declare @zudo-composer/component-contract");
    expect(() => packedHostManifest({ ...declared(), dependencies: { unknown: "workspace:*" } }, archiveSpecs, packageManager)).toThrow("unsupported consumer dependency");
    expect(() => packedHostManifest({ ...declared(), dependencies: { "@zudo-sg/ui": "file:/copied-provider" } }, archiveSpecs, packageManager)).toThrow("unsupported consumer dependency");
    expect(() => packedHostManifest({ ...declared(), pnpm: { overrides: { unknown: "file:../root" } } }, archiveSpecs, packageManager)).toThrow("pnpm settings");
    expect(() => packedHostManifest(declared(), { ...archiveSpecs, "zudo-composer": "file:tool.tgz" }, packageManager)).toThrow("Missing absolute packed tarball");
  });

  it("removes inherited host roots, Node hooks, package-manager settings and repository PATH entries", () => {
    const roots = ["/checkout", "/other-worktree"];
    const source = {
      PATH: ["/checkout/node_modules/.bin", "/other-worktree/bin", "/tmp/node_modules/.bin", "/usr/bin", "."].join(delimiter),
      HOME: "/home/developer", CI: "1", GITHUB_SHA: "source-revision",
      ZUDO_COMPOSER_DATA_DIR: "../outside", ZUDO_COMPOSER_STYLES: "../../outside.css", ZUDO_COMPOSER_PUBLIC_ASSETS_DIR: "../outside",
      ZUDO_COMPOSER_COMPOSITIONS_DIR: "../outside", ZUDO_COMPOSER_CONTENT_DIR: "../outside", ZUDO_COMPOSER_MAPPINGS_DIR: "../outside",
      ZUDO_COMPOSER_SITEMAPS_DIR: "../outside", ZUDO_COMPOSER_ASSETS_DIR: "../outside",
      ZUDO_DATA_ROOT: "/outside", ZUDO_SITE_PROJECT_ROOT: "/outside", ZUDO_ASSETS_STORE_ROOT: "/outside",
      NODE_ENV: "production", NODE_PATH: "/checkout/node_modules", NODE_OPTIONS: "--import=/checkout/loader.mjs", INIT_CWD: "/checkout",
      npm_config_hoist: "true", PNPM_WORKSPACE_DIR: "/checkout", npm_execpath: "/checkout/pnpm",
    };
    expect(isolatedEnvironment(roots, source)).toEqual({ PATH: "/usr/bin", HOME: source.HOME, CI: "1", GITHUB_SHA: "source-revision" });
    expect(source.NODE_PATH).toBe("/checkout/node_modules");
  });

  it("checks real paths, the containing checkout, and ambient parent workspaces/modules", async () => {
    const root = await temporary();
    await put(root, ".git", "gitdir: ignored");
    const worktree = join(root, "worktrees/topic");
    await mkdir(worktree, { recursive: true });
    expect(await repositoryRoots(worktree)).toContain(root);
    await expect(assertExternalWorkspace([root], worktree)).rejects.toThrow("outside the repository");
    const outside = await temporary();
    const linked = join(outside, "linked");
    await symlink(worktree, linked);
    await expect(assertExternalWorkspace([root], linked)).rejects.toThrow("outside the repository");
    const external = join(outside, "host");
    await mkdir(external);
    await expect(assertExternalWorkspace([root], external)).resolves.toBeUndefined();
    await put(outside, "pnpm-workspace.yaml", "packages: []");
    await expect(assertExternalWorkspace([root], external)).rejects.toThrow("ambient parent");
    await rm(join(outside, "pnpm-workspace.yaml"));
    await mkdir(join(outside, "node_modules"));
    await expect(assertExternalWorkspace([root], external)).rejects.toThrow("ambient parent");
  });

  it("copies host-owned CMS, binary assets and tests while excluding installed/output trees", async () => {
    const source = await temporary();
    const destination = join(await temporary(), "copy");
    const included = ["package.json", "site-project.ts", "cms/workspaces/selected.json", "styles/base.css", "public/uploaded-assets/photo.webp", "__tests__/host.test.ts"];
    for (const path of included) await put(source, path);
    await writeFile(join(source, "public/uploaded-assets/photo.webp"), Buffer.from([0, 255, 128, 10]));
    for (const path of ["node_modules/hoisted/index.js", "dist-site/index.html", ".zudo-site-project/active.json", ".zudo-composer-demos-browser/session/cms.json"]) await put(source, path);
    await copyPackedHost(source, destination);
    for (const path of included) expect(await readFile(join(destination, path))).toEqual(await readFile(join(source, path)));
    expect(await readdir(destination)).not.toContain("node_modules");
    expect(await tree(destination)).not.toContain("dist-site");
    expect(await tree(destination)).not.toContain(".zudo-composer-demos-browser");
    await symlink(join(source, "site-project.ts"), join(source, "linked.ts"));
    await expect(copyPackedHost(source, join(await temporary(), "unsafe"))).rejects.toThrow("filesystem link");
  });
});

async function artifact(host: string) {
  const directory = join(host, "dist-site");
  await put(directory, "index.html", '<!doctype html><script type="module" src="/assets/site.js"></script>');
  await put(directory, "assets/site.js", "console.log('packed host');");
  await put(directory, SITE_HEADERS, siteHeaders([]));
  const manifest = await createSiteManifest({ directory, projectId: "proof", projectSourceRevision: "a".repeat(64), routes: ["/"] });
  await put(directory, SITE_MANIFEST, JSON.stringify(manifest));
  return () => verifySiteStaticArtifact({ directory });
}

describe("packed host write confinement", () => {
  it("allows normal CMS writes but requires positive artifact verification for dist-site", async () => {
    const host = await temporary();
    await put(host, "package.json", JSON.stringify(declared()));
    const before = await tree(host);
    await put(host, "cms/new.json");
    await expect(assertConfinedWrites(host, before)).resolves.toBeUndefined();
    const verify = await artifact(host);
    await expect(assertConfinedWrites(host, before)).rejects.toThrow("verifySiteStaticArtifact");
    await expect(assertConfinedWrites(host, before, verify)).resolves.toBeUndefined();
    await put(host, "dist-site/assets/site.js", "tampered bytes");
    await expect(assertConfinedWrites(host, before, verify)).rejects.toThrow("checksum");
  });

  it("still rejects an unrelated top-level write alongside a positively verified artifact", async () => {
    const host = await temporary();
    const verify = await artifact(host);
    await put(host, "outside/escaped.txt");
    await expect(assertConfinedWrites(host, [], verify)).rejects.toThrow("outside/escaped.txt");
  });
});

describe("real bounded package/install and negative mechanics", () => {
  it("installs exact tarballs, including a transitive contract dependency, without a registry or workspace link", async () => {
    const workspace = await temporary();
    const tarballs: Record<string, string> = {};
    for (const name of FIRST_PARTY) {
      const source = join(workspace, name === "zudo-composer" ? "tool" : "contract");
      await put(source, "package.json", JSON.stringify({
        name, version: "1.0.0", packageManager, files: ["index.mjs"], exports: { ".": "./index.mjs", "./package.json": "./package.json" },
        ...(name === "zudo-composer" ? { dependencies: { "@zudo-composer/component-contract": "1.0.0" } } : {}),
      }));
      await put(source, "index.mjs", "export const packed = true;");
      tarballs[name] = await packPackage(source, join(workspace, "tarballs"));
    }
    const host = join(workspace, "host");
    const manifest = declared();
    const { preact: _preact, ...dependencies } = manifest.devDependencies;
    void _preact;
    await put(host, "package.json", JSON.stringify({ ...manifest, devDependencies: dependencies }));
    await put(host, "pnpm-lock.yaml", "stale workspace lockfile");
    const configured = await configurePackedHost(host, tarballs, packageManager);
    expect(configured.pnpm).toEqual({ overrides: tarballs });
    expect(await readFile(join(host, "pnpm-workspace.yaml"), "utf8")).toContain("hoist: false");
    const env = isolatedEnvironment([repositoryRoot], { ...process.env, npm_config_registry: "http://127.0.0.1:1" });
    // Offline ensures this tiny probe cannot silently substitute registry packages.
    await run(pnpm, ["install", "--offline", "--no-frozen-lockfile"], host, { env });
    await run(pnpm, ["install", "--offline", "--frozen-lockfile"], host, { env });
    const installed = await assertInstalledHost(host, env, [repositoryRoot]);
    expect(Object.keys(installed)).toEqual(FIRST_PARTY);
    // pnpm 11 verifies dependencies before exec/run; the rewritten manifest and
    // frozen lockfile must stay coherent when the actual host command starts.
    const executed = await run(pnpm, ["exec", "node", "--input-type=module", "-e", "import { packed } from 'zudo-composer'; console.log(packed);"], host, { env });
    expect(executed.stdout.trim()).toBe("true");
    const { stdout } = await run(process.execPath, ["--input-type=module", "-e", `
      import { createRequire } from 'node:module';
      import { resolve } from 'node:path';
      const host = createRequire(resolve('package.json'));
      const tool = createRequire(host.resolve('zudo-composer/package.json'));
      console.log(tool.resolve('@zudo-composer/component-contract/package.json'));
    `], host, { env });
    expect(stdout.trim()).toBe(installed["@zudo-composer/component-contract"]);
  });

  it("repackages a broken files allowlist and fails an actual runtime import from that tarball", async () => {
    const workspace = await temporary();
    const source = join(workspace, "tool");
    await put(source, "package.json", JSON.stringify({ name: "zudo-composer", version: "1.0.0", packageManager, files: ["plugins"] }));
    await put(source, MISSING_RUNTIME, "export const root = true;");
    await put(source, "plugins/entry.mjs", "import './roots.mjs';");
    const good = await packPackage(source, join(workspace, "tarballs"));
    const broken = await packMissingRuntime(good, workspace);
    const installed = join(workspace, "installed");
    await mkdir(installed);
    await run("tar", ["-xzf", broken.slice(5), "-C", installed], workspace);
    await expect(run(process.execPath, [join(installed, "package/plugins/entry.mjs")], installed)).rejects.toThrow("roots.mjs");
    expect(await readFile(join(source, MISSING_RUNTIME), "utf8")).toBe("export const root = true;");
  });

  it("proves a hoisted control import resolves in the source host but fails in its isolated copy", async () => {
    const root = await temporary();
    const sourceHost = join(root, "packages/host");
    const hostRoot = join(await temporary(), "host");
    for (const host of [sourceHost, hostRoot]) {
      await put(host, "package.json", JSON.stringify(declared()));
      await put(host, "zudo-composer.config.mjs", "export default {};\n");
    }
    const env = isolatedEnvironment([root]);
    const planted = await plantHoistedDependency({ root, sourceHost, hostRoot, env });
    try {
      expect(await readFile(join(sourceHost, "zudo-composer.config.mjs"), "utf8")).toBe("export default {};\n");
      expect(await readFile(join(hostRoot, "zudo-composer.config.mjs"), "utf8")).toContain(planted.name);
      await expect(run(process.execPath, [join(hostRoot, "zudo-composer.config.mjs")], hostRoot, { env })).rejects.toThrow(planted.name);
    } finally {
      await planted.remove();
    }
    expect(await readdir(join(root, "node_modules"))).toEqual([]);
  });
});

async function freePort() {
  const server = createServer();
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test port");
  await new Promise<void>((closed, reject) => server.close((error) => error ? reject(error) : closed()));
  return address.port;
}

describe("failed server startup cleanup", () => {
  it("kills a surviving grandchild when the detached launcher exits during startup", async () => {
    const host = await temporary();
    const pulse = join(host, "pulse");
    const childFile = join(host, "child.mjs");
    await writeFile(childFile, `import { writeFileSync } from 'node:fs';\nwriteFileSync('child-pid', String(process.pid));\nsetInterval(() => writeFileSync(${JSON.stringify(pulse)}, String(Date.now())), 10);\n`);
    const args = ["--input-type=module", "-e", `
      import { spawn } from 'node:child_process';
      import { existsSync } from 'node:fs';
      spawn(process.execPath, [${JSON.stringify(childFile)}], { stdio: 'ignore' });
      const timer = setInterval(() => { if (existsSync('child-pid')) { clearInterval(timer); console.error('startup-fixture-failed'); process.exit(23); } }, 10);
    `];
    await expect(startHostServer(host, { port: await freePort(), command: process.execPath, args })).rejects.toThrow("startup-fixture-failed");
    await delay(50);
    const first = await readFile(pulse, "utf8").catch(() => "no pulse");
    await delay(75);
    expect(await readFile(pulse, "utf8").catch(() => "no pulse")).toBe(first);
    const pid = Number(await readFile(join(host, "child-pid"), "utf8"));
    // Linux may briefly retain an exited orphan as a zombie until init reaps it.
    const stat = await readFile(`/proc/${pid}/stat`, "utf8").catch(() => "");
    expect(stat === "" || /^\d+ \(.+\) Z /u.test(stat)).toBe(true);
  });

  it("rejects spawn errors immediately without leaving the readiness poll alive", async () => {
    await expect(startHostServer(await temporary(), { port: await freePort(), command: "/absent-packed-host-launcher" })).rejects.toThrow("ENOENT");
  });
});
