// @ts-check
// Seeds an explicitly new, disposable, ordinary writable authoring host from one
// of the repository's real demo definitions (Sample Studio, Orrery, Margin
// Notes, Nightjar Supply) or from the installed native-edit fixture.
// The tracked demo packages, their site-project.ts and generated CMS are never
// written; assets enter the new host only through the owning Assets store.
import { cp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repo = fileURLToPath(new URL("../..", import.meta.url));
export const DEMOS = /** @type {const} */ ({ sample: "demo-sample", landing: "demo-landing", blog: "demo-blog", webshop: "demo-webshop" });

/**
 * @param {{ kind: keyof typeof DEMOS | "edit-host", dir: string, baseUrl?: string, apiKeyEnv?: string, workspaceId?: string, name?: string }} options
 * @returns {Promise<{ dir: string, workspaceId: string, pages: { sitemapId: string, pageId: string }[] }>}
 */
export async function prepareAssistantHost({ kind, dir, baseUrl, apiKeyEnv = "ZUDO_ASSISTANT_TEST_KEY", workspaceId, name }) {
  const target = resolve(dir);
  if (existsSync(target) && (await readdir(target)).length) throw new Error(`Refusing to seed into a non-empty directory: ${target}`);
  await mkdir(target, { recursive: true });
  const assistant = { name: name ?? "AI Assistant", ...(baseUrl ? { baseUrl, apiKeyEnv } : {}) };
  if (kind === "edit-host") {
    await cp(join(repo, "fixtures/edit-host"), target, { recursive: true });
    const config = await readFile(join(target, "zudo-composer.config.ts"), "utf8");
    await writeFile(join(target, "zudo-composer.config.ts"), config.replace(/\}\s*;?\s*$/u, `, assistant: ${JSON.stringify(assistant)} };\n`).replace(/,\s*,/u, ","));
    await mkdir(join(target, "node_modules/@zudo-composer"), { recursive: true });
    await symlink(repo, join(target, "node_modules/zudo-composer"), "dir");
    await symlink(join(repo, "node_modules/preact"), join(target, "node_modules/preact"), "dir");
    await symlink(join(repo, "packages/component-contract"), join(target, "node_modules/@zudo-composer/component-contract"), "dir");
    const run = spawnSync(process.execPath, ["initialize.mjs"], { cwd: target, encoding: "utf8" });
    if (run.status !== 0) throw new Error(`edit-host initialization failed: ${run.stderr}`);
    const initialized = JSON.parse(run.stdout.trim().split("\n").at(-1) ?? "{}");
    return { dir: target, workspaceId: initialized.workspaceId, pages: [{ sitemapId: "main", pageId: "home" }, { sitemapId: "main", pageId: "other" }] };
  }
  const source = join(repo, "packages", DEMOS[kind]);
  const skip = new Set(["cms", "node_modules", "__tests__", "site-project.ts", "site-project.json", "dist-site", "dist-editor", "images-src"]);
  for (const entry of await readdir(source)) if (!skip.has(entry)) await cp(join(source, entry), join(target, entry), { recursive: true });
  await symlink(join(source, "node_modules"), join(target, "node_modules"), "dir");
  const require = createRequire(join(target, "package.json"));
  const authoring = await import(pathToFileURL(require.resolve("zudo-composer/authoring")).href);
  const vite = await import(pathToFileURL(require.resolve("zudo-composer/vite")).href);
  // The source host's own resolved settings, read-only and without ambient
  // ZUDO_COMPOSER_* overrides: a host-local self-reference pack and an installed
  // themeset are both carried over exactly as the demo names them.
  const { composerConfig: sourceConfig } = await vite.loadHostContext({ workspaceRoot: source, env: {} });
  await writeFile(join(target, "zudo-composer.config.ts"), `// Editable Assistant host seeded from packages/${DEMOS[kind]}.\nimport { defineComposerConfig } from "zudo-composer/config";\n\nexport default defineComposerConfig({\n${Object.entries(sourceConfig.settings).map(([key, value]) => `  ${key}: ${JSON.stringify(value)},\n`).join("")}  nativeEditing: { source: "workspace" },\n  assistant: ${JSON.stringify(assistant)},\n});\n`);
  const { composerConfig, pack } = await vite.loadHostContext({ workspaceRoot: target, env: {} });
  // Exact repository definition; the committed SiteProject JSON is its generated form.
  const project = JSON.parse(await readFile(join(source, "site-project.json"), "utf8"));
  const assets = await authoring.createFilesystemAssetStore({ assetsStoreRoot: composerConfig.paths.assets });
  const catalog = JSON.parse(await readFile(join(source, "cms/assets/catalog.json"), "utf8"));
  for (const record of catalog.records) {
    if (record.document.state !== "active" || record.document.versions.length !== 1 || record.revision !== 1) continue;
    const version = record.document.versions[0];
    const file = version.url.replace(/^\/uploaded-assets\//, "");
    // Create-only, checksum-verified import through the owning Assets store.
    await assets.put(record, await readFile(join(source, "cms/assets/versions", file)));
  }
  const id = workspaceId ?? `${kind}-assistant`;
  await authoring.initializeAuthoringWorkspace({ composerConfig, pack, project, workspaceId: id });
  /** @param {{ id: string, children: any[] }[]} nodes @returns {string[]} */
  const flatten = nodes => nodes.flatMap(node => [node.id, ...flatten(node.children ?? [])]);
  const pages = project.providers.sitemaps.flatMap((/** @type {any} */ provider) => provider.records.flatMap((/** @type {any} */ record) => flatten(record.document.root).map(pageId => ({ sitemapId: record.id, pageId }))));
  return { dir: target, workspaceId: id, pages };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [kind, dir, ...rest] = process.argv.slice(2);
  if (!kind || !dir || !(kind in DEMOS || kind === "edit-host")) { console.error("Usage: node scripts/assistant/prepare-host.mjs <sample|landing|blog|webshop|edit-host> <new-empty-dir> [--base-url URL] [--name NAME]"); process.exit(2); }
  const flag = (/** @type {string} */ key) => { const index = rest.indexOf(key); return index >= 0 ? rest[index + 1] : undefined; };
  if (rest.includes("--fresh")) await rm(dir, { recursive: true, force: true });
  const result = await prepareAssistantHost({ kind: /** @type {any} */ (kind), dir, baseUrl: flag("--base-url"), name: flag("--name") });
  console.log(JSON.stringify(result));
}
