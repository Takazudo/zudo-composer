import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { UI_PACK } from "../../scripts/ui-pack-identity.mjs";
import { PREACT_DEV_ENTRIES, componentPackNestedIncludes, devPrebundleIncludes } from "../dev-prebundle.mjs";

const repoRoot = resolve(".");
const themesetHost = resolve("fixtures/themeset-host");

describe("devPrebundleIncludes", () => {
  it("always includes the preset-injected dev entries and compiled JSX's runtime", () => {
    expect(PREACT_DEV_ENTRIES).toEqual(["preact/debug", "preact/devtools", "preact/jsx-runtime"]);
    expect(devPrebundleIncludes({ workspaceRoot: themesetHost, pack: "@zudo-composer/fixture-themeset/composer-pack" })).toEqual(
      expect.arrayContaining([...PREACT_DEV_ENTRIES]),
    );
  });

  it("derives the nested includes from the owned UI pack's own dependencies", () => {
    const includes = componentPackNestedIncludes({ workspaceRoot: repoRoot, pack: "@zudo-composer/ui/composer-pack" });
    // packages/ui's package.json lists exactly these two runtime dependencies.
    expect(includes.sort()).toEqual([`${UI_PACK.packageName} > @takazudo/zfb-md-wasm`, `${UI_PACK.packageName} > dompurify`].sort());
  });

  it("omits an excluded dependency, e.g. the glue/wasm package that must stay unbundled", () => {
    const includes = componentPackNestedIncludes({
      workspaceRoot: repoRoot,
      pack: "@zudo-composer/ui/composer-pack",
      exclude: ["@takazudo/zfb-md-wasm"],
    });
    expect(includes).toEqual([`${UI_PACK.packageName} > dompurify`]);
  });

  it("yields no nested entries for a pack with no runtime dependencies", () => {
    expect(componentPackNestedIncludes({ workspaceRoot: themesetHost, pack: "@zudo-composer/fixture-themeset/composer-pack" })).toEqual([]);
  });

  it("never nests what the tool itself provides, for a pack that is the host itself", () => {
    // The creator's output: the pack is the host's own `./components` export,
    // and the host lists the tool, the contract and preact as dependencies.
    const host = mkdtempSync(join(tmpdir(), "zc-prebundle-host-"));
    try {
      mkdirSync(join(host, "components"));
      writeFileSync(join(host, "components", "pack.ts"), "export {};\n");
      writeFileSync(
        join(host, "package.json"),
        JSON.stringify({
          name: "generated-host",
          type: "module",
          exports: { "./components": "./components/pack.ts" },
          dependencies: { "zudo-composer": "0.0.0", "@zudo-composer/component-contract": "1.0.0", preact: "10.0.0", "left-pad": "1.3.0" },
        }),
      );
      expect(componentPackNestedIncludes({ workspaceRoot: host, pack: "generated-host/components" })).toEqual(["generated-host > left-pad"]);
    } finally {
      rmSync(host, { recursive: true, force: true });
    }
  });

  it("yields no nested entries when the pack cannot be resolved", () => {
    expect(componentPackNestedIncludes({ workspaceRoot: repoRoot, pack: "@acme/not-installed/composer-pack" })).toEqual([]);
    expect(devPrebundleIncludes({ workspaceRoot: repoRoot, pack: "@acme/not-installed/composer-pack" })).toEqual(PREACT_DEV_ENTRIES);
  });
});
