import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SHA = "fe3fc62d3f677f321f5eb7814240d4a55dc92cd0";
const TREE = "96a42a59cf4d05078ba85e7a0ccdb7d7765d29cc";
const SPEC = `git+https://github.com/Takazudo/zudo-sg.git#${SHA}`;

describe("immutable UI provider dependency", () => {
  it("pins the advertised Git spec and one workspace component contract", () => {
    const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies["@zudo-sg/ui"]).toBe(SPEC);
    expect(pkg.dependencies["@zudo-composer/component-contract"]).toBe("workspace:*");
    expect(pkg.dependencies["@zudo-sg/ui"]).not.toMatch(/(?:^|:)(?:file|link|path):|\.\.|packages\/ui/);
  });

  it("normalizes the lock to the exact full commit without local path leakage", () => {
    const lock = readFileSync(resolve("pnpm-lock.yaml"), "utf8");
    const escaped = SHA.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    expect(lock).toMatch(new RegExp(`specifier: git\\+https://github\\.com/Takazudo/zudo-sg\\.git#${escaped}`));
    const tarballMatches = [...lock.matchAll(/https:\/\/codeload\.github\.com\/Takazudo\/zudo-sg\/tar\.gz\/([a-f0-9]{40})/g)];
    expect(new Set(tarballMatches.map((match) => match[1]))).toEqual(new Set([SHA]));
    expect(lock).toContain("version: 0.1.0");
    expect(lock).not.toMatch(/@zudo-sg\/ui[^\n]*(?:file:|link:|path:|\.\.\/)/);
    expect(lock).toContain("@zudo-composer/component-contract@packages+component-contract");
  });

  it("records the independently verified immutable provider tree", () => {
    expect({ commit: SHA, tree: TREE }).toEqual({
      commit: "fe3fc62d3f677f321f5eb7814240d4a55dc92cd0",
      tree: "96a42a59cf4d05078ba85e7a0ccdb7d7765d29cc",
    });
  });
});
