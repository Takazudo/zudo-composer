// @vitest-environment node

import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkStudioSample, STUDIO_PROJECT_PATH, STUDIO_SAMPLE_MODULES } from "../check-studio-sample.mjs";

const root = resolve(import.meta.dirname, "../..");
const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "studio-sample-check-"));
  temporary.push(directory);
  const host = join(directory, "packages/demo-studio");
  await mkdir(host, { recursive: true });
  for (const file of ["package.json", "zudo-composer.config.ts", "site-project.ts", "site-project.json", "content", "styles"]) {
    await cp(join(root, "packages/demo-studio", file), join(host, file), { recursive: true });
  }
  await symlink(join(root, "packages/demo-studio/node_modules"), join(host, "node_modules"), "dir");
  for (const file of STUDIO_SAMPLE_MODULES) {
    await mkdir(dirname(join(directory, file)), { recursive: true });
    await cp(join(root, file), join(directory, file));
  }
  return directory;
}

describe("shared studio sample guard", () => {
  it("checks the actual repository and runs before hosted builds and the main gate", async () => {
    await checkStudioSample(root);
    const { scripts, files } = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    expect(scripts["studio:check"]).toBe("node scripts/check-studio-sample.mjs");
    expect(scripts.check).toContain("pnpm studio:check &&");
    expect(scripts["build:hosted-demo"]).toMatch(/^pnpm studio:check && vite build /);
    expect(files).toContain("!src/test");
    expect(files).toContain("!src/hosted-demo");
    expect(files.filter((file: string) => file === "packages" || file.startsWith("packages/demo-studio"))).toEqual([]);
  });

  it("rejects a hand-edited generated copy through the installed generator without rewriting it", async () => {
    const directory = await fixture();
    await checkStudioSample(directory);
    const path = join(directory, STUDIO_PROJECT_PATH);
    const project = JSON.parse(await readFile(path, "utf8"));
    project.name = "Hand-edited derived JSON";
    const edited = `${JSON.stringify(project)}\n`;
    await writeFile(path, edited);
    await expect(checkStudioSample(directory)).rejects.toThrow(/site-project\.json.*is stale/);
    expect(await readFile(path, "utf8")).toBe(edited);
  });

  it.each(["src/test/site-project-fixture.json", "src/hosted-demo/sample-project.json"])("rejects a restored duplicate at %s", async (file) => {
    const directory = await fixture();
    await cp(join(directory, STUDIO_PROJECT_PATH), join(directory, file));
    await expect(checkStudioSample(directory)).rejects.toThrow(`Retired studio sample copy must not exist: ${file}`);
  });

  it("rejects a renamed sample copy even when its bytes have drifted", async () => {
    const directory = await fixture();
    const project = JSON.parse(await readFile(join(directory, STUDIO_PROJECT_PATH), "utf8"));
    project.name = "Another private copy";
    await writeFile(join(directory, "another-sample.json"), JSON.stringify(project));
    await expect(checkStudioSample(directory)).rejects.toThrow(/exactly one generated JSON source/);
  });

  it.each(STUDIO_SAMPLE_MODULES)("rejects a dynamic load in %s even with the static import in a comment", async (file) => {
    const directory = await fixture();
    const path = join(directory, file);
    const source = await readFile(path, "utf8");
    const importLine = source.split("\n").find((line) => line.includes("demo-studio/site-project.json"))!;
    const specifier = importLine.match(/from "([^"]+)"/)![1];
    await writeFile(path, `// ${importLine}\nconst sample = await import(${JSON.stringify(specifier)});\nexport default sample;\n`);
    await expect(checkStudioSample(directory)).rejects.toThrow(/must statically import.*bundled module/);
  });
});
