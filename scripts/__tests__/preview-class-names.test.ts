// @vitest-environment node
import { execFile } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
// A plain module inside the preview's own spec directory: `check-class-names.mjs`
// treats every file under a `__tests__/` directory as a spec, while vitest
// collects only `*.test.ts`, so a probe left behind by a hard kill cannot turn
// into a failing test.
const probe = join(root, "src/features/composer/preview/__tests__/class-name-gate-probe.ts");

const gate = () =>
  promisify(execFile)(process.execPath, [join(root, "scripts/check-class-names.mjs")], {
    cwd: root,
    encoding: "utf8",
    timeout: 60_000,
  });

afterEach(async () => { await rm(probe, { force: true }); });

// Since #717 the preview entry no longer imports `base.css`, so the canvas
// sheet is reachable only from the preview graph. The gate builds its
// known-name universe by walking `src/**/*.css` on disk rather than any import
// graph, so `zc-*` must keep counting as tool-owned — never as a name the gate
// cannot see because the editor document no longer loads the sheet.
it("keeps the canvas classes of the isolated preview sheet in the known-name universe", async () => {
  expect((await gate()).stdout).toContain("Class-name gate passed");

  await writeFile(probe, 'export const canvas = ".zc-canvas .zc-node .zc-chrome .zc-insert-group .zc-prose-savebar";\n');
  expect((await gate()).stdout).toContain("Class-name gate passed");

  await writeFile(probe, 'export const retired = ".zc-retired-canvas";\n');
  await expect(gate()).rejects.toThrow("zc-retired-canvas");
});
