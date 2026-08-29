import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { LIVE_ORIGIN, SPA_ROUTES } from "./deployment-artifact-lib.mjs";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const readJson = (path) => JSON.parse(read(path));
const readme = read("README.md");
const guidance = read("CLAUDE.md");
const packageJson = readJson("package.json");
const contractHandoff = readJson("contract-handoff.json");
const wrangler = readJson("wrangler.jsonc");

const providerSha = "fe3fc62d3f677f321f5eb7814240d4a55dc92cd0";
const providerTree = "96a42a59cf4d05078ba85e7a0ccdb7d7765d29cc";
const providerSpec = `git+https://github.com/Takazudo/zudo-sg.git#${providerSha}`;
const contractSpec = "git+https://github.com/Takazudo/zudo-composer.git#51f1c64a7639134254866458ff72b497da9c2f36";

assert.deepEqual(SPA_ROUTES, ["/", "/composer", "/composer/preview", "/sitemapper"]);
assert.equal(LIVE_ORIGIN, "https://zudo-composer.takazudomodular.com");
assert.equal(wrangler.name, "zudo-composer");
assert.deepEqual(wrangler.routes, [{ pattern: "zudo-composer.takazudomodular.com", custom_domain: true }]);
assert.equal(packageJson.dependencies["@zudo-sg/ui"], providerSpec);
assert.equal(packageJson.dependencies["@zudo-composer/component-contract"], "workspace:*");
assert.equal(contractHandoff.rootGitSpec, contractSpec);
assert.equal(packageJson.scripts["handoff:boundary"], "node scripts/check-standalone-handoff.mjs");
assert.ok(packageJson.scripts.check.includes("pnpm handoff:boundary"));

for (const [name, document] of [["README.md", readme], ["CLAUDE.md", guidance]]) {
  const normalized = document.replace(/\s+/g, " ").toLowerCase();
  for (const phrase of [
    "@zudo-sg/ui@0.1.0",
    "@zudo-sg/ui@1.0.0",
    "@zudo-composer/component-contract@1.0.0",
    providerSha,
    providerTree,
    providerSpec,
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ACCOUNT_ID",
    "zudo-composer.takazudomodular.com",
    "no users",
    "persisted production data",
    "migrations",
    "redirects",
    "aliases",
    "legacy fallbacks",
    "compatibility shims",
    "compatibility fixtures",
    "unrelated",
  ]) assert.ok(normalized.includes(phrase.toLowerCase()), `${name} is missing permanent handoff phrase: ${phrase}`);
  for (const route of SPA_ROUTES) assert.ok(document.includes(`\`${route}\``), `${name} is missing route ${route}`);
  assert.ok(document.includes("`/assets/`"), `${name} is missing the asset root`);
  assert.ok(document.includes("pnpm deploy:dry-run"), `${name} is missing dry-run guidance`);
  assert.ok(document.includes("pnpm smoke:local"), `${name} is missing local smoke guidance`);
  assert.ok(document.includes("pnpm smoke:live"), `${name} is missing live smoke guidance`);
  assert.doesNotMatch(document, /e127c8a66a223472732e0cb1098296d07b1658ec|3070424cc8b55e63e8d44ee81b238b6777341bc3/, `${name} must not publish a provisional target SHA`);
}

assert.match(readme, /Composer owns[\s\S]{0,120}document model[\s\S]{0,80}source generation/i);
assert.match(readme, /Sitemapper owns[\s\S]{0,120}page-tree model[\s\S]{0,80}storage/i);
assert.match(guidance, /owner of Composer model\/source/i);
assert.match(guidance, /Sitemapper model\/storage/i);

for (const document of [readme, guidance]) {
  assert.match(document, /same-origin/i);
  assert.match(document, /zudo-doc/i);
  assert.match(document, /styleguide registry/i);
  assert.match(document, /focused[\s\S]{0,80}@takazudo\/zfb-md-wasm/i);
  assert.match(document, /component-contract handoff[\s\S]{0,500}(?:separate|distinct)/i);
  assert.match(document, /UI-provider|UI provider|provider updates?/i);
  assert.match(document, /only after (?:the )?(?:Phase 3 root )?merge|only after merge|before the Phase 3 root merges/i);
}

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (["__tests__", "test-support"].includes(entry.name)) return [];
      return files(path);
    }
    return [path];
  }).filter((path) => [".ts", ".tsx", ".mts", ".mjs", ".css"].includes(extname(path)) && !/\.(?:test|spec)\./.test(path));
}

const directDependencies = Object.keys({ ...packageJson.dependencies, ...packageJson.devDependencies });
assert.deepEqual(directDependencies.filter((name) => /zudo-doc|^@takazudo\/zfb|virtual-zfb/i.test(name)), []);

const forbiddenImports = [];
for (const path of files(join(root, "src"))) {
  const source = readFileSync(path, "utf8");
  for (const match of source.matchAll(/(?:from\s+|import\s*\(\s*|@import\s+)["']([^"']+)["']/g)) {
    if (/zudo-doc|^@takazudo\/zfb|virtual-zfb|styleguide.*registry/i.test(match[1])) {
      forbiddenImports.push(`${relative(root, path)} -> ${match[1]}`);
    }
  }
}
assert.deepEqual(forbiddenImports, [], "standalone production source imported a removed host application dependency");

for (const [path, stale] of [
  ["src/composer/index.ts", /Downstream waves/],
  ["src/composer/model/commands.ts", /reparenting and drag-and-drop are deferred/],
  ["src/features/composer/ui/toolbar/toolbar-actions.tsx", /Reset\/Export/],
  ["src/features/composer/ui/toolbar/mode-toggle.tsx", /wave-5 integration/],
  ["src/features/composer/ui/toolbar/status-indicator.tsx", /later status chip/],
  ["src/features/sitemapper/chrome/sitemapper-workspace.tsx", /later Sitemapper wave|once the Sitemapper controller is assembled|once the authoring controller is assembled/],
]) assert.doesNotMatch(read(path), stale, `${path} retained a provisional copied/wave claim`);

for (const forbidden of ["workspace:", "file:", "link:", "path:", "packages/ui", "../zudo-sg"]) {
  assert.ok(!packageJson.dependencies["@zudo-sg/ui"].includes(forbidden), `provider spec uses forbidden resolution: ${forbidden}`);
}

console.log("Standalone handoff boundary passed: ownership, routes, provider/contract identities, clean-break policy, and deployment handoff are locked.");
