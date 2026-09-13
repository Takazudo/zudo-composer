// @vitest-environment node

import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkSampleProject, SAMPLE_PROJECT_PATH, SAMPLE_PROJECT_MODULES } from "../check-sample-project.mjs";

const root = resolve(import.meta.dirname, "../..");
const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "sample-project-check-"));
  temporary.push(directory);
  const host = join(directory, "packages/demo-sample");
  await mkdir(host, { recursive: true });
  for (const file of ["package.json", "zudo-composer.config.ts", "site-project.ts", "site-project.json", "content", "styles"]) {
    await cp(join(root, "packages/demo-sample", file), join(host, file), { recursive: true });
  }
  await symlink(join(root, "packages/demo-sample/node_modules"), join(host, "node_modules"), "dir");
  for (const file of SAMPLE_PROJECT_MODULES) {
    await mkdir(dirname(join(directory, file)), { recursive: true });
    await cp(join(root, file), join(directory, file));
  }
  return directory;
}

describe("shared sample project guard", () => {
  it("checks the actual repository and runs before editor builds and the main gate", async () => {
    await checkSampleProject(root);
    const { scripts, files } = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    expect(scripts["sample:check"]).toBe("node scripts/check-sample-project.mjs");
    expect(scripts.check).toContain("pnpm sample:check &&");
    expect(scripts["build:hosted-demo"]).toBeUndefined();
    expect(scripts["demo:build-editor"]).toMatch(/^pnpm sample:check && node /);
    expect(scripts["demo:build-editors"]).toMatch(/^pnpm sample:check && node /);
    expect(files).toContain("!src/test");
    expect(files).toContain("!src/hosted-demo");
    expect(files.filter((file: string) => file === "packages" || file.startsWith("packages/demo-sample"))).toEqual([]);
  });

  it("rejects a hand-edited generated copy through the installed generator without rewriting it", async () => {
    const directory = await fixture();
    await checkSampleProject(directory);
    const path = join(directory, SAMPLE_PROJECT_PATH);
    const project = JSON.parse(await readFile(path, "utf8"));
    project.name = "Hand-edited derived JSON";
    const edited = `${JSON.stringify(project)}\n`;
    await writeFile(path, edited);
    await expect(checkSampleProject(directory)).rejects.toThrow(/site-project\.json.*is stale/);
    expect(await readFile(path, "utf8")).toBe(edited);
  });

  it.each(["src/test/site-project-fixture.json", "src/hosted-demo/sample-project.json"])("rejects a restored duplicate at %s", async (file) => {
    const directory = await fixture();
    await cp(join(directory, SAMPLE_PROJECT_PATH), join(directory, file));
    await expect(checkSampleProject(directory)).rejects.toThrow(`Retired sample project copy must not exist: ${file}`);
  });

  it("rejects a renamed sample copy even when its bytes have drifted", async () => {
    const directory = await fixture();
    const project = JSON.parse(await readFile(join(directory, SAMPLE_PROJECT_PATH), "utf8"));
    project.name = "Another private copy";
    await writeFile(join(directory, "another-sample.json"), JSON.stringify(project));
    await expect(checkSampleProject(directory)).rejects.toThrow(/exactly one generated JSON source/);
  });

  it.each(["src/test/site-project-fixture.ts", "src/hosted-demo/bootstrap.ts"])("rejects a dynamic load in %s even with the static import in a comment", async (file) => {
    const directory = await fixture();
    const path = join(directory, file);
    const source = await readFile(path, "utf8");
    const importLine = source.split("\n").find((line) => line.includes("demo-sample/site-project.json") || line.includes("virtual:demo-editor-project"))!;
    const specifier = importLine.match(/from "([^"]+)"/)![1];
    await writeFile(path, `// ${importLine}\nconst sample = await import(${JSON.stringify(specifier)});\nexport default sample;\n`);
    await expect(checkSampleProject(directory)).rejects.toThrow(/must statically import.*bundled module/);
  });

  it.each(["src/hosted-demo/bootstrap.ts", "vite.demo-editor.config.ts"])("rejects a fixed project import alongside the host selection in %s", async (file) => {
    const directory = await fixture();
    const path = join(directory, file);
    const source = await readFile(path, "utf8");
    await writeFile(path, `${source}\nimport fixedProject from "./packages/demo-sample/site-project.json";\n`);
    await expect(checkSampleProject(directory)).rejects.toThrow(/not import a fixed project JSON/);
  });

  it.each([
    'export { default as fixedProject } from "./packages/demo-sample/site-project.json?raw";',
    'const fixedProject = await import(`./packages/demo-sample/site-project.json`);',
  ])("rejects fixed projects behind Vite queries and literal dynamic imports: %s", async (statement) => {
    const directory = await fixture();
    const path = join(directory, "vite.demo-editor.config.ts");
    await writeFile(path, `${await readFile(path, "utf8")}\n${statement}\n`);
    await expect(checkSampleProject(directory)).rejects.toThrow(/not import a fixed project JSON/);
  });

  it("ignores editor artifacts when checking for duplicate source JSON", async () => {
    const directory = await fixture();
    await mkdir(join(directory, "packages/demo-sample/dist-editor"));
    await cp(join(directory, SAMPLE_PROJECT_PATH), join(directory, "packages/demo-sample/dist-editor/site-project.json"));
    await checkSampleProject(directory);
  });
});
