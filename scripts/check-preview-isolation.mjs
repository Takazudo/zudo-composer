// @ts-check
// `pnpm styles:isolation` — fails the build if editor CSS reaches the
// composer canvas preview, the local site-preview document, or the published
// static site, so the separation landed by #717, #721 and #722 cannot
// regress. See `src/styles/README.md` for the three CSS graphs this checks.
//
// `plugins/entry-graph-plugin.mjs` records, per start module, every module id
// its real build reaches and the CSS file names of the chunks those modules
// landed in. A Vite manifest carries no source module ids, and the static
// site's start module resolves through `virtual:site-static-project`, so
// neither a manifest walk nor a source-import regex could stand in for a real
// reachability walk. This script reads that `entry-graph.json` from the three
// real builds — building any that are missing — and matches it against the
// editor-only source, selector and custom-property markers.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ENTRY_GRAPH_FILE_NAME, SITE_PREVIEW_ENTRY_MODULE, STATIC_SITE_ENTRY_MODULE } from "../plugins/entry-graph-plugin.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** @typedef {import("../plugins/entry-graph-plugin.d.mts").EntryGraph} EntryGraph */

// Every reached id under these package-relative patterns is the editor chrome
// sheet reaching a preview or site document — the exact regression #717 and
// #721 fixed. Applies to every entry in every graph, including the composer
// canvas preview.
/** @type {Array<{label: string, test: (id: string) => boolean}>} */
const FORBIDDEN_SOURCE_PATTERNS = [
  { label: "src/base.css", test: (id) => id === "src/base.css" },
  { label: "src/style.css", test: (id) => id === "src/style.css" },
  { label: "src/styles/app-tokens.css", test: (id) => id === "src/styles/app-tokens.css" },
  { label: "src/app/**/*.css", test: (id) => id.startsWith("src/app/") && id.endsWith(".css") },
  { label: "src/components/**/*.css", test: (id) => id.startsWith("src/components/") && id.endsWith(".css") },
  {
    label: "src/features/*/styles.css",
    // Delivery owns the visitor document itself, so its own stylesheet (were
    // it ever to reappear) is not an editor-chrome leak the way every other
    // feature's `styles.css` is.
    test: (id) => /^src\/features\/[^/]+\/styles\.css$/.test(id) && id !== "src/features/delivery/styles.css",
  },
];

// The visitor document's theme deliberately follows the OS, not the editor's
// stored preference (epic #716's "Theme of the visitor document" decision),
// so only the entries that mount a visitor document are checked for it. The
// composer canvas preview is not a visitor document.
const THEME_MODULE = "src/theme/theme.ts";
const THEME_RESTRICTED_ENTRIES = new Set([SITE_PREVIEW_ENTRY_MODULE, STATIC_SITE_ENTRY_MODULE]);

// A class or custom property only the editor chrome declares. `--zc-preview-*`
// and `--zc-strip-*` are the scoped tokens the canvas chrome and the preview
// strip own outright, so only these specific editor-chrome names are forbidden.
const FORBIDDEN_SELECTOR_PATTERN = /\.(?:cms|sg)-[A-Za-z0-9_-]+/;
const FORBIDDEN_CUSTOM_PROPERTIES = ["--sp-", "--zc-topbar", "--sg-header"];

/** @param {string} directory @returns {string[]} */
function filesUnderSorted(directory) {
  /** @type {string[]} */
  const files = [];
  const entries = [...readdirSync(directory, { withFileTypes: true })].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...filesUnderSorted(path));
    else files.push(path);
  }
  return files;
}

/**
 * The first `mt-vsp-*` utility class used in `packages/ui/src`, in sorted
 * file order. Its selector is the positive half of this gate: even without
 * `base.css`, the host sheet's Tailwind `@source` still scans the pack and
 * generates its utilities, so that class reaching a preview or site document
 * is expected, not a leak. If none is emitted, `@source` stopped scanning the
 * pack and the gate would otherwise pass on an empty, meaningless graph.
 * @param {string} toolRoot
 * @returns {string}
 */
export function findSentinelUtility(toolRoot) {
  for (const file of filesUnderSorted(join(toolRoot, "packages/ui/src"))) {
    const match = readFileSync(file, "utf8").match(/\bmt-vsp-[a-zA-Z0-9]+\b/);
    if (match) return match[0];
  }
  throw new Error("No mt-vsp-* utility found in packages/ui/src to use as the isolation gate's sentinel.");
}

/**
 * @param {{
 *   graphLabel: string,
 *   entryKey: string,
 *   moduleIds: string[],
 *   cssFileNames: string[],
 *   readCss: (cssFileName: string) => string,
 *   sentinelClass: string,
 * }} options
 * @returns {string[]}
 */
export function evaluateEntry({ graphLabel, entryKey, moduleIds, cssFileNames, readCss, sentinelClass }) {
  const prefix = `${graphLabel} ${entryKey}`;
  /** @type {string[]} */
  const offenders = [];

  for (const pattern of FORBIDDEN_SOURCE_PATTERNS) {
    for (const id of moduleIds) {
      if (pattern.test(id)) offenders.push(`${prefix} reaches ${id} (${pattern.label})`);
    }
  }
  if (THEME_RESTRICTED_ENTRIES.has(entryKey) && moduleIds.includes(THEME_MODULE)) {
    offenders.push(`${prefix} reaches ${THEME_MODULE}, but its document must follow the OS theme, not the editor's stored preference`);
  }

  const css = cssFileNames.map((fileName) => ({ fileName, text: readCss(fileName) }));
  for (const { fileName, text } of css) {
    const selector = text.match(FORBIDDEN_SELECTOR_PATTERN);
    if (selector) offenders.push(`${prefix} emits ${fileName}, which declares editor selector ${selector[0]}`);
    for (const property of FORBIDDEN_CUSTOM_PROPERTIES) {
      if (text.includes(property)) offenders.push(`${prefix} emits ${fileName}, which declares editor custom property ${property}`);
    }
  }

  const sentinelSelector = `.${sentinelClass}{`;
  if (!css.some(({ text }) => text.includes(sentinelSelector))) {
    offenders.push(`${prefix}: no emitted CSS declares ${sentinelSelector} — the host sheet's Tailwind @source no longer reaches the pack`);
  }

  return offenders;
}

/**
 * @param {{graphLabel: string, graph: EntryGraph, readCss: (cssFileName: string) => string, sentinelClass: string}} options
 * @returns {string[]}
 */
export function evaluateEntryGraph({ graphLabel, graph, readCss, sentinelClass }) {
  assert.equal(graph.schemaVersion, 1, `${graphLabel}/${ENTRY_GRAPH_FILE_NAME} has an unknown schemaVersion`);
  /** @type {string[]} */
  const offenders = [];
  for (const [entryKey, entry] of Object.entries(graph.entries)) {
    offenders.push(...evaluateEntry({ graphLabel, entryKey, moduleIds: entry.moduleIds, cssFileNames: entry.cssFileNames, readCss, sentinelClass }));
  }
  return offenders;
}

/** @param {string} graphPath @returns {EntryGraph} */
export function readEntryGraph(graphPath) {
  return JSON.parse(readFileSync(graphPath, "utf8"));
}

/**
 * Read one build's `entry-graph.json` and its referenced CSS from disk, and
 * evaluate every entry it records.
 * @param {{graphLabel: string, graphPath: string, outDir: string, sentinelClass: string}} options
 * @returns {string[]}
 */
export function checkEntryGraphFile({ graphLabel, graphPath, outDir, sentinelClass }) {
  return evaluateEntryGraph({
    graphLabel,
    graph: readEntryGraph(graphPath),
    readCss: (cssFileName) => readFileSync(join(outDir, cssFileName), "utf8"),
    sentinelClass,
  });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const targets = [
    {
      label: "dist",
      outDir: join(root, "dist"),
      build: () => spawnSync("pnpm", ["build"], { cwd: root, stdio: "inherit" }),
    },
    {
      label: "packages/demo-sample/dist-editor",
      outDir: join(root, "packages/demo-sample/dist-editor"),
      build: () => spawnSync("pnpm", ["demo:build-editor", "sample"], { cwd: root, stdio: "inherit" }),
    },
    {
      label: "packages/demo-sample/dist-site",
      outDir: join(root, "packages/demo-sample/dist-site"),
      build: () => spawnSync("pnpm", ["demo:build-site", "sample"], { cwd: root, stdio: "inherit" }),
    },
  ].map((target) => ({ ...target, graphPath: join(target.outDir, ENTRY_GRAPH_FILE_NAME) }));

  const sentinelClass = findSentinelUtility(root);
  /** @type {string[]} */
  const offenders = [];
  let entryCount = 0;
  for (const target of targets) {
    if (!existsSync(target.graphPath)) {
      console.log(`No ${target.graphPath}; building ${target.label}…`);
      const result = target.build();
      if (result.error) throw result.error;
      if (result.status !== 0) {
        console.error(`Building ${target.label} failed${result.signal ? ` (${result.signal})` : ""}.`);
        process.exit(result.status ?? 1);
      }
    }
    assert.ok(existsSync(target.graphPath), `${target.graphPath} was not produced by building ${target.label}.`);
    const graph = readEntryGraph(target.graphPath);
    entryCount += Object.keys(graph.entries).length;
    offenders.push(...evaluateEntryGraph({
      graphLabel: target.label,
      graph,
      readCss: (cssFileName) => readFileSync(join(target.outDir, cssFileName), "utf8"),
      sentinelClass,
    }));
  }

  assert.deepEqual(offenders, [], `Preview isolation gate failed:\n  ${offenders.join("\n  ")}`);
  console.log(`Preview isolation gate passed: ${targets.length} builds, ${entryCount} entries checked, sentinel .${sentinelClass}.`);
}
