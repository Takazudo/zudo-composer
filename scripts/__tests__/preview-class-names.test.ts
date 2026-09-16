// @vitest-environment node
import { execFile } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
// Inside the preview's own spec directory, so the file the gate reads sits
// where a real canvas spec would.
const probe = join(root, "src/features/composer/preview/__tests__/class-name-gate-probe.test.ts");

const gate = () =>
  promisify(execFile)(process.execPath, [join(root, "scripts/check-class-names.mjs")], {
    cwd: root,
    encoding: "utf8",
    timeout: 60_000,
  });

afterEach(async () => { await rm(probe, { force: true }); });

// Since #717 the preview entry no longer imports `base.css`, so the canvas
// sheet is reachable only from the preview graph. The gate collects class
// names by walking `src/**/*.css` on disk rather than any import graph, so
// `zc-*` must keep counting as tool-owned — never as an unknown pack name.
it("keeps the canvas classes of the isolated preview sheet in the known-name universe", async () => {
  expect((await gate()).stdout).toContain("Class-name gate passed");

  await writeFile(
    probe,
    ['it("names canvas chrome", () => {',
     '  document.querySelector(".zc-canvas .zc-node .zc-chrome .zc-insert-group .zc-prose-savebar");',
     "});", ""].join("\n"),
  );
  expect((await gate()).stdout).toContain("Class-name gate passed");

  await writeFile(probe, 'it("names a retired class", () => {\n  document.querySelector(".zc-retired-canvas");\n});\n');
  await expect(gate()).rejects.toThrow("zc-retired-canvas");
});
