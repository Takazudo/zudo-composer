import { statSync } from "node:fs";
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

    for (const excludedTree of ["src/__tests__", "src/hosted-demo", "src/site-static"]) {
      expect(files.some((file) => {
        const relativePath = relative(APP_ROOT, file).split(sep).join("/");
        return relativePath === excludedTree || relativePath.startsWith(`${excludedTree}/`);
      })).toBe(false);
    }
  });
});
