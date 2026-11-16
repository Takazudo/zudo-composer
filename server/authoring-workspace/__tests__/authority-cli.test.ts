import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";

it("refuses generate and seed before reading historical source or writing workspace data", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspace-authority-cli-"));
  try {
    await cp(resolve("fixtures/edit-host"), root, { recursive: true });
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "native-edit-host", type: "module", exports: { "./components": "./components/pack.mjs" } }));
    await mkdir(join(root, "node_modules/@zudo-composer"), { recursive: true });
    for (const name of ["preact", "@zudo-composer/component-contract"]) await symlink(resolve("node_modules", name), join(root, "node_modules", name), "dir");
    await writeFile(join(root, "zudo-composer.config.ts"), 'export default { pack: "native-edit-host/components", authoringAuthority: "workspace" };\n');
    await writeFile(join(root, "site-project.ts"), 'throw new Error("Historical source was evaluated");\n');
    await writeFile(join(root, "site-project.json"), "historical input must remain unchanged\n");
    for (const command of ["generate", "seed"]) {
      await expect(promisify(execFile)(process.execPath, [resolve("bin/zudo-composer.mjs"), command], { cwd: root, encoding: "utf8" }))
        .rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("Native workspace authority forbids") });
    }
    expect(await readFile(join(root, "site-project.json"), "utf8")).toBe("historical input must remain unchanged\n");
    await expect(readFile(join(root, "cms/workspaces/current.json"))).rejects.toMatchObject({ code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});
