import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFilesystemWorkspaceRegistry, FilesystemWorkspaceRegistry } from "../../../src/app/workspace-filesystem/registry";
import { createWorkspaceRegistryService } from "../../../src/app/workspace-filesystem/dev-server-entry";
import { createFilesystemContentStore } from "../../../src/content/storage/filesystem";
import { workspaceDomainRoots } from "../../../src/shared/workspace-scope";
import { entry, globalTemplate, linkedComposition, project } from "../../../src/site-project/compiler/__tests__/fixtures";
import { composer } from "../../config/config";
import { pack, toolchain } from "../../site-project-local/__tests__/release-fixture";
import { readActivatedSiteRelease } from "../../site-project-local/dev-reader";
import { produceReadyWorkspace, READY_WORKSPACE_ID, type ReadyWorkspaceResult } from "../ready-workspace";

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture(settings = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "ready-workspace-test-")));
  roots.push(root);
  const config = composer({ pack: "@fixture/pack/composer-pack", workspaceRoot: root, ...settings }, { env: {} });
  return { root, config, options: { config, pack, toolchain } };
}
const source = () => project({ entries: [{ ...entry("welcome"), lifecycle: "draft" }] });

async function tree(root: string): Promise<unknown> {
  return Promise.all((await readdir(root)).sort().map(async (name) => {
    const path = join(root, name), info = await lstat(path);
    return info.isDirectory() ? [name, await tree(path)] : [name, info.mtimeMs, info.ctimeMs, await readFile(path, "utf8")];
  }));
}
async function assertInventory(root: string, result: ReadyWorkspaceResult) {
  for (const directory of result.directories) expect((await lstat(join(root, directory))).isDirectory()).toBe(true);
  for (const file of result.files) expect(createHash("sha256").update(await readFile(join(root, file.path))).digest("hex")).toBe(file.digest);
  for (const file of result.files.filter(({ path }) => path.endsWith("/current.json"))) {
    const path = join(root, file.path);
    const pointer = JSON.parse(await readFile(path, "utf8"));
    const base = path.slice(0, -"current.json".length);
    expect(await readdir(join(base, "generations"))).toEqual([String(pointer.generation)]);
    expect(pointer.mutationToken).toMatch(/^[a-f0-9]{64}$/);
    for (const { id, digest } of pointer.entries) {
      const bytes = await readFile(join(base, "generations", String(pointer.generation), `${id}.json`));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(digest);
    }
  }
}

describe("canonical ready workspace producer", () => {
  it("publishes through seed, calls complete, selects its token, and persists every reader invariant", async () => {
    const { root, config, options } = await fixture();
    const complete = vi.spyOn(FilesystemWorkspaceRegistry.prototype, "complete");
    const input = source();
    const first = await produceReadyWorkspace(input, options);
    expect(first).toMatchObject({ projectId: input.id, workspaceId: READY_WORKSPACE_ID, status: "created" });
    expect(complete).toHaveBeenCalledExactlyOnceWith(READY_WORKSPACE_ID, true);
    const completed = await complete.mock.results[0]!.value;
    const registryRoot = join(config.paths.data, "workspaces");
    const reader = await createWorkspaceRegistryService({ registryRoot, domainRoots: config.paths });
    const record = await reader.open();
    expect(record).toEqual(completed);
    expect(record).toMatchObject({ status: "ready", mutationToken: 1, baselineRevision: first.revision });
    expect(record).not.toHaveProperty("seed");
    expect(record).not.toHaveProperty("requiresBeforeComplete");
    expect(record).not.toHaveProperty("seedCleanupPending");
    expect(await reader.selection()).toBe(READY_WORKSPACE_ID);
    expect(await reader.missingDirectories(READY_WORKSPACE_ID)).toEqual([]);
    const content = await createFilesystemContentStore({ contentRoot: workspaceDomainRoots(config.paths, READY_WORKSPACE_ID).content });
    expect((await content.readAll()).entries).toMatchObject([{ id: "welcome", lifecycle: "published" }]);
    expect(input.providers.content[0]!.entries[0]!.lifecycle).toBe("draft");
    await assertInventory(root, first);
    await expect(lstat(join(root, ".zudo-site-project"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readActivatedSiteRelease({ workspaceRoot: root, pack, toolchain })).toBeNull();
  });

  it("regenerates byte-identical fresh trees and leaves a repeated destination completely unchanged", async () => {
    const { root, options } = await fixture({ dataDir: "data/cms", contentDir: "editor/content" });
    const input = source();
    const first = await produceReadyWorkspace(input, options);
    const before = await tree(root);
    const repeated = await produceReadyWorkspace(input, options);
    expect(repeated).toEqual({ ...first, status: "unchanged" });
    expect(await tree(root)).toEqual(before);
    const fresh = join(root, "fresh");
    expect(await produceReadyWorkspace(input, { ...options, outputRoot: fresh })).toEqual(first);
    for (const { path } of first.files) expect(await readFile(join(fresh, path))).toEqual(await readFile(join(root, path)));
    expect(first.files.some(({ path }) => path.startsWith("editor/content/"))).toBe(true);
    expect(first.directories).toContain("data/cms/compositions/workspace-v1-initial");
  });

  it("keeps empty domains committable and writes linked Composition JSX through the real planner", async () => {
    const { root, options } = await fixture();
    const input = project({ compositions: [linkedComposition("landing"), globalTemplate()], mappings: [] });
    input.providers.content[0]!.models = [];
    const result = await produceReadyWorkspace(input, options);
    expect(result.files.some(({ path }) => path.endsWith("composition-landing.tsx"))).toBe(true);
    expect(await readFile(join(root, "cms/compositions/workspace-v1-initial/composition-landing.tsx"), "utf8")).toContain("./composition-shell");
    for (const domain of ["content", "mappings"]) expect(result.files.some(({ path }) => path.startsWith(`cms/${domain}/workspace-v1-initial/generations/`))).toBe(true);
    await assertInventory(root, result);
  });

  it("refuses changed source and authored state while exposing a usable fresh generation inventory", async () => {
    const { root, config, options } = await fixture();
    const input = source();
    const original = await produceReadyWorkspace(input, options);
    const before = await tree(root);
    const changed = { ...input, name: "Changed source" };
    await expect(produceReadyWorkspace(changed, options)).rejects.toThrow("--output <fresh-directory>");
    expect(await tree(root)).toEqual(before);
    const next = await produceReadyWorkspace(changed, { ...options, outputRoot: join(root, "review") });
    expect(next.revision).not.toBe(original.revision);
    expect(next.files).not.toEqual(original.files);
    const registry = await createFilesystemWorkspaceRegistry({ registryRoot: join(config.paths.data, "workspaces") });
    const record = (await registry.open())!;
    await registry.update(record.id, record.mutationToken, { name: "Authored title" });
    const edited = await tree(root);
    await expect(produceReadyWorkspace(input, options)).rejects.toThrow("Existing files were preserved");
    expect(await tree(root)).toEqual(edited);
  });

  it("refuses partial and symlinked destinations without following or overwriting them", async () => {
    const { root, config, options } = await fixture();
    await mkdir(config.paths.data);
    await mkdir(join(config.paths.data, "workspaces"));
    await writeFile(join(config.paths.data, "workspaces", "keep.txt"), "authored");
    const before = await tree(root);
    await expect(produceReadyWorkspace(source(), options)).rejects.toThrow("Existing files were preserved");
    expect(await tree(root)).toEqual(before);
    const fresh = join(root, "fresh");
    await mkdir(fresh);
    await symlink(config.paths.data, join(fresh, "cms"), "dir");
    await expect(produceReadyWorkspace(source(), { ...options, outputRoot: fresh })).rejects.toThrow("not a real directory");
    expect(await readFile(join(config.paths.data, "workspaces", "keep.txt"), "utf8")).toBe("authored");
  });

  it("fails an invalid project before creating host output", async () => {
    const { root, options } = await fixture();
    await expect(produceReadyWorkspace({}, options)).rejects.toThrow("validation");
    expect(await readdir(root)).toEqual([]);
  });

  it.each([
    { mappingsDir: "cms/content" },
    { assetsDir: "cms/compositions/workspace-v1-initial/assets" },
  ])("refuses overlapping output or Assets settings before mutation: %j", async (settings) => {
    const { root, options } = await fixture(settings);
    await expect(produceReadyWorkspace(source(), options)).rejects.toThrow("must not overlap");
    expect(await readdir(root)).toEqual([]);
  });

  it("keeps malformed and symlinked existing release roots as dev-source failures", async () => {
    const { root } = await fixture();
    const releaseRoot = join(root, ".zudo-site-project");
    expect(await readActivatedSiteRelease({ workspaceRoot: root })).toBeNull();
    await expect(lstat(releaseRoot)).rejects.toMatchObject({ code: "ENOENT" });
    await mkdir(releaseRoot);
    await writeFile(join(releaseRoot, "foreign.txt"), "preserve");
    await expect(readActivatedSiteRelease({ workspaceRoot: root })).rejects.toThrow("Unsupported release layout");
    expect(await readFile(join(releaseRoot, "foreign.txt"), "utf8")).toBe("preserve");
    const linked = join(root, "linked-host");
    await mkdir(linked);
    await symlink(releaseRoot, join(linked, ".zudo-site-project"), "dir");
    await expect(readActivatedSiteRelease({ workspaceRoot: linked })).rejects.toThrow("Unsafe release directory");
  });
});
