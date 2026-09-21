// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkStyleguidePins } from "../check-styleguide-pins.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const temporaries: string[] = [];
afterEach(async () => { await Promise.all(temporaries.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture(uiSpec = "git+https://example.test/repo.git#ui", contractSpec = "git+https://example.test/repo.git#contract", handoffUiSpec = uiSpec, handoffContractSpec = contractSpec) {
  const root = await mkdtemp(join(tmpdir(), "styleguide-pins-test-"));
  temporaries.push(root);
  await mkdir(join(root, "styleguide/sample"), { recursive: true });
  await writeFile(join(root, "ui-handoff.json"), JSON.stringify({ rootGitSpec: handoffUiSpec }));
  await writeFile(join(root, "contract-handoff.json"), JSON.stringify({ rootGitSpec: handoffContractSpec }));
  await writeFile(join(root, "styleguide/sample/package.json"), JSON.stringify({ dependencies: { "@zudo-composer/ui": uiSpec, "@zudo-composer/component-contract": contractSpec } }));
  await writeFile(join(root, "styleguide/sample/README.md"), "The documented fallback is link:../../packages/ui and link:../../packages/component-contract.");
  return root;
}

describe("sample styleguide dependency pins", () => {
  it("matches both standalone dependencies to the root handoff specs", () => {
    expect(checkStyleguidePins({ root: repositoryRoot })).toEqual({
      pins: [
        "@zudo-composer/ui=git+https://github.com/Takazudo/zudo-composer.git#2ea02290e5a09e4995a1c1c3f5f1f08a59a94b7d",
        "@zudo-composer/component-contract=git+https://github.com/Takazudo/zudo-composer.git#c0b452da075b66757c60bd0d721a47062d4354d0",
      ],
      fallbacks: [],
    });
  });

  it("accepts a documented link fallback and reports it distinctly", async () => {
    const root = await fixture("link:../../packages/ui", "link:../../packages/component-contract", "git+https://example.test/repo.git#ui", "git+https://example.test/repo.git#contract");
    expect(checkStyleguidePins({ root })).toEqual({
      pins: [],
      fallbacks: ["@zudo-composer/ui=link:../../packages/ui", "@zudo-composer/component-contract=link:../../packages/component-contract"],
    });
  });

  it("rejects a stale or floating dependency spec", async () => {
    const root = await fixture();
    await writeFile(join(root, "styleguide/sample/package.json"), JSON.stringify({ dependencies: { "@zudo-composer/ui": "^1.0.0", "@zudo-composer/component-contract": "git+https://example.test/repo.git#contract" } }));
    expect(() => checkStyleguidePins({ root })).toThrow(/ui pin mismatch/);
  });

  it("rejects an undocumented link fallback", async () => {
    const root = await fixture("link:../../packages/ui", "git+https://example.test/repo.git#contract", "git+https://example.test/repo.git#ui", "git+https://example.test/repo.git#contract");
    await writeFile(join(root, "styleguide/sample/README.md"), "Use the root Git handoff pins.");
    expect(() => checkStyleguidePins({ root })).toThrow(/documented fallback/);
  });
});
