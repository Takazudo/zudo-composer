import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "gen-composer-pack.mjs");
let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "gen-composer-pack-"));
  mkdirSync(join(sandbox, "scripts"), { recursive: true });
  mkdirSync(join(sandbox, "packages/ui/src"), { recursive: true });
  copyFileSync(SCRIPT, join(sandbox, "scripts/gen-composer-pack.mjs"));
});

afterEach(() => rmSync(sandbox, { recursive: true, force: true }));

function sidecar(path: string, exportName: string) {
  const target = join(sandbox, "packages/ui/src", path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(
    target,
    `import { defineComponent } from "@zudo-composer/component-contract";\nexport const ${exportName} = defineComponent({});\n`,
  );
}

function run(...args: string[]) {
  return spawnSync(process.execPath, [join(sandbox, "scripts/gen-composer-pack.mjs"), ...args], {
    cwd: sandbox,
    encoding: "utf8",
  });
}

describe("gen-composer-pack", () => {
  it("recursively discovers sidecars in deterministic path order", () => {
    sidecar("z/z.composer.tsx", "zComposer");
    sidecar("a/deep/a.composer.tsx", "aComposer");
    expect(run().status).toBe(0);
    const output = readFileSync(join(sandbox, "packages/ui/src/composer-pack.ts"), "utf8");
    expect(output.indexOf("aComposer as aDeepA")).toBeLessThan(output.indexOf("zComposer as zZ"));
    expect(output).toContain('packId: "@zudo-sg/ui"');
    expect(output).toContain('packVersion: "1.0.0"');
  });

  it("is idempotent and --check detects drift without rewriting it", () => {
    sidecar("a/a.composer.tsx", "aComposer");
    expect(run().status).toBe(0);
    expect(run().stdout).toContain("already up to date");
    const output = join(sandbox, "packages/ui/src/composer-pack.ts");
    writeFileSync(output, "drift\n");
    const check = run("--check");
    expect(check.status).toBe(1);
    expect(readFileSync(output, "utf8")).toBe("drift\n");
  });

  it("fails before writing when a sidecar has no unique definition export", () => {
    sidecar("a/a.composer.tsx", "aComposer");
    sidecar("bad/bad.composer.tsx", "badComposer");
    const bad = join(sandbox, "packages/ui/src/bad/bad.composer.tsx");
    writeFileSync(bad, `${readFileSync(bad, "utf8")}export const otherComposer = defineComponent({});\n`);
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("must export exactly one");
    expect(() => readFileSync(join(sandbox, "packages/ui/src/composer-pack.ts"))).toThrow();
  });

  it("reports generated identifier collisions", () => {
    sidecar("foo-bar/baz.composer.tsx", "oneComposer");
    sidecar("foo/bar-baz.composer.tsx", "twoComposer");
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("collide on generated identifier");
  });
});
