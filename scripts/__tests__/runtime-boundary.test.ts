// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  checkRepository,
  findPreactDependencies,
  findPreactSpecifiers,
  isPreactPackage,
  lockRuntimeViolations,
} from "../check-runtime-boundary.mjs";

const repo = resolve(import.meta.dirname, "../..");
const scratch = mkdtempSync(join(tmpdir(), "runtime-boundary-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function lockfile(importers: string, snapshots: string): string {
  return `lockfileVersion: '9.0'\n\nimporters:\n${importers}\npackages: {}\n\nsnapshots:\n${snapshots}`;
}

const toolImporter = `
  .:
    devDependencies:
      '@takazudo/zfb':
        specifier: 7.2.0
        version: 7.2.0
      left-pad:
        specifier: ^1.0.0
        version: 1.0.0
      '@zudo-composer/ui':
        specifier: workspace:*
        version: link:packages/ui
`;

describe("Preact specifiers", () => {
  it("recognises Preact and its satellite packages only", () => {
    for (const name of ["preact", "preact-render-to-string", "@preact/preset-vite", "@preact/signals", "@testing-library/preact"]) {
      expect(isPreactPackage(name), name).toBe(true);
    }
    for (const name of ["@takazudo/zfb", "@testing-library/dom", "preactive", "react", "zudo-react"]) {
      expect(isPreactPackage(name), name).toBe(false);
    }
  });

  it("finds imports, re-exports, dynamic imports, requires and JSX import sources", () => {
    const source = [
      'import { h } from "preact";',
      "import { useState } from 'preact/hooks';",
      'export * from "preact/jsx-runtime";',
      'import "preact/debug";',
      'const r = await import("preact-render-to-string");',
      "const p = require('@preact/preset-vite');",
      'import { render } from "@testing-library/preact";',
      '{ "compilerOptions": { "jsxImportSource": "preact" } }',
      "oxc: { jsx: { importSource: 'x' } }, jsxImportSource: 'preact/compat'",
    ].join("\n");
    expect(findPreactSpecifiers(source)).toHaveLength(9);
  });

  it("allows the zudo-react runtime, prose and non-import mentions", () => {
    const source = [
      'import { signal } from "@takazudo/zfb/zudo-react";',
      'import { configure } from "@testing-library/dom";',
      "// This used to be a Preact effect.",
      'if (compiled.includes(\'from "preact\')) throw new Error("bundle kept Preact");',
      'const jsxImportSource = "@takazudo/zfb/zudo-react";',
    ].join("\n");
    expect(findPreactSpecifiers(source)).toEqual([]);
  });

  it("finds Preact in every manifest dependency field", () => {
    expect(findPreactDependencies({
      dependencies: { preact: "^10" },
      devDependencies: { "@testing-library/preact": "^3", "@testing-library/dom": "^10" },
      peerDependencies: { "@takazudo/zfb": "7.2.0" },
      optionalDependencies: { "@preact/preset-vite": "^2" },
    })).toEqual(["dependencies.preact", "devDependencies.@testing-library/preact", "optionalDependencies.@preact/preset-vite"]);
  });
});

describe("lockfile runtime graph", () => {
  it("accepts one runtime equal to the peer and ignores the separate doc graph", () => {
    const lock = lockfile(`${toolImporter}
  doc:
    dependencies:
      '@takazudo/zfb':
        specifier: 6.0.1
        version: 6.0.1
`, `
  '@takazudo/zfb@7.2.0': {}
  '@takazudo/zfb@6.0.1': {}
  left-pad@1.0.0: {}
`);
    expect(lockRuntimeViolations(lock, { peerVersion: "7.2.0" })).toEqual([]);
  });

  it("rejects a second runtime reached transitively from the tool graph", () => {
    const lock = lockfile(toolImporter, `
  '@takazudo/zfb@7.2.0': {}
  '@takazudo/zfb@6.0.1': {}
  left-pad@1.0.0:
    dependencies:
      some-engine: 2.0.0(@takazudo/zfb@6.0.1)
  some-engine@2.0.0(@takazudo/zfb@6.0.1):
    dependencies:
      '@takazudo/zfb': 6.0.1
`);
    expect(lockRuntimeViolations(lock, { peerVersion: "7.2.0" })).toEqual([
      "the tool's runtime graph resolves @takazudo/zfb@6.0.1; only the peer 7.2.0 is allowed",
    ]);
  });

  it("rejects a runtime that differs from the peer and a graph without one", () => {
    const other = lockfile(toolImporter.replaceAll("7.2.0", "7.1.0"), "\n  '@takazudo/zfb@7.1.0': {}\n  left-pad@1.0.0: {}\n");
    expect(lockRuntimeViolations(other, { peerVersion: "7.2.0" })).toEqual([
      "the tool's runtime graph resolves @takazudo/zfb@7.1.0; only the peer 7.2.0 is allowed",
    ]);
    const none = lockfile("\n  .:\n    devDependencies:\n      left-pad:\n        specifier: ^1.0.0\n        version: 1.0.0\n", "\n  left-pad@1.0.0: {}\n");
    expect(lockRuntimeViolations(none, { peerVersion: "7.2.0" })).toEqual(["the tool's runtime graph resolves no @takazudo/zfb"]);
  });

  it("rejects any Preact package in the lockfile, including the doc graph", () => {
    const lock = lockfile(`${toolImporter}
  doc:
    dependencies:
      preact:
        specifier: ^10.29.8
        version: 10.29.8
`, `
  '@takazudo/zfb@7.2.0': {}
  left-pad@1.0.0: {}
  preact@10.29.8: {}
`);
    expect(lockRuntimeViolations(lock, { peerVersion: "7.2.0" })).toEqual(["lockfile resolves preact@10.29.8"]);
  });
});

describe("repository scan", () => {
  function fixtureRepository(): string {
    const root = mkdtempSync(join(scratch, "repo-"));
    const put = (path: string, text: string) => {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    };
    put("package.json", JSON.stringify({ name: "tool", peerDependencies: { "@takazudo/zfb": "7.2.0" }, devDependencies: { "@takazudo/zfb": "7.2.0" } }));
    put("pnpm-lock.yaml", lockfile(toolImporter, "\n  '@takazudo/zfb@7.2.0': {}\n  left-pad@1.0.0: {}\n"));
    put("src/app.tsx", 'import { signal } from "@takazudo/zfb/zudo-react";\n');
    put("src/__tests__/data.test.ts", "const fixture = `import 'preact/hooks'`;\n");
    put("packages/pack/package.json", JSON.stringify({ name: "pack", peerDependencies: { "@takazudo/zfb": "7.2.0" } }));
    put("fixtures/host/package.json", JSON.stringify({ name: "host" }));
    put("styleguide/demo/package.json", JSON.stringify({ name: "sg" }));
    return root;
  }

  it("passes a clean tree, skipping test fixtures that only mention Preact as data", () => {
    expect(checkRepository(fixtureRepository())).toEqual([]);
  });

  it("fails on Preact in tool source, pack source, a manifest or a styleguide preview", () => {
    const root = fixtureRepository();
    writeFileSync(join(root, "src/app.tsx"), 'import { h } from "preact";\n');
    mkdirSync(join(root, "packages/pack/components"), { recursive: true });
    writeFileSync(join(root, "packages/pack/components/card.tsx"), 'export { useState } from "preact/hooks";\n');
    writeFileSync(join(root, "fixtures/host/package.json"), JSON.stringify({ name: "host", devDependencies: { preact: "^10" } }));
    mkdirSync(join(root, "styleguide/demo/preview"), { recursive: true });
    writeFileSync(join(root, "styleguide/demo/preview/entry.ts"), 'import { render } from "preact";\n');
    expect(checkRepository(root)).toEqual([
      'src/app.tsx: from "preact"',
      'packages/pack/components/card.tsx: from "preact/hooks"',
      'styleguide/demo/preview/entry.ts: from "preact"',
      "fixtures/host/package.json: devDependencies.preact",
    ]);
  });

  it("keeps the real root lockfile on one runtime equal to the tool peer", () => {
    const manifest = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
    expect(lockRuntimeViolations(readFileSync(join(repo, "pnpm-lock.yaml"), "utf8"), { peerVersion: manifest.peerDependencies["@takazudo/zfb"] })).toEqual([]);
  });
});
