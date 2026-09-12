import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { APP_ROOT } from "../../../plugins/roots.mjs";
import { loadHostContext } from "../../host-context.mjs";
import { composer, type ResolvedComposerConfig } from "../../config/config";
import { entry, project } from "../../../src/site-project/compiler/__tests__/fixtures";
import { pack, toolchain } from "../../site-project-local/__tests__/release-fixture";
import { produceReadyWorkspace } from "../ready-workspace";
import { checkCmsFixture, discoverFixtureHosts, fixtureRoots, inventory, OWNERSHIP_FILE, runCmsFixtures, runInstalledComposer } from "../../../scripts/cms-fixtures";

const run = promisify(execFile);
const roots: string[] = [];
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function temporary() {
  const root = await mkdtemp(join(tmpdir(), "cms-fixture-test-"));
  roots.push(root);
  return root;
}

async function fixture() {
  const root = await temporary();
  const config = composer({ pack: "@fixture/pack/composer-pack", workspaceRoot: root }, { env: {} });
  const expected = await produceReadyWorkspace(project({ entries: [entry("welcome")] }), { config, pack, toolchain });
  return { root, config, pack, expected };
}

/** Update a transactional digest too: these failures must reach the domain decoder. */
async function bumpRecord(root: string, path: string, nested: boolean) {
  const record = JSON.parse(await readFile(join(root, path), "utf8"));
  const value = nested ? record.document : record;
  value.schemaVersion += 1;
  const bytes = json(record);
  await writeFile(join(root, path), bytes);
  const marker = path.indexOf("/generations/");
  if (marker < 0) return;
  const pointerPath = join(root, path.slice(0, marker), "current.json");
  const pointer = JSON.parse(await readFile(pointerPath, "utf8"));
  const id = path.split("/").at(-1)!.slice(0, -5);
  pointer.entries.find((item: { id: string }) => item.id === id).digest = digest(bytes);
  await writeFile(pointerPath, json(pointer));
}

describe("current CMS reader compatibility", () => {
  it("opens canonical registry and all four domains without changing any bytes or timestamps", async () => {
    const current = await fixture();
    const before = await Promise.all(current.expected.files.map(async ({ path }) => [path, (await lstat(join(current.root, path))).mtimeMs]));
    await checkCmsFixture(current);
    expect(await inventory(current.root, fixtureRoots(current.config))).toEqual({ directories: current.expected.directories, files: current.expected.files });
    expect(await Promise.all(current.expected.files.map(async ({ path }) => [path, (await lstat(join(current.root, path))).mtimeMs]))).toEqual(before);
  });

  it.each([
    ["registry", /workspaces\/generations\/\d+\/initial.json$/, false, /Workspace metadata is invalid/],
    ["Compositions", /composition-landing.composition.json$/, true, /Composition.*future-schema/],
    ["Content models", /content\/.*\/model-articles.json$/, true, /Content model is invalid/],
    ["Content entries", /content\/.*\/entry-welcome.json$/, false, /invalid Entry/],
    ["Mappings", /mappings\/.*\/article-page.json$/, true, /Invalid Mapping|invalid Mapping|invalid mapping/],
    ["Sitemaps", /sitemaps\/.*\/main.json$/, true, /Invalid Sitemap/],
  ] as const)("rejects a bumped %s schema through its actual reader, even with valid digests", async (_domain, pattern, nested, message) => {
    const current = await fixture();
    const path = current.expected.files.find((file) => pattern.test(file.path))!.path;
    await bumpRecord(current.root, path, nested);
    const before = await inventory(current.root, fixtureRoots(current.config));
    await expect(checkCmsFixture(current)).rejects.toThrow(message);
    expect(await inventory(current.root, fixtureRoots(current.config))).toEqual(before);
  });

  it.each(["missing", "stale", "extra-file", "extra-directory", "missing-directory"])("fails deterministic comparison for %s generated material", async (kind) => {
    const current = await fixture();
    const compositions = fixtureRoots(current.config).find((path) => path.includes("compositions"))!;
    const jsx = current.expected.files.find((file) => file.path.endsWith(".tsx"))!.path;
    if (kind === "missing") await rm(join(current.root, jsx));
    if (kind === "stale") await writeFile(join(current.root, jsx), "// stale generated JSX\n");
    if (kind === "extra-file") await writeFile(join(current.root, compositions, "extra.json"), "{}\n");
    if (kind === "extra-directory") await mkdir(join(current.root, compositions, "empty"));
    if (kind === "missing-directory") await rm(join(current.root, compositions), { recursive: true });
    const before = await inventory(current.root, fixtureRoots(current.config));
    await expect(checkCmsFixture(current)).rejects.toThrow(/missing (file|directory)|stale file|extra (file|directory)/);
    expect(await inventory(current.root, fixtureRoots(current.config))).toEqual(before);
  });

  it("refuses symlinked generated parents and protected or overlapping output roots", async () => {
    const current = await fixture();
    await rename(join(current.root, "cms"), join(current.root, "preserved"));
    await symlink(join(current.root, "preserved"), join(current.root, "cms"), "dir");
    await expect(checkCmsFixture(current)).rejects.toThrow(/not a real directory/);
    for (const settings of [
      { assetsDir: "cms/compositions/workspace-v1-initial/assets" },
      { publicAssetsDir: "cms/workspaces/uploads" },
      { mappingsDir: "cms/content" },
    ]) {
      expect(() => fixtureRoots(composer({ pack: "@fixture/pack/composer-pack", workspaceRoot: current.root, ...settings }, { env: {} }))).toThrow(/overlap/);
    }
  });
});

async function git(root: string, ...args: string[]) {
  return run("git", ["-C", root, ...args], { encoding: "utf8" });
}

async function hostRepository() {
  const root = await temporary(), hostName = "packages/demo-studio", host = join(root, hostName);
  await mkdir(host, { recursive: true });
  await mkdir(join(root, "scripts"));
  await writeFile(join(root, OWNERSHIP_FILE), json({ version: 1, hosts: {} }));
  await writeFile(join(root, ".gitignore"), "node_modules/\nignored.txt\n");
  await mkdir(join(host, "node_modules/@zudo-composer"), { recursive: true });
  await symlink(APP_ROOT, join(host, "node_modules/zudo-composer"), "dir");
  await symlink(join(APP_ROOT, "node_modules/@zudo-composer/component-contract"), join(host, "node_modules/@zudo-composer/component-contract"), "dir");
  await symlink(join(APP_ROOT, "node_modules/preact"), join(host, "node_modules/preact"), "dir");
  await writeFile(join(host, "package.json"), json({ name: "fixture-host", type: "module", exports: { "./pack": "./components/pack.ts" }, devDependencies: { "zudo-composer": "0.0.0", "@zudo-composer/component-contract": "1.0.0", preact: "^10.29.8" } }));
  await writeFile(join(host, "zudo-composer.config.ts"), 'import { defineComposerConfig } from "zudo-composer/config";\nexport default defineComposerConfig({ pack: "fixture-host/pack" });\n');
  await mkdir(join(host, "components"));
  await writeFile(join(host, "components/pack.ts"), 'import { defineComponentPack } from "@zudo-composer/component-contract";\nexport const componentPack = defineComponentPack({ packId: "empty-host", packVersion: "1.0.0", components: [] });\n');
  const source = 'import { defineSite } from "zudo-composer/authoring";\nimport { componentPack } from "fixture-host/pack";\nconst site = defineSite({ id: "fixture-site", name: "Original site", componentPack });\nconst home = site.page({ name: "Home", root: [] });\nsite.sitemap({ name: "Routes", root: { title: "Home", page: home } });\nexport default site;\n';
  await writeFile(join(host, "site-project.ts"), source);
  await git(root, "init", "-q");
  await git(root, "config", "user.name", "CMS fixture test");
  await git(root, "config", "user.email", "cms-fixture@example.invalid");
  const commit = async () => { await git(root, "add", "."); await git(root, "commit", "-qm", "Generated fixture baseline"); };
  await commit();
  const invoke = (check = false) => runCmsFixtures({ root, check, report: () => {} });
  return { root, host, hostName, source, commit, invoke };
}

describe("installed fixture regeneration", () => {
  it("discovers a new host, registers already-fresh output, and reruns without rewriting", async () => {
    const current = await hostRepository();
    await runInstalledComposer(current.host, ["generate"]);
    await runInstalledComposer(current.host, ["seed", "--ready-workspace"]);
    expect(await discoverFixtureHosts(current.root, { version: 1, hosts: {} })).toEqual([current.hostName]);
    await current.invoke();
    const metadata = JSON.parse(await readFile(join(current.root, OWNERSHIP_FILE), "utf8"));
    expect(Object.keys(metadata.hosts)).toEqual([current.hostName]);
    const before = await inventory(current.host, [...metadata.hosts[current.hostName], "site-project.json"]);
    const times = await Promise.all(before.files.map(async ({ path }) => (await lstat(join(current.host, path))).mtimeMs));
    await current.invoke();
    expect(await inventory(current.host, [...metadata.hosts[current.hostName], "site-project.json"])).toEqual(before);
    expect(await Promise.all(before.files.map(async ({ path }) => (await lstat(join(current.host, path))).mtimeMs))).toEqual(times);
    await current.invoke(true);
    await current.commit();
    // Unchanged manifest/aggregate, different installed pack bytes: check
    // must reject the new identity, and explicit regeneration must accept it.
    const aggregate = await readFile(join(current.host, "site-project.json"), "utf8");
    const packFile = join(current.host, "components/pack.ts");
    await writeFile(packFile, `${await readFile(packFile, "utf8")}\n// New pack implementation bytes.\n`);
    await expect(current.invoke(true)).rejects.toThrow(/stale file: .*current.json/);
    expect(await readFile(join(current.host, "site-project.json"), "utf8")).toBe(aggregate);
    await current.invoke();
    await current.invoke(true);
  }, 120_000);

  it("regenerates tracked incompatible bytes and old directories without decoding them, preserving unrelated state", async () => {
    const current = await hostRepository();
    await current.invoke();
    const oldMetadata = JSON.parse(await readFile(join(current.root, OWNERSHIP_FILE), "utf8"));
    const oldRoots = oldMetadata.hosts[current.hostName] as string[];
    const previous = await inventory(current.host, oldRoots);
    const record = previous.files.find(({ path }) => /workspaces\/generations\/\d+\/initial.json$/.test(path))!.path;
    await bumpRecord(current.host, record, false);
    await current.commit();
    await expect(current.invoke(true)).rejects.toThrow(/Workspace metadata is invalid/);
    // A config/layout change moves the managed trees; Assets remain global.
    await writeFile(join(current.host, "zudo-composer.config.ts"), 'import { defineComposerConfig } from "zudo-composer/config";\nexport default defineComposerConfig({ pack: "fixture-host/pack", dataDir: "new-data", assetsDir: "cms/assets" });\n');
    await writeFile(join(current.host, "site-project.ts"), current.source.replace("Original site", "Changed source"));
    const preserved = ["cms/assets/authored.txt", "public/uploaded-assets/keep.txt", "cms/content/workspace-v1-personal/keep.txt", ".zudo-site-project/keep.txt", "notes.txt"];
    for (const path of preserved) { await mkdir(dirname(join(current.host, path)), { recursive: true }); await writeFile(join(current.host, path), path); }
    await current.invoke();
    for (const path of oldRoots) await expect(lstat(join(current.host, path))).rejects.toMatchObject({ code: "ENOENT" });
    for (const path of preserved) expect(await readFile(join(current.host, path), "utf8")).toBe(path);
    expect(await readFile(join(current.host, "site-project.json"), "utf8")).toContain("Changed source");
    await current.invoke(true);
  }, 120_000);

  it("refuses authored/ignored extra files and altered JSON before changing any host output", async () => {
    const current = await hostRepository();
    await current.invoke();
    await current.commit();
    const config = (await loadHostContext({ workspaceRoot: current.host, env: {} })).composerConfig as ResolvedComposerConfig;
    const managed = fixtureRoots(config);
    await writeFile(join(current.host, "site-project.ts"), current.source.replace("Original site", "Changed source"));
    const extra = join(current.host, managed[0]!, "ignored.txt");
    await writeFile(extra, "authored");
    const before = await inventory(current.host, [...managed, "site-project.json"]);
    await expect(current.invoke()).rejects.toThrow(/refusing to replace authored or untracked CMS/);
    expect(await inventory(current.host, [...managed, "site-project.json"])).toEqual(before);
    await rm(extra);
    await writeFile(join(current.host, "site-project.json"), "authored JSON\n");
    await expect(current.invoke()).rejects.toThrow(/refusing to replace edited site-project.json/);
    expect(await readFile(join(current.host, "site-project.json"), "utf8")).toBe("authored JSON\n");
  }, 120_000);

  it("fails missing/stale ownership and missing source instead of skipping hosts", async () => {
    const current = await hostRepository();
    await current.invoke();
    const metadataPath = join(current.root, OWNERSHIP_FILE);
    const metadata = await readFile(metadataPath, "utf8");
    await rm(metadataPath);
    await expect(current.invoke(true)).rejects.toThrow(/cms-fixtures.json/);
    await writeFile(metadataPath, json({ version: 1, hosts: {} }));
    await expect(current.invoke(true)).rejects.toThrow(/ownership is stale/);
    await writeFile(metadataPath, metadata);
    await rm(join(current.host, "site-project.ts"));
    await expect(current.invoke(true)).rejects.toThrow(/missing packages\/demo-studio\/site-project.ts/);
    await rm(join(current.host, "site-project.json"));
    await writeFile(metadataPath, json({ version: 1, hosts: {} }));
    await expect(current.invoke(true)).rejects.toThrow(/missing packages\/demo-studio\/site-project.ts/);
  }, 120_000);

  it("refuses escaping and overlapping ownership metadata before running a producer", async () => {
    const current = await hostRepository();
    for (const managed of [
      ["../outside", "a", "b", "c", "d"],
      ["a", "a/nested", "b", "c", "d"],
    ]) {
      await writeFile(join(current.root, OWNERSHIP_FILE), json({ version: 1, hosts: { [current.hostName]: managed } }));
      await expect(current.invoke(true)).rejects.toThrow(/Invalid generated path|Overlapping CMS fixture roots/);
    }
    await expect(lstat(join(current.host, "cms"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
