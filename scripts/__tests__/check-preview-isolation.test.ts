import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkEntryGraphFile, evaluateEntry, evaluateEntryGraph, findSentinelUtility, readEntryGraph } from "../check-preview-isolation.mjs";
import { APP_ROOT } from "../../plugins/roots.mjs";
import { COMPOSER_PREVIEW_ENTRY_MODULE, ENTRY_GRAPH_FILE_NAME, SITE_PREVIEW_ENTRY_MODULE, STATIC_SITE_ENTRY_MODULE } from "../../plugins/entry-graph-plugin.mjs";

const SENTINEL = "mt-vsp-sm";
const CLEAN_CSS = ".mt-vsp-sm{margin-top:var(--spacing-vsp-sm)}\n.some-pack-thing{color:red}\n";

function css(record: Record<string, string>): (fileName: string) => string {
  return (fileName) => {
    if (!(fileName in record)) throw new Error(`No fixture CSS for ${fileName}`);
    return record[fileName];
  };
}

describe("findSentinelUtility", () => {
  it("reads the first mt-vsp-* class used in packages/ui/src", () => {
    expect(findSentinelUtility(APP_ROOT)).toBe(SENTINEL);
  });
});

describe("evaluateEntry", () => {
  const base = { graphLabel: "dist", entryKey: COMPOSER_PREVIEW_ENTRY_MODULE, sentinelClass: SENTINEL };

  it("passes a clean entry", () => {
    const offenders = evaluateEntry({
      ...base,
      moduleIds: ["src/features/composer/preview/preview-entry.ts", "src/features/composer/preview/preview.css"],
      cssFileNames: ["assets/preview-entry-abc.css"],
      readCss: css({ "assets/preview-entry-abc.css": CLEAN_CSS }),
    });
    expect(offenders).toEqual([]);
  });

  it.each([
    ["src/base.css", "src/base.css"],
    ["src/style.css", "src/style.css"],
    ["src/styles/app-tokens.css", "src/styles/app-tokens.css"],
    ["src/app/shell.css", "src/app/**/*.css"],
    ["src/components/ui/ui.css", "src/components/**/*.css"],
    ["src/features/composer/styles.css", "src/features/*/styles.css"],
  ])("flags a reached %s", (id, label) => {
    const offenders = evaluateEntry({
      ...base,
      moduleIds: [id],
      cssFileNames: ["assets/entry.css"],
      readCss: css({ "assets/entry.css": CLEAN_CSS }),
    });
    expect(offenders.some((message) => message.includes(id) && message.includes(label))).toBe(true);
  });

  it("does not flag delivery's own styles.css", () => {
    const offenders = evaluateEntry({
      ...base,
      moduleIds: ["src/features/delivery/styles.css"],
      cssFileNames: ["assets/entry.css"],
      readCss: css({ "assets/entry.css": CLEAN_CSS }),
    });
    expect(offenders).toEqual([]);
  });

  it("flags src/theme/theme.ts only for the site-preview and static entries, not the composer canvas", () => {
    const forComposer = evaluateEntry({
      ...base,
      entryKey: COMPOSER_PREVIEW_ENTRY_MODULE,
      moduleIds: ["src/theme/theme.ts"],
      cssFileNames: ["assets/entry.css"],
      readCss: css({ "assets/entry.css": CLEAN_CSS }),
    });
    expect(forComposer).toEqual([]);

    for (const entryKey of [SITE_PREVIEW_ENTRY_MODULE, STATIC_SITE_ENTRY_MODULE]) {
      const offenders = evaluateEntry({
        ...base,
        entryKey,
        moduleIds: ["src/theme/theme.ts"],
        cssFileNames: ["assets/entry.css"],
        readCss: css({ "assets/entry.css": CLEAN_CSS }),
      });
      expect(offenders.some((message) => message.includes("src/theme/theme.ts"))).toBe(true);
    }
  });

  it.each([".cms-tree{", ".sg-header{"])("flags editor selector %s in emitted CSS", (selector) => {
    const offenders = evaluateEntry({
      ...base,
      moduleIds: [],
      cssFileNames: ["assets/entry.css"],
      readCss: css({ "assets/entry.css": `${CLEAN_CSS}${selector}color:red}\n` }),
    });
    expect(offenders.some((message) => message.includes("editor selector"))).toBe(true);
  });

  it.each(["--sp-1", "--zc-topbar-h", "--sg-header-h"])("flags the editor custom property %s", (property) => {
    const offenders = evaluateEntry({
      ...base,
      moduleIds: [],
      cssFileNames: ["assets/entry.css"],
      readCss: css({ "assets/entry.css": `${CLEAN_CSS}:root{${property}:1px}\n` }),
    });
    expect(offenders.some((message) => message.includes("editor custom property"))).toBe(true);
  });

  it("does not flag the canvas chrome's own --zc-preview- or the strip's --zc-strip- tokens", () => {
    const offenders = evaluateEntry({
      ...base,
      moduleIds: [],
      cssFileNames: ["assets/entry.css"],
      readCss: css({ "assets/entry.css": `${CLEAN_CSS}:root{--zc-preview-bg:#fff;--zc-strip-bg:#000}\n` }),
    });
    expect(offenders).toEqual([]);
  });

  it("flags a missing sentinel utility", () => {
    const offenders = evaluateEntry({
      ...base,
      moduleIds: [],
      cssFileNames: ["assets/entry.css"],
      readCss: css({ "assets/entry.css": ".some-pack-thing{color:red}\n" }),
    });
    expect(offenders).toEqual([`dist ${COMPOSER_PREVIEW_ENTRY_MODULE}: no emitted CSS declares .${SENTINEL}{ — the host sheet's Tailwind @source no longer reaches the pack`]);
  });

  it("flags a missing sentinel when an entry emits no CSS at all", () => {
    const offenders = evaluateEntry({ ...base, moduleIds: [], cssFileNames: [], readCss: css({}) });
    expect(offenders).toHaveLength(1);
    expect(offenders[0]).toContain("no emitted CSS declares");
  });
});

describe("evaluateEntryGraph", () => {
  it("rejects an unknown schemaVersion", () => {
    const graph = JSON.parse('{"schemaVersion":2,"entries":{}}');
    expect(() => evaluateEntryGraph({ graphLabel: "dist", graph, readCss: css({}), sentinelClass: SENTINEL })).toThrow(/schemaVersion/);
  });

  it("evaluates every entry and prefixes offenders with the graph label and entry key", () => {
    const offenders = evaluateEntryGraph({
      graphLabel: "dist",
      graph: {
        schemaVersion: 1,
        entries: { [COMPOSER_PREVIEW_ENTRY_MODULE]: { moduleIds: ["src/base.css"], cssFileNames: ["assets/entry.css"] } },
      },
      readCss: css({ "assets/entry.css": CLEAN_CSS }),
      sentinelClass: SENTINEL,
    });
    expect(offenders).toEqual([`dist ${COMPOSER_PREVIEW_ENTRY_MODULE} reaches src/base.css (src/base.css)`]);
  });
});

describe("checkEntryGraphFile", () => {
  const directories: string[] = [];
  afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

  it("passes a clean on-disk build's entry-graph.json and referenced CSS", async () => {
    const directory = await mkdtemp(join(tmpdir(), "entry-graph-"));
    directories.push(directory);
    await mkdir(join(directory, "assets"), { recursive: true });
    await writeFile(join(directory, "assets/entry.css"), CLEAN_CSS);
    const graph = {
      schemaVersion: 1,
      entries: {
        [SITE_PREVIEW_ENTRY_MODULE]: {
          moduleIds: ["src/features/delivery/preview-entry.ts", "src/features/delivery/visitor.css"],
          cssFileNames: ["assets/entry.css"],
        },
      },
    };
    await writeFile(join(directory, ENTRY_GRAPH_FILE_NAME), JSON.stringify(graph));
    const offenders = checkEntryGraphFile({ graphLabel: "fixture", graphPath: join(directory, ENTRY_GRAPH_FILE_NAME), outDir: directory, sentinelClass: SENTINEL });
    expect(offenders).toEqual([]);
    expect(readEntryGraph(join(directory, ENTRY_GRAPH_FILE_NAME))).toEqual(graph);
  });

  it("fails a fixture whose site-preview entry reached base.css — the acceptance criterion's regression shape", async () => {
    const directory = await mkdtemp(join(tmpdir(), "entry-graph-"));
    directories.push(directory);
    await mkdir(join(directory, "assets"), { recursive: true });
    await writeFile(join(directory, "assets/entry.css"), CLEAN_CSS);
    const graph = {
      schemaVersion: 1,
      entries: {
        [SITE_PREVIEW_ENTRY_MODULE]: {
          moduleIds: ["src/features/delivery/preview-entry.ts", "src/base.css"],
          cssFileNames: ["assets/entry.css"],
        },
      },
    };
    await writeFile(join(directory, ENTRY_GRAPH_FILE_NAME), JSON.stringify(graph));
    const offenders = checkEntryGraphFile({ graphLabel: "fixture", graphPath: join(directory, ENTRY_GRAPH_FILE_NAME), outDir: directory, sentinelClass: SENTINEL });
    expect(offenders).toEqual([`fixture ${SITE_PREVIEW_ENTRY_MODULE} reaches src/base.css (src/base.css)`]);
  });
});
