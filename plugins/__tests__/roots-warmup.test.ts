import { readFileSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_ENTRY, APP_ROOT, resolveAppWarmupFiles } from "../roots.mjs";

describe("resolveAppWarmupFiles()", () => {
  it("expands the package source tree into absolute files while retaining its exclusions", () => {
    const files = resolveAppWarmupFiles();

    expect(files).not.toHaveLength(0);
    expect(files.every((file) => isAbsolute(file))).toBe(true);
    expect(files.every((file) => statSync(file).isFile())).toBe(true);
    expect(files).toContain(resolve(APP_ROOT, APP_ENTRY));

    const relativePaths = files.map((file) => relative(APP_ROOT, file).split(sep).join("/"));
    expect(relativePaths.some((file) => file.split("/").includes("__tests__"))).toBe(false);
    expect(relativePaths.some((file) => file.split("/").includes("test-support"))).toBe(false);

    expect(relativePaths.some((file) => /\.(?:test|spec)\.[^/]+$/.test(file))).toBe(false);

    // A test library in the warmup graph is found only after Vite's entry scan,
    // which re-runs the optimizer and full-reloads open pages (#703).
    const testImport = /from\s+["'](?:vitest|@vitest\/[^"']+|@testing-library\/[^"']+)["']/;
    expect(files.filter((file) => testImport.test(readFileSync(file, "utf8"))).map((file) => relative(APP_ROOT, file))).toEqual([]);

    for (const excludedTree of ["src/test", "src/hosted-demo", "server/site-build/client"]) {
      expect(relativePaths.some((file) => file === excludedTree || file.startsWith(`${excludedTree}/`))).toBe(false);
    }
  });
});
