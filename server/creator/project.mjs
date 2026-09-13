// @ts-check
import { cp, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// This path belongs to the installed tool, never to the caller's project.
export const HOST_TEMPLATE_ROOT = fileURLToPath(new URL("../../templates/host/", import.meta.url));
const toolManifestPath = new URL("../../package.json", import.meta.url);
const contractName = "@zudo-composer/component-contract";
const json = (/** @type {unknown} */ value) => `${JSON.stringify(value, null, 2)}\n`;

/** @typedef {{name: string, version: string, packageManager?: string, engines: {node: string, pnpm: string}, peerDependencies: Record<string, string>, devDependencies: Record<string, string>}} ToolManifest */
/** @typedef {{tool: ToolManifest, contractVersion: string}} CreatorMetadata */

/** Resolve the installed ESM contract without requiring an unexported subpath. */
export async function readCreatorMetadata() {
  const tool = /** @type {ToolManifest} */ (JSON.parse(await readFile(toolManifestPath, "utf8")));
  creatorPackageManager(tool);
  let directory = dirname(fileURLToPath(import.meta.resolve(contractName)));
  for (;;) {
    try {
      const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
      if (manifest.name === contractName && typeof manifest.version === "string") return { tool, contractVersion: manifest.version };
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== "ENOENT") throw error;
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`Cannot read the installed ${contractName} version.`);
    directory = parent;
  }
}

/** pnpm strips packageManager on pack; engines is retained in the installed
 * manifest. Verify the source-only field when present, never depend on it.
 * @param {ToolManifest} tool */
export function creatorPackageManager(tool) {
  if (!/^\d+\.\d+\.\d+$/.test(tool.engines.pnpm)) throw new Error("The creator requires an exact engines.pnpm version.");
  const expected = `pnpm@${tool.engines.pnpm}`;
  if (tool.packageManager !== undefined && tool.packageManager !== expected) throw new Error("Creator pnpm engine and tool packageManager versions disagree.");
  return expected;
}

/** @param {string} name */
export function validateHostName(name) {
  if (name.length > 214 || !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name)
    || ["node_modules", "favicon.ico", "zudo-composer", contractName, "preact", "preact-render-to-string", "@types/node", "vitest", "typescript"].includes(name)
    || name.split("/").some((part) => part === "src")) {
    throw new Error(`Invalid host package name "${name}". Use a lowercase npm name, distinct from its dependencies.`);
  }
}

/** @param {CreatorMetadata} metadata */
export function creatorDependencyVersions({ tool, contractVersion }) {
  return {
    dependencies: {
      "@zudo-composer/component-contract": contractVersion,
      preact: tool.peerDependencies.preact,
      "zudo-composer": tool.version,
    },
    devDependencies: Object.fromEntries(["@types/node", "preact-render-to-string", "typescript", "vitest"]
      .map((name) => [name, tool.devDependencies[name]])),
  };
}

/** @param {string} name @param {CreatorMetadata} metadata */
export function createHostManifest(name, metadata) {
  validateHostName(name);
  return {
    name, version: "0.0.0", private: true, type: "module",
    packageManager: creatorPackageManager(metadata.tool),
    engines: metadata.tool.engines,
    exports: { "./components": "./components/pack.ts" },
    scripts: {
      dev: "zudo-composer dev",
      generate: "zudo-composer generate",
      "generate:check": "zudo-composer generate --check",
      "assets:import": "zudo-composer assets import images-src/manifest.json",
      seed: "zudo-composer assets import images-src/manifest.json && zudo-composer seed",
      "build:site": "zudo-composer build-site",
      test: "vitest run",
      typecheck: "tsc --noEmit",
      check: "pnpm generate:check && pnpm typecheck && pnpm test",
    },
    ...creatorDependencyVersions(metadata),
  };
}

/** Compare written specs, not only the creator's version constants.
 * @param {ReturnType<typeof createHostManifest>} manifest @param {CreatorMetadata} metadata */
export function assertCreatorVersionParity(manifest, metadata) {
  // Read the tool metadata independently of the manifest-writing helper. A
  // wrong literal introduced into that helper must not become its own oracle.
  const expectedVersions = {
    dependencies: { "zudo-composer": metadata.tool.version, "@zudo-composer/component-contract": metadata.contractVersion, preact: metadata.tool.peerDependencies.preact },
    devDependencies: Object.fromEntries(["@types/node", "preact-render-to-string", "typescript", "vitest"].map((name) => [name, metadata.tool.devDependencies[name]])),
  };
  for (const [section, versions] of Object.entries(expectedVersions)) {
    for (const [name, expected] of Object.entries(versions)) {
      const written = /** @type {Record<string, string>} */ (manifest[/** @type {"dependencies" | "devDependencies"} */ (section)]);
      const actual = written?.[name];
      if (typeof expected !== "string" || !expected || actual !== expected) throw new Error(`Creator version mismatch: ${section}.${name} is ${JSON.stringify(actual)}; tool requires ${JSON.stringify(expected)}.`);
    }
  }
  if (manifest.packageManager !== creatorPackageManager(metadata.tool)) throw new Error("Creator package-manager version differs from the tool.");
}

export const HOST_GITIGNORE = `node_modules/
.zudo-site-project/
dist-site/
.vite/
coverage/
test-results/
playwright-report/
*.tsbuildinfo
cms/assets/.mutation.lock
.upload-*.stage
.*.tmp
`;

/** These files are generated as code, so template copies cannot drift from policy.
 * @param {string} name @param {CreatorMetadata} metadata */
export function createHostConfigFiles(name, metadata) {
  const manifest = createHostManifest(name, metadata);
  assertCreatorVersionParity(manifest, metadata);
  return {
    "package.json": json(manifest),
    "zudo-composer.config.ts": `import { defineComposerConfig } from "zudo-composer/config";\n\nexport default defineComposerConfig({\n  pack: ${JSON.stringify(`${name}/components`)},\n});\n`,
    "tsconfig.json": json({
      compilerOptions: {
        target: "ES2023", lib: ["ES2023", "DOM", "DOM.Iterable"], module: "ESNext", moduleResolution: "Bundler",
        resolveJsonModule: true, verbatimModuleSyntax: true, moduleDetection: "force", noEmit: true,
        strict: true, skipLibCheck: true, jsx: "react-jsx", jsxImportSource: "preact", types: ["node"],
      },
      include: ["components", "site-project.ts", "zudo-composer.config.ts", "vitest.config.ts", "tests"],
    }),
    "vitest.config.ts": `import { defineConfig } from "vitest/config";\n\nexport default defineConfig({\n  oxc: { jsx: { runtime: "automatic", importSource: "preact" } },\n  resolve: { dedupe: ["preact"] },\n  test: {\n    include: ["tests/**/*.spec.tsx"],\n    environment: "node",\n    testTimeout: 60_000,\n  },\n});\n`,
    ".gitignore": HOST_GITIGNORE,
    ".npmrc": "block-exotic-subdeps=false\n",
    "pnpm-workspace.yaml": "packages:\n  - .\n\n# Required while an installed provider uses its exact Git pin.\nblockExoticSubdeps: false\n\nallowBuilds:\n  esbuild: true\n",
  };
}

/** Copy the base tree verbatim, then add only the code-generated configuration.
 * The caller owns this fresh directory. No network, CMS writer or git mutation.
 * @param {string} root @param {string} name @param {CreatorMetadata} metadata */
export async function writeHostProject(root, name, metadata) {
  const files = createHostConfigFiles(name, metadata);
  await cp(HOST_TEMPLATE_ROOT, root, { recursive: true, force: false, errorOnExist: true });
  for (const [path, source] of Object.entries(files)) await writeFile(join(root, path), source, { flag: "wx" });
  assertCreatorVersionParity(JSON.parse(await readFile(join(root, "package.json"), "utf8")), metadata);
}
