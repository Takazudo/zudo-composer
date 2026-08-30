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
const appTokens = read("src/styles/app-tokens.css");

const providerSha = "6b0826cdaa14d9888e58c795ee015f70e2c5cbdf";
const providerTree = "1c3cbfd3a25d1425f447cdadd5ba538916394309";
const frozenProvenance = "f1206f3b82bdbfff791dcaf5d9918c2afdda0ae2";
const contractPackageSha = "9b774b827e9f6fec14379995ac2c691ccc3b7e5b";
const providerSpec = `git+https://github.com/Takazudo/zudo-sg.git#${providerSha}`;
const contractSpec = `git+https://github.com/Takazudo/zudo-composer.git#${contractPackageSha}`;

assert.deepEqual(SPA_ROUTES, ["/", "/composer", "/composer/preview", "/content", "/mapping", "/sitemapper", "/media"]);
assert.equal(LIVE_ORIGIN, "https://zudo-composer.zudolab.dev");
assert.equal(wrangler.name, "zudo-composer");
assert.deepEqual(wrangler.routes, [{ pattern: "zudo-composer.zudolab.dev", custom_domain: true }]);
assert.equal(packageJson.dependencies["@zudo-sg/ui"], providerSpec);
assert.equal(packageJson.dependencies["@zudo-composer/component-contract"], "workspace:*");
assert.equal(contractHandoff.rootGitSpec, contractSpec);
assert.equal(packageJson.scripts["handoff:boundary"], "node scripts/check-standalone-handoff.mjs");
assert.ok(packageJson.scripts.check.includes("pnpm handoff:boundary"));
assert.equal(packageJson.scripts.deploy, "wrangler deploy");
assert.equal(packageJson.scripts["deploy:dry-run"], "wrangler deploy --dry-run");
for (const [size, value] of Object.entries({ xs: "0.75rem", sm: "1rem", md: "1.25rem", lg: "1.5rem" })) {
  assert.match(appTokens, new RegExp(`--spacing-icon-${size}:\\s*${value.replace(".", "\\.")};`), `missing local icon token ${size}`);
}

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
    "zudo-composer.zudolab.dev",
    "no users",
    "persisted production data",
    "migrations",
    "redirects",
    "aliases",
    "legacy fallbacks",
    "compatibility shims",
    "compatibility fixtures",
    "unrelated",
    "--frozen-lockfile",
    "workspace:",
    "file:",
    "link:",
    "path:",
  ]) assert.ok(normalized.includes(phrase.toLowerCase()), `${name} is missing permanent handoff phrase: ${phrase}`);
  for (const route of SPA_ROUTES) assert.ok(document.includes(`\`${route}\``), `${name} is missing route ${route}`);
  assert.ok(document.includes("`/assets/`"), `${name} is missing the asset root`);
  assert.ok(document.includes("pnpm deploy:dry-run"), `${name} is missing dry-run guidance`);
  assert.ok(document.includes("pnpm smoke:local"), `${name} is missing local smoke guidance`);
  assert.ok(document.includes("pnpm smoke:live"), `${name} is missing live smoke guidance`);
  assert.match(document, /pnpm deploy(?!:dry-run)\b/, `${name} is missing real deploy guidance`);
  assert.match(document, /wrangler login/i, `${name} is missing Wrangler login guidance`);
  assert.match(document, /wrangler whoami/i, `${name} is missing Wrangler identity guidance`);
  assert.doesNotMatch(document, /e127c8a66a223472732e0cb1098296d07b1658ec|3070424cc8b55e63e8d44ee81b238b6777341bc3/, `${name} must not publish a provisional target SHA`);
}

const documentedHashes = new Set(
  [...`${readme}\n${guidance}`.matchAll(/\b[a-f0-9]{40}\b/gi)].map((match) => match[0].toLowerCase()),
);
assert.deepEqual(
  documentedHashes,
  new Set([frozenProvenance, providerSha, providerTree, contractPackageSha]),
  "README/CLAUDE must contain only the four permanent provenance/provider/tree/contract identities",
);
const provisionalHashes = [...`${readme}\n${guidance}`.matchAll(/(?<![a-f0-9])[a-f0-9]{7,39}(?![a-f0-9])/gi)]
  .map((match) => match[0]);
assert.deepEqual(provisionalHashes, [], "README/CLAUDE must not publish abbreviated or provisional checkpoint hashes");

assert.match(readme, /Composer owns[\s\S]{0,120}document model[\s\S]{0,80}source generation/i);
assert.match(readme, /Content owns[\s\S]{0,120}model[\s\S]{0,80}storage/i);
assert.match(readme, /Mapping owns[\s\S]{0,120}binding[\s\S]{0,80}storage/i);
assert.match(readme, /Sitemapper owns[\s\S]{0,120}page-tree model[\s\S]{0,80}storage/i);
assert.match(guidance, /owner of Composer model\/source/i);
assert.match(guidance, /Content model\/storage/i);
assert.match(guidance, /Mapping model\/storage/i);
assert.match(guidance, /Sitemapper model\/storage/i);

for (const document of [readme, guidance]) {
  assert.match(document, /same-origin/i);
  assert.match(document, /zudo-doc/i);
  assert.match(document, /styleguide registry/i);
  assert.match(document, /focused[\s\S]{0,80}@takazudo\/zfb-md-wasm/i);
  assert.match(document, /component-contract handoff[\s\S]{0,500}(?:separate|distinct)/i);
  assert.match(document, /UI-provider|UI provider|provider updates?/i);
  assert.match(document, /(?:never|do not)[\s\S]{0,120}cop(?:y|ied)[\s\S]{0,80}provider|copied provider source/i);
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

function markdownFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if ([".git", ".artifacts", "coverage", "dist", "node_modules", "test-results"].includes(entry.name)) return [];
      return markdownFiles(path);
    }
    return extname(path) === ".md" ? [path] : [];
  });
}

for (const path of markdownFiles(root)) {
  assert.doesNotMatch(
    readFileSync(path, "utf8"),
    /https?:\/\/github\.com\/[^\s)]+\/actions\/runs\/\d+/i,
    `${relative(root, path)} must not publish an Actions run URL`,
  );
}

const directDependencies = Object.keys({ ...packageJson.dependencies, ...packageJson.devDependencies });
const forbiddenHostModule = /zudo-doc|(?:^|[/@-])zfb(?:[/@-]|$)|virtual-zfb|styleguide.*registry/i;
assert.deepEqual(directDependencies.filter((name) => forbiddenHostModule.test(name)), []);

const forbiddenImports = [];
const productionFiles = [
  ...files(join(root, "src")),
  ...files(join(root, "plugins")),
  join(root, "vite.config.ts"),
];
for (const path of productionFiles) {
  const source = readFileSync(path, "utf8");
  for (const match of source.matchAll(/(?:from\s+|import\s*(?:\(\s*)?|@import\s+)["']([^"']+)["']/g)) {
    if (forbiddenHostModule.test(match[1])) {
      forbiddenImports.push(`${relative(root, path)} -> ${match[1]}`);
    }
  }
}
assert.deepEqual(forbiddenImports, [], "standalone production source imported a removed host application dependency");

const futureWaveClaim = /\b(?:later|future|downstream)\s+(?:Composer\s+|Sitemapper\s+)?waves?\b|\bwaves?\s+\d+(?:\s*[-–]\s*\d+)?\s+(?:will|extend|add|mount|wire)|\bonce\b[^\n]{0,80}\b(?:is wired|is assembled|lands)\b/i;
const unqualifiedCopiedIssue = /(?<![A-Za-z0-9/#])#[2-4][0-9]{2}\b/;
for (const path of productionFiles) {
  const source = readFileSync(path, "utf8");
  assert.doesNotMatch(source, futureWaveClaim, `${relative(root, path)} retained a future-wave claim`);
  assert.doesNotMatch(source, unqualifiedCopiedIssue, `${relative(root, path)} retained an unqualified copied zudo-sg issue reference`);
}

for (const [path, stale] of [
  ["src/composer/index.ts", /Downstream waves/],
  ["src/composer/model/commands.ts", /reparenting and drag-and-drop are deferred/],
  ["src/features/composer/ui/toolbar/toolbar-actions.tsx", /Reset\/Export/],
  ["src/features/composer/ui/toolbar/mode-toggle.tsx", /wave-5 integration/],
  ["src/features/composer/ui/toolbar/status-indicator.tsx", /later status chip/],
  ["src/features/composer/chrome/composer-workspace.tsx", /later Composer wave|once the isolated preview runtime|now-retired prototype/],
  ["src/features/composer/chrome/composer-placeholder-pane.tsx", /does NOT implement|exclusive-ownership table/],
  ["src/features/composer/ui/chooser/composer-chooser.tsx", /canvas insert points \(a later wave\)/],
  ["src/features/composer/ui/shared/inline-confirm.tsx", /lands in a later wave|toolbar Reset/],
  ["src/features/sitemapper/chrome/sitemapper-workspace.tsx", /later Sitemapper wave|once the Sitemapper controller is assembled|once the authoring controller is assembled/],
]) assert.doesNotMatch(read(path), stale, `${path} retained a provisional copied/wave claim`);

for (const path of [
  "src/components/icons/index.ts",
  "src/features/composer/styles.css",
  "src/features/composer/preview/preview.css",
]) assert.doesNotMatch(read(path), /src\/styles\/global\.css|src\/config\/z-index-tokens\.ts|_temp-resource|gen:z-index/, `${path} retained a broken copied-source reference`);

assert.doesNotMatch(read("src/components/icons/index.ts"), /Composer\/styleguide/i, "icon ownership must remain standalone Composer/Sitemapper app chrome");

for (const forbidden of ["workspace:", "file:", "link:", "path:", "packages/ui", "../zudo-sg"]) {
  assert.ok(!packageJson.dependencies["@zudo-sg/ui"].includes(forbidden), `provider spec uses forbidden resolution: ${forbidden}`);
}

console.log("Standalone handoff boundary passed: ownership, routes, provider/contract identities, clean-break policy, and deployment handoff are locked.");
