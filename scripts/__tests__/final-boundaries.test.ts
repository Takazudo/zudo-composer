// @vitest-environment node
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import { assertHandoffHashes } from "../handoff-identities.mjs";
import { assertPackedConsumerBoundary } from "../package-host-boundary.mjs";

const root = resolve(import.meta.dirname, "../..");
const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });
async function fixture() {
  await mkdir(join(root, ".artifacts"), { recursive: true });
  const directory = await mkdtemp(join(root, ".artifacts/final-boundary-"));
  temporary.push(directory);
  return directory;
}
async function put(root: string, path: string, source: string) {
  await mkdir(resolve(root, path, ".."), { recursive: true });
  await writeFile(join(root, path), source);
}

it("rejects planted reach-back, provider CSS and protocols in the real creator template gate", async () => {
  const copy = await fixture();
  for (const path of ["package.json", "scripts/check-creator.mjs", "scripts/check-consumer-boundary.mjs", "scripts/boundary-source.mjs", "server/creator/project.mjs"]) {
    await put(copy, path, await readFile(join(root, path), "utf8"));
  }
  await cp(join(root, "templates/host"), join(copy, "templates/host"), { recursive: true });
  const check = () => promisify(execFile)(process.execPath, [join(copy, "scripts/check-creator.mjs")], { encoding: "utf8", timeout: 15_000 });
  expect((await check()).stdout).toContain("strict consumer boundary");
  for (const [path, source] of [
    ["injected.ts", "import '../../src/private';"],
    ["injected.css", "@import '@zudo-sg/ui/styles/composer.css';"],
    ["injected.json", '{"dependencies":{"hidden":"workspace:*"}}'],
  ]) {
    const file = join(copy, "templates/host", path);
    await writeFile(file, source);
    await expect(check()).rejects.toThrow("Creator consumer boundary failed");
    await rm(file);
  }
  expect((await check()).stdout).toContain("strict consumer boundary");
});

it("excludes all discovered consumer trees from the tarball while preserving creator templates", async () => {
  const copy = await fixture();
  for (const path of ["packages/demo-studio", "packages/new-consumer", "fixtures/new-fixture"]) {
    await put(copy, `${path}/package.json`, JSON.stringify({ name: path.replaceAll("/", "-"), dependencies: { "zudo-composer": "1" } }));
  }
  for (const file of ["packages/demo-studio/site-project.json", "packages/new-consumer/components/pack.ts", "fixtures/new-fixture/data.json", "fixtures/nonhost/sample.json"]) {
    expect(() => assertPackedConsumerBoundary(["src/main.tsx", file], copy)).toThrow(/exposes/);
  }
  expect(() => assertPackedConsumerBoundary(["src/main.tsx", "templates/host/tests/starter.spec.tsx", "templates/host/site-project.ts"], copy)).not.toThrow();
  await mkdir(join(copy, "packages/demo-broken"));
  expect(() => assertPackedConsumerBoundary(["packages/demo-broken/source.ts"], copy)).toThrow(/consumer host/);
});

it("separates full consumer tool install refs from the exact permanent identity set", async () => {
  const readme = await readFile(join(root, "README.md"), "utf8");
  const guidance = await readFile(join(root, "CLAUDE.md"), "utf8");
  const permanent = ["f1206f3b82bdbfff791dcaf5d9918c2afdda0ae2", "6b0826cdaa14d9888e58c795ee015f70e2c5cbdf", "1c3cbfd3a25d1425f447cdadd5ba538916394309", "b66d52bb273a10010485efb2d06f80cee8001bd6"];
  const check = (text: string, guide = guidance) => assertHandoffHashes({ readme: text, guidance: guide, permanent });
  expect(() => check(readme)).not.toThrow();
  const consumer = "a".repeat(40);
  expect(() => check(readme.replace("#<commit>", `#${consumer}`))).not.toThrow();
  expect(() => check(`${readme}\nProvisional checkpoint: ${consumer}`)).toThrow("permanent identities");
  expect(() => check(readme.replace(permanent[1], consumer))).toThrow("permanent identities");
  expect(() => check(readme.replace("#<commit>", `#${consumer}`), `${guidance}\n${consumer}`)).toThrow("permanent identities");
  for (const length of [7, 12, 39]) expect(() => check(readme.replace("#<commit>", `#${consumer.slice(0, length)}`))).toThrow("abbreviated");
  expect(() => check(`${readme}\nzudo-composer@git+https://github.com/Takazudo/zudo-composer.git#${consumer}`)).toThrow("permanent identities");
});
