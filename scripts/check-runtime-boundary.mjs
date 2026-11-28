// @ts-check

// The single-UI-runtime boundary. The tool, its owned packs, the demo hosts and
// the tool-owned fixtures run on zudo-react from `@takazudo/zfb`; nothing may
// bring Preact back, and the tool's runtime graph may resolve exactly one
// `@takazudo/zfb` — the version the tool peers on. The `doc` member is a
// separate documentation graph on its own ZFB release and is not part of it.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";

export const RUNTIME_PACKAGE = "@takazudo/zfb";
/** Lockfile importers outside the tool's runtime graph. */
export const SEPARATE_GRAPH_IMPORTERS = Object.freeze(["doc"]);

const PREACT_NAME = /^(?:preact|preact-[a-z0-9-]+|@preact\/[a-z0-9._-]+|@testing-library\/preact)$/;
const PREACT_SPECIFIER = String.raw`(?:preact(?:-[a-z0-9-]+)?|@preact\/[a-z0-9._-]+|@testing-library\/preact)(?:\/[^"'\`\s]*)?`;
const SOURCE_PATTERNS = [
  new RegExp(String.raw`\bfrom\s*(["'\`])${PREACT_SPECIFIER}\1`, "g"),
  new RegExp(String.raw`\bimport\s*(["'\`])${PREACT_SPECIFIER}\1`, "g"),
  new RegExp(String.raw`\b(?:import|require)\s*\(\s*(["'\`])${PREACT_SPECIFIER}\1\s*\)`, "g"),
  new RegExp(String.raw`["']?jsxImportSource["']?\s*[:=]\s*(["'\`])${PREACT_SPECIFIER}\1`, "g"),
];

/** True when a package name is Preact or one of its satellite packages. @param {string} name */
export function isPreactPackage(name) {
  return PREACT_NAME.test(name);
}

/** Every Preact import, require or JSX import source in one source text. @param {string} text @returns {string[]} */
export function findPreactSpecifiers(text) {
  return SOURCE_PATTERNS.flatMap((pattern) => [...text.matchAll(pattern)].map((match) => match[0]));
}

/** Preact entries in a manifest's dependency fields. @param {Record<string, unknown>} manifest @returns {string[]} */
export function findPreactDependencies(manifest) {
  return ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].flatMap((field) => {
    const entries = /** @type {Record<string, string> | undefined} */ (manifest[field]);
    return Object.keys(entries ?? {}).filter(isPreactPackage).map((name) => `${field}.${name}`);
  });
}

/** @param {string} key a lockfile package or snapshot key @returns {string} */
function packageNameOf(key) {
  const at = key.indexOf("@", key.startsWith("@") ? 1 : 0);
  return at < 0 ? key : key.slice(0, at);
}

/**
 * Preact packages anywhere in the lockfile, and the `@takazudo/zfb` versions
 * reachable from the tool's importers.
 * @param {string} lockText
 * @param {{ peerVersion: string, separateImporters?: readonly string[] }} options
 * @returns {string[]}
 */
export function lockRuntimeViolations(lockText, { peerVersion, separateImporters = SEPARATE_GRAPH_IMPORTERS }) {
  const lock = /** @type {{ importers?: Record<string, any>, packages?: Record<string, unknown>, snapshots?: Record<string, any> }} */ (parse(lockText) ?? {});
  const violations = [];
  for (const key of [...Object.keys(lock.packages ?? {}), ...Object.keys(lock.snapshots ?? {})]) {
    if (isPreactPackage(packageNameOf(key))) violations.push(`lockfile resolves ${key}`);
  }
  const snapshots = lock.snapshots ?? {};
  /** @type {Set<string>} */
  const versions = new Set();
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {string[]} */
  const queue = [];
  /** @param {string} name @param {string} version */
  const visit = (name, version) => {
    if (version.startsWith("link:")) return;
    if (name === RUNTIME_PACKAGE) versions.add(version.replace(/\(.*$/, ""));
    const key = `${name}@${version}`;
    if (!seen.has(key)) { seen.add(key); queue.push(key); }
  };
  for (const [path, importer] of Object.entries(lock.importers ?? {})) {
    if (separateImporters.includes(path)) continue;
    for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
      for (const [name, entry] of Object.entries(importer?.[field] ?? {})) {
        if (isPreactPackage(name)) violations.push(`importer ${path} declares ${name}`);
        visit(name, String(/** @type {{ version: string }} */ (entry).version));
      }
    }
  }
  while (queue.length > 0) {
    const snapshot = snapshots[/** @type {string} */ (queue.shift())];
    for (const field of ["dependencies", "optionalDependencies"]) {
      for (const [name, version] of Object.entries(snapshot?.[field] ?? {})) visit(name, String(version));
    }
  }
  if (versions.size === 0) violations.push(`the tool's runtime graph resolves no ${RUNTIME_PACKAGE}`);
  for (const version of [...versions].sort()) {
    if (version !== peerVersion) violations.push(`the tool's runtime graph resolves ${RUNTIME_PACKAGE}@${version}; only the peer ${peerVersion} is allowed`);
  }
  return violations;
}

const SOURCE_EXTENSIONS = /\.(?:[cm]?[jt]sx?|json)$/;
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", "dist-site", "dist-editor", ".git", "__tests__", "__fixtures__", ".vite", "coverage"]);

/** @param {string} directory @returns {string[]} */
function sourceFiles(directory) {
  /** @type {string[]} */
  const files = [];
  let entries;
  try { entries = readdirSync(directory, { withFileTypes: true }); } catch { return files; }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) files.push(...sourceFiles(path));
    } else if (entry.isFile() && SOURCE_EXTENSIONS.test(entry.name) && !/\.test\.[cm]?[jt]sx?$/.test(entry.name) && entry.name !== "pnpm-lock.yaml") {
      files.push(path);
    }
  }
  return files;
}

/** @param {string} root @returns {string[]} */
export function checkRepository(root) {
  const read = (/** @type {string} */ path) => readFileSync(join(root, path), "utf8");
  const manifest = JSON.parse(read("package.json"));
  const peerVersion = manifest.peerDependencies?.[RUNTIME_PACKAGE];
  /** @type {string[]} */
  const violations = [];
  if (typeof peerVersion !== "string") violations.push(`package.json must peer on ${RUNTIME_PACKAGE}`);

  const sourceRoots = ["src", "server", "plugins", "bin", "packages", "fixtures", "tests/browser-dev", "tests/zudo-react-proof"];
  for (const styleguide of readdirSync(join(root, "styleguide"))) {
    if (!statSync(join(root, "styleguide", styleguide)).isDirectory()) continue;
    for (const part of ["stories", "preview", "src", "pages", "scripts", "tests"]) sourceRoots.push(join("styleguide", styleguide, part));
  }
  for (const sourceRoot of sourceRoots) {
    for (const file of sourceFiles(join(root, sourceRoot))) {
      const path = relative(root, file).split(sep).join("/");
      for (const match of findPreactSpecifiers(readFileSync(file, "utf8"))) violations.push(`${path}: ${match}`);
    }
  }

  const manifests = ["package.json", ...["packages", "fixtures", "styleguide"].flatMap((parent) =>
    readdirSync(join(root, parent)).map((name) => `${parent}/${name}/package.json`))];
  for (const path of manifests) {
    let parsed;
    try { parsed = JSON.parse(read(path)); } catch { continue; }
    for (const entry of findPreactDependencies(parsed)) violations.push(`${path}: ${entry}`);
  }

  if (typeof peerVersion === "string") violations.push(...lockRuntimeViolations(read("pnpm-lock.yaml"), { peerVersion }));
  return violations;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const violations = checkRepository(resolve(import.meta.dirname, ".."));
  if (violations.length > 0) {
    console.error(`Runtime boundary failed (${violations.length}):\n${violations.map((item) => `- ${item}`).join("\n")}`);
    process.exit(1);
  }
  console.log("Runtime boundary passed: no Preact specifier, manifest entry or lockfile package; one @takazudo/zfb in the tool graph.");
}
