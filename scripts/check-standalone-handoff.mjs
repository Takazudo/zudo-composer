// @ts-check

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { AUTHORING_ROUTES } from "./routes.mjs";
import { assertHandoffHashes } from "./handoff-identities.mjs";

const root = resolve(import.meta.dirname, "..");
/** @param {string} path */
const read = (path) => readFileSync(join(root, path), "utf8");
/** @param {string} path */
const readJson = (path) => JSON.parse(read(path));
const readme = read("README.md");
const guidance = read("CLAUDE.md");
const packageJson = readJson("package.json");
const contractHandoff = readJson("contract-handoff.json");
const appTokens = read("src/styles/app-tokens.css");

const providerSha = "6b0826cdaa14d9888e58c795ee015f70e2c5cbdf";
const providerTree = "1c3cbfd3a25d1425f447cdadd5ba538916394309";
const frozenProvenance = "f1206f3b82bdbfff791dcaf5d9918c2afdda0ae2";
const contractPackageSha = "b66d52bb273a10010485efb2d06f80cee8001bd6";
const providerSpec = `git+https://github.com/Takazudo/zudo-sg.git#${providerSha}`;
const contractSpec = `git+https://github.com/Takazudo/zudo-composer.git#${contractPackageSha}`;

assert.deepEqual(AUTHORING_ROUTES, ["/", "/composer", "/composer/preview", "/content", "/mapping", "/sitemapper", "/assets"]);
assert.equal(packageJson.devDependencies["@zudo-sg/ui"], providerSpec);
// The contract is a peer of the published package and a workspace dev
// dependency of this repository. Both halves are load-bearing: the peer keeps a
// host on one contract instance, the dev spec keeps `workspace:*` out of what
// ships.
assert.equal(packageJson.peerDependencies["@zudo-composer/component-contract"], "^1.0.0");
assert.equal(packageJson.devDependencies["@zudo-composer/component-contract"], "workspace:*");
assert.equal(packageJson.dependencies["@zudo-composer/component-contract"], undefined);
assert.equal(contractHandoff.rootGitSpec, contractSpec);
assert.equal(packageJson.scripts["handoff:boundary"], "node scripts/check-standalone-handoff.mjs");
assert.ok(packageJson.scripts.check.includes("pnpm handoff:boundary"));
for (const [size, value] of Object.entries({ xs: "0.75rem", sm: "1rem", md: "1.25rem", lg: "1.5rem" })) {
  assert.match(appTokens, new RegExp(`--spacing-icon-${size}:\\s*${value.replace(".", "\\.")};`), `missing local icon token ${size}`);
}

// The host-facing surface a breaking rename would silently drift out from
// under the docs: the bin name, the config file a host writes, and the
// `dataDir` convention every settings default hangs off. Each is asserted
// against its actual source, not just hardcoded, so renaming the bin or the
// config file here fails this gate instead of only going stale in prose.
const binEntry = packageJson.bin?.["zudo-composer"];
assert.equal(binEntry, "./bin/zudo-composer.mjs", "package.json must publish the zudo-composer executable at its documented path");
assert.ok(existsSync(join(root, binEntry)), `the published bin entry point ${binEntry} must exist`);

const configSource = read("server/config/config.ts");
const configFileNameMatch = configSource.match(/export const CONFIG_FILE_NAME = "([^"]+)"/);
assert.ok(configFileNameMatch, "server/config/config.ts must export a literal CONFIG_FILE_NAME");
const CONFIG_FILE_NAME = configFileNameMatch[1];
assert.equal(CONFIG_FILE_NAME, "zudo-composer.config.ts");

const settingsSource = read("server/config/settings.ts");
const dataDirDefaultMatch = settingsSource.match(/dataDir:\s*"([^"]+)"/);
assert.ok(dataDirDefaultMatch, "server/config/settings.ts must set a literal dataDir default");
assert.equal(dataDirDefaultMatch[1], "cms");

for (const [name, document] of [["README.md", readme], ["CLAUDE.md", guidance]]) {
  assert.ok(document.includes(`\`${CONFIG_FILE_NAME}\``), `${name} must name the host config file ${CONFIG_FILE_NAME}`);
}
assert.match(readme, /\bdataDir\b[\s\S]{0,60}`cms`|`cms`[\s\S]{0,60}\bdataDir\b/, "README must document the dataDir convention and its cms default");
assert.match(readme, /`pack`[\s\S]{0,80}(?:required|only setting without a default)/i, "README must document pack as the one required, default-less setting");

for (const [name, document] of [["README.md", readme], ["CLAUDE.md", guidance]]) {
  const normalized = document.replace(/\s+/g, " ").toLowerCase();
  for (const phrase of [
    "@zudo-sg/ui@0.1.0",
    "@zudo-sg/ui@1.0.0",
    "@zudo-composer/component-contract@1.0.0",
    providerSha,
    providerTree,
    providerSpec,
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
  for (const route of AUTHORING_ROUTES) assert.ok(document.includes(`\`${route}\``), `${name} is missing route ${route}`);
  assert.ok(document.includes("`/assets/`"), `${name} is missing the asset root`);
  assert.doesNotMatch(document, /e127c8a66a223472732e0cb1098296d07b1658ec|3070424cc8b55e63e8d44ee81b238b6777341bc3/, `${name} must not publish a provisional target SHA`);
}

assertHandoffHashes({ readme, guidance, permanent: [frozenProvenance, providerSha, providerTree, contractPackageSha] });

// Ownership framing: the tool owns the five domains' models/UI over a shared
// filesystem engine; a host project owns what it authors through them
// (components, templates, CMS data). This replaced the pre-conversion "this
// repository owns Composer storage" framing, which stopped being true once
// storage moved to host-configured directories.
// Multi-word phrases below tolerate a line wrap between words: reflowed prose
// puts a newline anywhere a space could go, so a literal-space regex is one
// re-wrap away from a false failure.
/** @param {string} phrase @returns {RegExp} */
function phraseMatcher(phrase) {
  const words = phrase.split(" ").map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(words.join("\\s+"), "i");
}
assert.match(readme, /installable Preact authoring \*\*tool\*\*/i, "README must frame zudo-composer as an installable tool, not an application");
assert.match(readme, phraseMatcher("Composer owns its document model, source generation, reuse rules, chrome"));
assert.match(readme, phraseMatcher("Content owns its model, Entry library, and authoring UI"));
assert.match(readme, phraseMatcher("Mapping owns its binding model, resolver, preview handoff, and authoring UI"));
assert.match(readme, phraseMatcher("Sitemapper owns its page-tree model, library, authoring UI"));
assert.match(guidance, /permanent home of `zudo-composer`[\s\S]{0,80}installable[\s\S]{0,40}tool/i, "CLAUDE.md must frame zudo-composer as an installable tool, not an application");
assert.match(guidance, phraseMatcher("Composer document model, source generation, reuse rules, chrome"));
assert.match(guidance, phraseMatcher("Content model, Entry library and authoring UI"));
assert.match(guidance, phraseMatcher("Mapping binding model, resolver and authoring UI"));
assert.match(guidance, phraseMatcher("Sitemapper page-tree model, library, authoring UI"));
assert.match(guidance, /host project installs this tool[\s\S]{0,300}owns everything the tool authors/i, "CLAUDE.md must state that a host project owns what the tool authors into it");
assert.match(guidance, /\*\*components\*\*[\s\S]{0,400}\*\*templates\*\*[\s\S]{0,400}\*\*CMS data\*\*/i, "CLAUDE.md must spell out the components/templates/CMS-data ownership split");

for (const document of [readme, guidance]) {
  assert.match(document, /same-origin/i);
  assert.match(document, /zudo-doc/i);
  assert.match(document, /styleguide registry/i);
  assert.match(document, /focused[\s\S]{0,80}@takazudo\/zfb-md-wasm/i);
  assert.match(document, /component-contract handoff[\s\S]{0,500}(?:separate|distinct)/i);
  assert.match(document, /UI-provider|UI provider|provider updates?/i);
  assert.match(document, /(?:never|do not)[\s\S]{0,120}cop(?:y|ied)[\s\S]{0,80}provider|copied provider source/i);
}

/** @param {string} directory @returns {string[]} */
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

/** @param {string} directory @returns {string[]} */
function markdownFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      // `worktrees` holds nested git checkouts, not repository content: scanning it
      // asserts this repo's rules against a second copy of the tree (and against any
      // untracked scratch markdown left there), which fails on files that are not ours.
      if ([".git", ".artifacts", "coverage", "dist", "node_modules", "test-results", "worktrees"].includes(entry.name)) return [];
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

// The Composer's own toolbar bar, mode toggle, status indicator, rail resizers,
// bespoke tree and movable tool-dialog geometry were retired when the editor
// adopted the shared chrome (epic #156), so their entries are gone with them.
/** @type {Array<[string, RegExp]>} */
const staleChecks = [
  ["src/composer/index.ts", /Downstream waves/],
  ["src/composer/model/commands.ts", /reparenting and drag-and-drop are deferred/],
  ["src/features/composer/ui/toolbar/toolbar-actions.tsx", /Reset\/Export/],
  ["src/features/composer/ui/toolbar/view-controls.tsx", /later wave|wave-5 integration/],
  ["src/features/composer/ui/tree/structure-pane.tsx", /later wave|placeholder rail/],
  ["src/features/composer/chrome/composer-workspace.tsx", /later Composer wave|once the isolated preview runtime|now-retired prototype|five-track/],
  ["src/features/composer/chrome/composer-placeholder-pane.tsx", /does NOT implement|exclusive-ownership table/],
  ["src/features/composer/ui/chooser/composer-chooser.tsx", /canvas insert points \(a later wave\)|movable tool shell/],
  ["src/features/composer/ui/export/export-dialog.tsx", /later wave|own explicit JS/],
  ["src/features/sitemapper/app/sitemapper-integration.tsx", /later Sitemapper wave|once the Sitemapper controller is assembled|once the authoring controller is assembled|placeholder pane/],
];
for (const [path, stale] of staleChecks) assert.doesNotMatch(read(path), stale, `${path} retained a provisional copied/wave claim`);

for (const path of [
  "src/components/icons/index.ts",
  "src/features/composer/styles.css",
  "src/features/composer/preview/preview.css",
]) assert.doesNotMatch(read(path), /src\/styles\/global\.css|src\/config\/z-index-tokens\.ts|_temp-resource|gen:z-index/, `${path} retained a broken copied-source reference`);

assert.doesNotMatch(read("src/components/icons/index.ts"), /Composer\/styleguide/i, "icon ownership must remain standalone Composer/Sitemapper app chrome");

for (const forbidden of ["workspace:", "file:", "link:", "path:", "packages/ui", "../zudo-sg"]) {
  assert.ok(!packageJson.devDependencies["@zudo-sg/ui"].includes(forbidden), `provider spec uses forbidden resolution: ${forbidden}`);
}

console.log("Standalone handoff boundary passed: tool/host ownership framing, the bin/config/dataDir host contract, routes, provider/contract identities, and clean-break policy are locked.");
