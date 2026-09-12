import { execFile } from "node:child_process";
import { cp, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import { APP_ROOT } from "../../../plugins/roots.mjs";
import type { ReadyWorkspaceResult } from "../ready-workspace";

const run = promisify(execFile);
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function installedHost() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "ready-workspace-installed-")));
  roots.push(root);
  const host = join(root, "host with spaces"), tool = join(host, "node_modules/zudo-composer");
  await mkdir(tool, { recursive: true });
  // A physical installed tool exercises evaluation of TypeScript inside
  // node_modules. Dependencies are reused; the manager owns the packed gate.
  for (const name of ["package.json", "bin", "plugins", "server", "src"]) {
    await cp(join(APP_ROOT, name), join(tool, name), { recursive: true,
      filter: (path) => !relative(APP_ROOT, path).split(sep).some((part) => ["node_modules", "__tests__", "type-tests"].includes(part)),
    });
  }
  await symlink(join(APP_ROOT, "node_modules"), join(tool, "node_modules"), "dir");
  for (const name of ["@zudo-sg", "preact"]) await symlink(join(APP_ROOT, "node_modules", name), join(host, "node_modules", name), "dir");
  const manifest = JSON.parse(await readFile(join(APP_ROOT, "package.json"), "utf8"));
  await writeFile(join(host, "package.json"), JSON.stringify({ name: "ready-workspace-host", type: "module", devDependencies: { "@zudo-sg/ui": manifest.devDependencies["@zudo-sg/ui"], preact: manifest.peerDependencies.preact } }));
  await writeFile(join(host, "zudo-composer.config.ts"), 'import { defineComposerConfig } from "zudo-composer/config";\nexport default defineComposerConfig({ pack: "@zudo-sg/ui/composer-pack", dataDir: "data/cms", contentDir: "editor/content", assetsDir: "library/assets" });\n');
  const source = await readFile(join(APP_ROOT, "packages/demo-studio/site-project.json"), "utf8");
  const env = { ...process.env, ZUDO_SITE_PROJECT_ROOT: join(root, "unused-release-override"), ZUDO_ASSETS_STORE_ROOT: join(root, "unused-assets-override") };
  for (const key of Object.keys(env)) if (key.startsWith("ZUDO_COMPOSER_")) delete env[key as keyof typeof env];
  const invoke = (cwd: string, args: string[]) => run(process.execPath, [join(tool, "bin/zudo-composer.mjs"), "seed", "--ready-workspace", ...args], { cwd, env, encoding: "utf8", timeout: 25_000 });
  return { root, host, tool, source, invoke, env };
}

it("runs the installed ready mode with configured roots, unchanged reruns, and caller-relative fresh output/source", async () => {
  const { root, host, tool, source, invoke, env } = await installedHost();
  await writeFile(join(host, "site-project.json"), source);
  const first = await invoke(host, []);
  expect(first.stderr).toBe("");
  const generated = JSON.parse(first.stdout) as ReadyWorkspaceResult;
  expect(generated).toMatchObject({ status: "created", workspaceId: "initial" });
  expect(generated.directories).toContain("editor/content/workspace-v1-initial");
  expect(generated.directories).toContain("data/cms/workspaces");
  const before = await Promise.all(generated.files.map(async ({ path }) => ({ path, bytes: await readFile(join(host, path)), stat: await lstat(join(host, path)) })));
  expect(JSON.parse((await invoke(host, [])).stdout)).toEqual({ ...generated, status: "unchanged" });
  for (const file of before) {
    expect(await readFile(join(host, file.path))).toEqual(file.bytes);
    const info = await lstat(join(host, file.path));
    expect([info.mtimeMs, info.ctimeMs]).toEqual([file.stat.mtimeMs, file.stat.ctimeMs]);
  }
  await writeFile(join(root, "changed project.json"), JSON.stringify({ ...JSON.parse(source), name: "Changed committed source" }));
  const fresh = JSON.parse((await invoke(root, ["--root", relative(root, host), "--from", "changed project.json", "--output", "review tree"])).stdout) as ReadyWorkspaceResult;
  expect(fresh.status).toBe("created");
  expect(fresh.revision).not.toBe(generated.revision);
  expect(fresh.files).toEqual(expect.arrayContaining([expect.objectContaining({ path: expect.stringMatching(/^editor\/content\//) })]));
  await expect(invoke(root, ["--root", relative(root, host), "--from", "changed project.json"]))
    .rejects.toMatchObject({ code: 1, stdout: "", stderr: expect.stringContaining("Existing files were preserved") });
  for (const path of [join(host, ".zudo-site-project"), join(tool, ".zudo-site-project"), env.ZUDO_SITE_PROJECT_ROOT, env.ZUDO_ASSETS_STORE_ROOT, join(host, "cms"), join(tool, "cms")]) {
    await expect(lstat(path)).rejects.toMatchObject({ code: "ENOENT" });
  }
  expect(await readFile(join(host, "site-project.json"), "utf8")).toBe(source);
});

it("reports missing or invalid ready input without creating host CMS", async () => {
  const { host, invoke } = await installedHost();
  await expect(invoke(host, [])).rejects.toMatchObject({ code: 1, stdout: "", stderr: expect.stringContaining("site-project.json") });
  await writeFile(join(host, "site-project.json"), "{}");
  await expect(invoke(host, [])).rejects.toMatchObject({ code: 1, stdout: "", stderr: expect.stringContaining("validation") });
  await expect(lstat(join(host, "data"))).rejects.toMatchObject({ code: "ENOENT" });
});
