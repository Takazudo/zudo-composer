// A disposable copy of the Blog demo host, served by the real `zudo-composer
// dev` command. Nothing is written under packages/demo-blog.
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repository = resolve(import.meta.dirname, "../..");

export async function startBlogHost({ port }) {
  const parent = await realpath(await mkdtemp(join(tmpdir(), "zc-blog-editorial-")));
  const host = join(parent, "demo-blog");
  await cp(join(repository, "packages/demo-blog"), host, { recursive: true, filter: (source) => !source.includes(`${join("demo-blog", "node_modules")}`) && !source.includes("dist-") });
  await mkdir(join(host, "node_modules/@zudo-composer"), { recursive: true });
  await symlink(repository, join(host, "node_modules/zudo-composer"), "dir");
  await symlink(join(repository, "packages/component-contract"), join(host, "node_modules/@zudo-composer/component-contract"), "dir");
  await symlink(await realpath(join(repository, "packages/demo-blog/node_modules/preact")), join(host, "node_modules/preact"), "dir");
  const child = spawn(process.execPath, [join(repository, "bin/zudo-composer.mjs"), "dev", "--root", host, "--port", String(port), "--strict-port"], { cwd: host, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, BROWSER: "none" } });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const origin = `http://localhost:${port}`;
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`dev server exited:\n${output}`);
    if (/Local:\s+http/.test(output)) break;
    if (Date.now() > deadline) throw new Error(`dev server did not start:\n${output}`);
    await new Promise((done) => setTimeout(done, 500));
  }
  return {
    origin, host, output: () => output,
    async stop() {
      child.kill("SIGTERM");
      await new Promise((done) => { if (child.exitCode !== null) done(); else child.once("exit", done); });
      await rm(parent, { recursive: true, force: true });
    },
  };
}
