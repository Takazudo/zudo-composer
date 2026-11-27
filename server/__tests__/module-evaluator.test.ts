import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createModuleEvaluator } from "../module-evaluator.mjs";

describe("isolated host document JSX runtime", () => {
  it("does not reuse the tool's zudo-react component graph for a differently configured host renderer", async () => {
    const root = await mkdtemp(join(tmpdir(), "composer-host-jsx-"));
    try {
      await writeFile(join(root, "package.json"), JSON.stringify({ type: "module" }));
      for (const [name, prefix] of [["@takazudo/zfb", "./zudo-react"], ["host-runtime", "."]] as const) {
        const directory = join(root, "node_modules", name);
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, "package.json"), JSON.stringify({ name, type: "module", exports: { [`${prefix}/jsx-runtime`]: "./jsx.js", [`${prefix}/jsx-dev-runtime`]: "./jsx.js" } }));
        await writeFile(join(directory, "jsx.js"), `export const jsx = (type, props) => ({runtime:${JSON.stringify(name)},type,props}); export const jsxs=jsx; export const jsxDEV=jsx;`);
      }
      await writeFile(join(root, "child.tsx"), 'export const child = <span>Actual host child</span>;');
      await writeFile(join(root, "renderer.tsx"), 'import { child } from "./child"; export const document = <main>{child}</main>;');
      const entry = join(root, "renderer.tsx");
      const tool = await createModuleEvaluator(root)(entry);
      const host = await createModuleEvaluator(root, { jsxImportSource: "host-runtime" })(entry);
      const toolAgain = await createModuleEvaluator(root)(entry);
      expect(tool.document).toMatchObject({ runtime: "@takazudo/zfb", props: { children: { runtime: "@takazudo/zfb" } } });
      expect(host.document).toMatchObject({ runtime: "host-runtime", props: { children: { runtime: "host-runtime" } } });
      expect(toolAgain.document).toEqual(tool.document);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
