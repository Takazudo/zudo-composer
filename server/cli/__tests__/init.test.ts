import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { scanConsumerHost } from "../../../scripts/check-consumer-boundary.mjs";
import { assertCreatorTarball, creatorEnvironment, initHostProject, type InitCommand } from "../../creator/init.mjs";
import { assertCreatorVersionParity, createHostConfigFiles, createHostManifest, creatorPackageManager, HOST_TEMPLATE_ROOT, readCreatorMetadata, validateHostName, writeHostProject } from "../../creator/project.mjs";
import { parseArguments } from "../run.mjs";

const run = promisify(execFile);
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function temporary() {
  const root = await mkdtemp(join(tmpdir(), "creator-test-"));
  roots.push(root);
  return root;
}
async function archive(name: string, version: string) {
  const root = await temporary();
  await mkdir(join(root, "package"));
  await writeFile(join(root, "package/package.json"), JSON.stringify({ name, version }));
  // Deliberately misleading filename: acceptance must inspect package bytes.
  const file = join(root, "zudo-composer-0.0.0.tgz");
  await run("tar", ["-czf", file, "package"], { cwd: root });
  return file;
}

describe("create-only init arguments", () => {
  it("normalizes caller-relative targets and paired archives, retaining a scoped name", () => {
    expect(parseArguments(["init", "host with spaces", "--name", "@my-team/site", "--tool-tarball", "tool.tgz", "--contract-tarball", "contract.tgz"]))
      .toEqual({ command: "init", options: { target: resolve("host with spaces"), name: "@my-team/site", toolTarball: resolve("tool.tgz"), contractTarball: resolve("contract.tgz") } });
    expect(parseArguments(["init", "--help"])).toEqual({ command: "help" });
  });
  it.each([
    ["init"], ["init", " "], ["init", "one", "two"], ["init", "one", "--name"],
    ["init", "one", "--name", "a", "--name", "b"], ["init", "one", "--tool-tarball", "tool.tgz"],
    ["init", "one", "--contract-tarball", "contract.tgz"], ["init", "one", "--skip-install"],
    ["init", "one", "--upgrade"], ["upgrade", "one"],
  ].map((args) => ({ args })))("rejects incomplete, ambiguous or upgrading invocation $args", ({ args }) => {
    expect(parseArguments(args)).toHaveProperty("error");
  });
  it.each(["Uppercase", "../outside", "two words", "@scope", ".hidden", "zudo-composer", "preact", "node_modules", "src"])("rejects unsafe or colliding package name %s", (name) => {
    expect(() => validateHostName(name)).toThrow("Invalid host package name");
  });
});

describe("creator templates and written-version parity", () => {
  it("retains its pnpm pin when pack strips packageManager and rejects source/engine drift", async () => {
    const metadata = await readCreatorMetadata();
    const packed = { ...metadata, tool: { ...metadata.tool } };
    delete packed.tool.packageManager;
    expect(createHostManifest("creator-example", packed).packageManager).toBe(metadata.tool.packageManager);
    expect(() => creatorPackageManager({ ...metadata.tool, engines: { ...metadata.tool.engines, pnpm: "99.0.0" } })).toThrow("versions disagree");
    const manifest = createHostManifest("creator-example", packed);
    manifest.packageManager = "pnpm@99.0.0";
    expect(() => assertCreatorVersionParity(manifest, packed)).toThrow("package-manager version differs");
  });

  it("copies every base file byte-for-byte and generates portable configs for an external host", async () => {
    const root = await temporary(), host = join(root, "host with spaces");
    const metadata = await readCreatorMetadata();
    await writeHostProject(host, "@my-team/site", metadata);
    const compare = async (part: string) => {
      for (const entry of await readdir(join(HOST_TEMPLATE_ROOT, part), { withFileTypes: true })) {
        const path = join(part, entry.name);
        if (entry.isDirectory()) await compare(path);
        else expect(await readFile(join(host, path))).toEqual(await readFile(join(HOST_TEMPLATE_ROOT, path)));
      }
    };
    await compare("");
    for (const [name, bytes] of Object.entries(createHostConfigFiles("@my-team/site", metadata))) {
      await expect(lstat(join(HOST_TEMPLATE_ROOT, name))).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(join(host, name), "utf8")).toBe(bytes);
    }
    const manifest = JSON.parse(await readFile(join(host, "package.json"), "utf8"));
    expect(manifest.exports).toEqual({ "./components": "./components/pack.ts" });
    expect(manifest.dependencies.preact).toBe(metadata.tool.peerDependencies.preact);
    expect(manifest.dependencies).not.toHaveProperty("tailwindcss");
    expect(scanConsumerHost({ root, hostRoot: host })).toEqual([]);
    expect(await readFile(join(host, "vitest.config.ts"), "utf8")).not.toContain("virtual:");
    expect(await readFile(join(host, ".gitignore"), "utf8")).not.toMatch(/^(?:cms\/|public\/|site-project\.json)$/m);
  });

  it.each(["zudo-composer", "@zudo-composer/component-contract", "preact"])("fails when a written runtime version drifts: %s", async (name) => {
    const metadata = await readCreatorMetadata();
    const manifest = createHostManifest("creator-example", metadata);
    const dependencies: Record<string, string> = manifest.dependencies;
    dependencies[name] = "99.0.0";
    expect(() => assertCreatorVersionParity(manifest, metadata)).toThrow(`Creator version mismatch: dependencies.${name}`);
  });

  it.each(["@types/node", "preact-render-to-string", "typescript", "vitest"])("fails when a written development version drifts: %s", async (name) => {
    const metadata = await readCreatorMetadata();
    const manifest = createHostManifest("creator-example", metadata);
    delete manifest.devDependencies[name];
    expect(() => assertCreatorVersionParity(manifest, metadata)).toThrow(`Creator version mismatch: devDependencies.${name}`);
  });

  it("detects a new tool version against retained generated output", async () => {
    const metadata = await readCreatorMetadata();
    const manifest = createHostManifest("creator-example", metadata);
    expect(() => assertCreatorVersionParity(manifest, { ...metadata, tool: { ...metadata.tool, version: "99.0.0" } })).toThrow("Creator version mismatch");
  });

  it("rejects root imports introduced into generated output", async () => {
    const root = await temporary(), host = join(root, "host");
    await writeHostProject(host, "creator-example", await readCreatorMetadata());
    await writeFile(join(host, "components/leak.ts"), 'import "../../../src/private.ts";\n');
    expect(scanConsumerHost({ root, hostRoot: host })).toContainEqual(expect.objectContaining({ rule: "outside-host-import" }));
  });
});

describe("isolated creation failures", () => {
  it.each(["directory", "file", "symlink"])("preserves an existing %s without installing", async (kind) => {
    const root = await temporary(), target = join(root, "existing");
    if (kind === "directory") await mkdir(target);
    else if (kind === "file") await writeFile(target, "owned by user");
    else await symlink(join(root, "missing-user-target"), target);
    const before = await lstat(target), command = vi.fn();
    await expect(initHostProject({ target }, { run: command })).rejects.toThrow("existing path was preserved");
    expect((await lstat(target)).ino).toBe(before.ino);
    expect(command).not.toHaveBeenCalled();
  });

  it("fails clearly for unpublished default resolution and leaves no target", async () => {
    const target = join(await temporary(), "new-host"), command = vi.fn();
    const metadata = await readCreatorMetadata();
    await expect(initHostProject({ target }, { run: command, metadata: { ...metadata, tool: { ...metadata.tool, version: "0.0.0" } } })).rejects.toThrow("unpublished");
    await expect(lstat(target)).rejects.toMatchObject({ code: "ENOENT" });
    expect(command).not.toHaveBeenCalled();
  });

  it("checks archive names and versions from bytes instead of filenames", async () => {
    const wrongName = await archive("unrelated", "0.0.0");
    const wrongVersion = await archive("zudo-composer", "9.0.0");
    await expect(assertCreatorTarball(wrongName, "zudo-composer", "0.0.0")).rejects.toThrow("received unrelated@0.0.0");
    await expect(assertCreatorTarball(wrongVersion, "zudo-composer", "0.0.0")).rejects.toThrow("received zudo-composer@9.0.0");
    await expect(assertCreatorTarball(await archive("zudo-composer", "0.0.0"), "zudo-composer", "0.0.0")).resolves.toBeUndefined();
  });

  it("keeps overrides only in the disposable install and cleans up an install failure", async () => {
    const metadata = await readCreatorMetadata();
    const toolTarball = await archive("zudo-composer", metadata.tool.version);
    const contractTarball = await archive("@zudo-composer/component-contract", metadata.contractVersion);
    const target = join(await temporary(), "new-host");
    let staged = "";
    const command: InitCommand = async (binary, args, options) => {
      expect(binary).toBe("corepack");
      expect(args).toEqual(["pnpm", "install", "--no-frozen-lockfile"]);
      staged = options.cwd;
      expect(staged).not.toContain(resolve(import.meta.dirname, "../../.."));
      const workspace = await readFile(join(staged, "pnpm-workspace.yaml"), "utf8");
      expect(workspace).toContain("overrides:");
      expect(workspace).toContain("blockExoticSubdeps: false");
      expect(workspace).not.toContain(toolTarball);
      const manifest = JSON.parse(await readFile(join(staged, "package.json"), "utf8"));
      expect(manifest.dependencies["zudo-composer"]).toBe(metadata.tool.version);
      throw new Error("intentional install failure");
    };
    await expect(initHostProject({ target, toolTarball, contractTarball }, { run: command })).rejects.toThrow("intentional install failure");
    await expect(lstat(dirname(staged))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(target)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses dependency resolution that escapes the temporary install", async () => {
    const root = await temporary(), target = join(root, "new-host"), external = join(root, "external-tool");
    await mkdir(external);
    const metadata = await readCreatorMetadata();
    const command: InitCommand = async (_binary, _args, { cwd }) => {
      await mkdir(join(cwd, "node_modules"));
      await symlink(external, join(cwd, "node_modules/zudo-composer"));
      return "";
    };
    await expect(initHostProject({ target }, { run: command, metadata: { ...metadata, tool: { ...metadata.tool, version: "1.2.3" } } }))
      .rejects.toThrow("outside its isolated install");
    await expect(lstat(target)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects an installed version mismatch before canonical generation", async () => {
    const target = join(await temporary(), "new-host"), metadata = await readCreatorMetadata();
    const command = vi.fn<InitCommand>(async (_binary, _args, { cwd }) => {
      await mkdir(join(cwd, "node_modules/zudo-composer"), { recursive: true });
      await writeFile(join(cwd, "node_modules/zudo-composer/package.json"), JSON.stringify({ name: "zudo-composer", version: "9.9.9" }));
      return "";
    });
    await expect(initHostProject({ target }, { run: command, metadata: { ...metadata, tool: { ...metadata.tool, version: "1.2.3" } } }))
      .rejects.toThrow("installed version mismatch");
    expect(command).toHaveBeenCalledTimes(1);
    await expect(lstat(target)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("removes workspace roots and loaders while retaining ordinary registry environment", () => {
    expect(creatorEnvironment({ PATH: "/bin", npm_config_registry: "https://registry.npmjs.org", ZUDO_ASSETS_STORE_ROOT: "/private", ZUDO_COMPOSER_CONFIG: "/private", ZUDO_SITE_PROJECT_ROOT: "/private", NODE_PATH: "/private", NODE_OPTIONS: "--import=/private", INIT_CWD: "/private", GITHUB_SHA: "ignored", npm_config_workspace: "parent", NODE_ENV: "production" }))
      .toEqual({ PATH: "/bin", npm_config_registry: "https://registry.npmjs.org" });
  });
});
