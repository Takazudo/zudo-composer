import { execFile } from "node:child_process";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { seedRelease } from "../../../packages/demo-tools/src/seed";
import { APP_ROOT } from "../../../plugins/roots.mjs";
import type { SeedSiteProjectResult } from "../../site-project-local/seed";

const run = promisify(execFile);
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function installedHost() {
  const temporary = await realpath(await mkdtemp(join(tmpdir(), "seed-installed-cli-")));
  directories.push(temporary);
  const host = join(temporary, "host with spaces");
  const tool = join(host, "node_modules/zudo-composer");
  await mkdir(tool, { recursive: true });
  // A copied installation exercises Node's node_modules TypeScript boundary;
  // a symlink back to the checkout would not exercise that constraint.
  for (const name of ["package.json", "bin", "plugins", "server", "src"]) {
    await cp(join(APP_ROOT, name), join(tool, name), {
      recursive: true,
      filter: (path) => !relative(APP_ROOT, path).split(sep).some((part) => ["node_modules", "__tests__", "type-tests"].includes(part)),
    });
  }
  await symlink(join(APP_ROOT, "node_modules"), join(tool, "node_modules"), "dir");
  for (const name of ["@zudo-sg", "preact"]) {
    await symlink(join(APP_ROOT, "node_modules", name), join(host, "node_modules", name), "dir");
  }
  for (const file of ["zudo-composer.config.ts", "styles/base.css"]) {
    await cp(join(APP_ROOT, "fixtures/host", file), join(host, file));
  }
  const manifest = JSON.parse(await readFile(join(APP_ROOT, "package.json"), "utf8"));
  await writeFile(join(host, "package.json"), JSON.stringify({
    name: "seed-installed-host", version: "0.0.0", private: true, type: "module",
    devDependencies: { "zudo-composer": manifest.version, "@zudo-sg/ui": manifest.devDependencies["@zudo-sg/ui"], preact: manifest.peerDependencies.preact },
  }));
  const source = await readFile(join(APP_ROOT, "src/test/site-project-fixture.json"), "utf8");
  const env = { ...process.env };
  for (const name of ["ZUDO_SITE_PROJECT_ROOT", "ZUDO_ASSETS_STORE_ROOT", "ZUDO_DATA_ROOT"]) delete env[name];
  const bin = join(tool, "bin/zudo-composer.mjs");
  const cli = (cwd: string, args: string[], environment = env) => run(process.execPath, [bin, ...args], { cwd, env: environment, encoding: "utf8", timeout: 25_000 });
  return { temporary, host, tool, source, cli, env };
}

async function releaseFiles(root: string): Promise<unknown> {
  const files: unknown[] = [];
  for (const name of (await readdir(root)).sort()) {
    const path = join(root, name);
    const stat = await lstat(path);
    files.push(stat.isDirectory() ? [name, await releaseFiles(path)] : [name, stat.mtimeMs, stat.ctimeMs, await readFile(path, "utf8")]);
  }
  return files;
}

describe("installed seed command", () => {
  it("activates the default committed project, makes demo seeding a no-op, and resolves --from relative to its caller", async () => {
    const { temporary, host, tool, source, cli, env } = await installedHost();
    const releaseRoot = join(host, ".zudo-site-project");
    await writeFile(join(host, "site-project.json"), source);
    await expect(lstat(releaseRoot)).rejects.toMatchObject({ code: "ENOENT" });
    const first = await cli(host, ["seed"]);
    expect(first.stderr).toBe("");
    const active = JSON.parse(first.stdout) as SeedSiteProjectResult;
    expect(active).toMatchObject({ projectId: JSON.parse(source).id, status: "activated", revision: expect.stringMatching(/^[a-f0-9]{64}$/), buildId: expect.stringMatching(/^[a-f0-9]{64}$/) });
    const before = await releaseFiles(releaseRoot);
    // This is the actual demo wrapper calling the installed verb, not an API
    // request mock. It must see the same release and leave every file intact.
    expect(await seedRelease(host, { env })).toEqual({ ...active, status: "unchanged" });
    expect(await releaseFiles(releaseRoot)).toEqual(before);

    const updated = { ...JSON.parse(source), name: "Explicit committed source" };
    await writeFile(join(temporary, "another project.json"), JSON.stringify(updated));
    const explicit = await cli(temporary, ["seed", "--root", relative(temporary, host), "--from", "another project.json"]);
    expect(explicit.stderr).toBe("");
    const next = JSON.parse(explicit.stdout) as SeedSiteProjectResult;
    expect(next).toMatchObject({ projectId: active.projectId, status: "activated" });
    expect(next.revision).not.toBe(active.revision);
    const repeated = await cli(temporary, ["seed", "--from", "another project.json", "--root", relative(temporary, host)]);
    expect(JSON.parse(repeated.stdout)).toEqual({ ...next, status: "unchanged" });
    await expect(lstat(join(temporary, ".zudo-site-project"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(join(tool, ".zudo-site-project"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(host, "site-project.json"), "utf8")).toBe(source);
  });

  it("reports missing/invalid committed files without creating release state, and honors the browser lane's disposable root", async () => {
    const { temporary, host, source, cli, env } = await installedHost();
    const releaseRoot = join(host, ".zudo-site-project");
    await expect(cli(host, ["seed"])).rejects.toMatchObject({ code: 1, stdout: "", stderr: expect.stringContaining("site-project.json") });
    await writeFile(join(host, "site-project.json"), "{}");
    await expect(cli(host, ["seed"])).rejects.toMatchObject({ code: 1, stdout: "", stderr: expect.stringContaining("validation") });
    await writeFile(join(host, "site-project.json"), "{not json");
    await expect(cli(host, ["seed"])).rejects.toMatchObject({ code: 1, stdout: "", stderr: expect.stringContaining("seed failed:") });
    await expect(lstat(releaseRoot)).rejects.toMatchObject({ code: "ENOENT" });

    const from = join(temporary, "fixture.json");
    const disposableRoot = join(temporary, "browser-release");
    await writeFile(from, source);
    const seeded = await cli(host, ["seed", "--from", from], {
      ...env, ZUDO_SITE_PROJECT_ROOT: disposableRoot, ZUDO_ASSETS_STORE_ROOT: join(temporary, "browser-assets"), ZUDO_DATA_ROOT: join(temporary, "browser-data"),
    });
    expect(JSON.parse(seeded.stdout).status).toBe("activated");
    expect(await readdir(disposableRoot)).toContain("heads.json");
    await expect(lstat(releaseRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
