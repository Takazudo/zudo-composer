// @vitest-environment node
// A duplicate zudo-react runtime fails silently (a signal from the second copy
// binds with no diagnostic and never updates; R0 #1003), so one runtime is
// enforced by construction. These guards pin each piece of that construction.
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { INLINED_RUNTIME_MARKER } from "../../scripts/zudo-react-boundary.mjs";
import { ZUDO_REACT_DEV_ENTRIES, devPrebundleIncludes } from "../dev-prebundle.mjs";
import { ZUDO_REACT_JSX_IMPORT_SOURCE, ZUDO_REACT_PACKAGE, resolveComposerModules, zudoReactOxc, zudoReactSsr } from "../module-resolution.mjs";
import zudoReactIdentityPlugin, { zudoReactRuntimeOrigin } from "../zudo-react-identity-plugin.mjs";

const repo = resolve(import.meta.dirname, "../..");
const SUBPATHS = ["", "/jsx-runtime", "/jsx-dev-runtime", "/client", "/server", "/testing"].map((sub) => `${ZUDO_REACT_JSX_IMPORT_SOURCE}${sub}`);
// Tool-graph workspace members. `doc` is a separate zfb application graph and keeps its own pin.
const TOOL_GRAPH = [".", "fixtures/host", "fixtures/themeset-host", "packages/ui", "packages/fixture-themeset", "packages/demo-sample", "packages/demo-webshop", "packages/demo-landing", "packages/demo-blog"];
const readJson = (path: string) => JSON.parse(readFileSync(join(repo, path), "utf8"));

describe("one zudo-react runtime in the tool graph", () => {
  it("resolves every public subpath to one realpath directory from the tool and from every pack and host", () => {
    const resolved = new Set<string>();
    for (const member of TOOL_GRAPH) {
      const require = createRequire(join(repo, member, "package.json"));
      for (const subpath of SUBPATHS) resolved.add(dirname(realpathSync(require.resolve(subpath))));
    }
    expect([...resolved]).toHaveLength(1);
  });

  it("locks exactly one @takazudo/zfb version for every tool-graph importer, equal to the tool's peer", () => {
    const peer = readJson("package.json").peerDependencies[ZUDO_REACT_PACKAGE];
    expect(peer).toMatch(/^\d+\.\d+\.\d+$/);
    const lock = parse(readFileSync(join(repo, "pnpm-lock.yaml"), "utf8")) as { importers: Record<string, Record<string, Record<string, { version: string }> | undefined>> };
    const versions = new Set<string>();
    for (const member of TOOL_GRAPH) {
      const importer = lock.importers[member]!;
      for (const section of ["dependencies", "devDependencies"]) {
        const entry = importer[section]?.[ZUDO_REACT_PACKAGE];
        if (entry) versions.add(entry.version.replace(/\(.*$/, ""));
      }
    }
    expect([...versions]).toEqual([peer]);
  });

  it("names @takazudo/zfb, never preact, as the runtime peer of the tool and every pack", () => {
    const peer = readJson("package.json").peerDependencies[ZUDO_REACT_PACKAGE];
    for (const path of ["package.json", "packages/ui/package.json", "packages/fixture-themeset/package.json"]) {
      const manifest = readJson(path);
      expect(manifest.peerDependencies[ZUDO_REACT_PACKAGE], path).toBe(peer);
      expect(manifest.peerDependencies.preact, path).toBeUndefined();
    }
  });

  it("dedupes the package, keeps it SSR-external and prebundles every dev entry", () => {
    expect(resolveComposerModules().dedupe).toEqual([ZUDO_REACT_PACKAGE]);
    expect(zudoReactSsr().external).toEqual([ZUDO_REACT_PACKAGE]);
    expect(zudoReactOxc()).toEqual({ jsx: { runtime: "automatic", importSource: ZUDO_REACT_JSX_IMPORT_SOURCE } });
    const includes = devPrebundleIncludes({ workspaceRoot: repo, pack: "@zudo-composer/ui/composer-pack" });
    expect(includes.filter((entry) => entry.startsWith(ZUDO_REACT_PACKAGE))).toEqual([...ZUDO_REACT_DEV_ENTRIES]);
    // Every runtime entry compiled JSX or a client mount reaches; a subset would duplicate.
    expect(new Set(ZUDO_REACT_DEV_ENTRIES)).toEqual(new Set(SUBPATHS.filter((id) => !/\/(?:server|testing)$/.test(id))));
  });

  it("classifies optimized and raw runtime files as different origins", () => {
    const raw = createRequire(join(repo, "package.json")).resolve(ZUDO_REACT_JSX_IMPORT_SOURCE);
    expect(zudoReactRuntimeOrigin(raw)).toBe(`package:${realpathSync(dirname(createRequire(join(repo, "package.json")).resolve(`${ZUDO_REACT_PACKAGE}/package.json`)))}`);
    expect(zudoReactRuntimeOrigin("/host/node_modules/.vite/deps/@takazudo_zfb_zudo-react.js?v=1")).toBe("optimized:/host/node_modules/.vite/deps");
  });
});

describe("Vite dev prebundle identity", () => {
  let root = "";

  beforeAll(() => {
    // Inside the repo's ignored node_modules cache: Vite only serves files under fs.allow.
    const cache = join(repo, "node_modules/.cache");
    mkdirSync(cache, { recursive: true });
    root = mkdtempSync(join(cache, "zr-vite-"));
    const zfb = dirname(createRequire(join(repo, "package.json")).resolve(`${ZUDO_REACT_PACKAGE}/package.json`));
    mkdirSync(join(root, "node_modules/@takazudo"), { recursive: true });
    symlinkSync(zfb, join(root, "node_modules/@takazudo/zfb"));
    mkdirSync(join(root, "src"));
    mkdirSync(join(root, "pack"));
    writeFileSync(join(root, "package.json"), '{"name":"probe","private":true,"type":"module"}');
    writeFileSync(join(root, "pack/card.tsx"), 'import { getScope } from "@takazudo/zfb/zudo-react";\nexport function Card() { getScope(); return <b>pack</b>; }\n');
    writeFileSync(join(root, "src/tool.tsx"), 'import { signal } from "@takazudo/zfb/zudo-react";\nimport { mount } from "@takazudo/zfb/zudo-react/client";\nimport { Card } from "../pack/card";\nexport const s = signal(0);\nexport { mount, Card };\nexport const el = <i>tool</i>;\n');
  });
  afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

  async function servedGraph(mode: "all" | "partial" | "exclude") {
    const server = await createServer({
      root, configFile: false, logLevel: "silent", cacheDir: join(root, `.vite-${mode}`),
      server: { middlewareMode: true, hmr: false, fs: { allow: [root, repo] } },
      oxc: zudoReactOxc(),
      resolve: { dedupe: [ZUDO_REACT_PACKAGE] },
      plugins: [zudoReactIdentityPlugin()],
      optimizeDeps: {
        include: mode === "all" ? [...ZUDO_REACT_DEV_ENTRIES] : mode === "partial" ? [`${ZUDO_REACT_JSX_IMPORT_SOURCE}/client`] : [],
        exclude: mode === "exclude" ? [ZUDO_REACT_PACKAGE] : [],
        noDiscovery: true, force: true,
      },
    });
    try {
      const imports: string[] = [];
      let refused: unknown;
      for (const id of ["/src/tool.tsx", "/pack/card.tsx"]) {
        try {
          const result = await server.transformRequest(id);
          for (const match of result!.code.matchAll(/from\s+"([^"]+)"/g)) {
            if (/zudo-react|takazudo_zfb/.test(match[1]!)) imports.push(match[1]!.replace(/\?v=\w+$/, ""));
          }
        } catch (error) {
          refused ??= error;
        }
      }
      const optimizedClient = imports.find((url) => url.includes("deps/@takazudo_zfb_zudo-react_client.js"));
      const clientCode = optimizedClient ? readFileSync(join(root, optimizedClient.replace(/^\//, "")), "utf8") : "";
      return { imports: [...new Set(imports)], refused, clientInlinesRuntime: INLINED_RUNTIME_MARKER.test(clientCode) };
    } finally {
      await server.close();
    }
  }

  it("prebundling the tool's dev entries gives tool and pack one optimized runtime", async () => {
    const graph = await servedGraph("all");
    expect(graph.refused).toBeUndefined();
    expect(graph.imports.length).toBeGreaterThanOrEqual(3);
    expect(graph.imports.every((url) => url.includes("/deps/@takazudo_zfb_zudo-react"))).toBe(true);
    expect(graph.clientInlinesRuntime).toBe(false);
  }, 60_000);

  it("excluding the package serves every subpath from the same package files", async () => {
    const graph = await servedGraph("exclude");
    expect(graph.refused).toBeUndefined();
    expect(graph.imports.length).toBeGreaterThanOrEqual(3);
    expect(graph.imports.every((url) => url.includes("/zfb/dist/zudo-react/"))).toBe(true);
  }, 60_000);

  it("refuses a partial prebundle, which would inline a private scheduler copy", async () => {
    const graph = await servedGraph("partial");
    expect(String(graph.refused)).toMatch(/Two zudo-react runtimes in one graph/);
  }, 60_000);
});

describe("Vite dev prebundle identity for a host outside the repository", () => {
  // `zudo-composer dev` roots Vite at the host, so the tool's own source is an
  // out-of-root importer reached through /@fs, and the dependency scanner runs.
  let host = "";
  let tool = "";

  beforeAll(() => {
    host = realpathSync(mkdtempSync(join(tmpdir(), "zr-out-of-root-host-")));
    const cache = join(repo, "node_modules/.cache");
    mkdirSync(cache, { recursive: true });
    tool = mkdtempSync(join(cache, "zr-out-of-root-tool-"));
    mkdirSync(join(host, "node_modules/@takazudo"), { recursive: true });
    // As prepared hosts do: a symlink to the repository's own symlinked package.
    symlinkSync(join(repo, "node_modules/@takazudo/zfb"), join(host, "node_modules/@takazudo/zfb"));
    writeFileSync(join(host, "package.json"), '{"name":"out-of-root-host","private":true,"type":"module"}');
    writeFileSync(join(tool, "sync-value.ts"), 'import { signal } from "@takazudo/zfb/zudo-react";\nexport const s = signal(0);\n');
    writeFileSync(join(tool, "main.tsx"), 'import { mount } from "@takazudo/zfb/zudo-react/client";\nimport { s } from "./sync-value";\nexport const el = <i>{s}</i>;\nexport { mount };\n');
  });
  afterAll(() => {
    if (host) rmSync(host, { recursive: true, force: true });
    if (tool) rmSync(tool, { recursive: true, force: true });
  });

  async function servedGraph(mode: "all" | "exclude") {
    const server = await createServer({
      root: host, configFile: false, logLevel: "silent", cacheDir: join(host, `node_modules/.vite-${mode}`),
      server: { middlewareMode: true, hmr: false, fs: { allow: [host, repo] } },
      oxc: zudoReactOxc(),
      resolve: { dedupe: [ZUDO_REACT_PACKAGE] },
      plugins: [zudoReactIdentityPlugin()],
      optimizeDeps: {
        // A real scan from the out-of-root entry, as the dev server configures it.
        entries: [join(tool, "main.tsx")],
        include: mode === "all" ? [...ZUDO_REACT_DEV_ENTRIES] : [],
        exclude: mode === "exclude" ? [ZUDO_REACT_PACKAGE] : [],
        rolldownOptions: { transform: zudoReactOxc() },
        force: true,
      },
    });
    try {
      // Optimized resolution waits for the scan, which resolves raw package files through the plugin container first.
      const imports: string[] = [];
      for (const file of ["sync-value.ts", "main.tsx"]) {
        const result = await server.transformRequest(`/@fs${join(tool, file)}`);
        for (const match of result!.code.matchAll(/from\s+"([^"]+)"/g)) {
          if (/zudo-react|takazudo_zfb/.test(match[1]!)) imports.push(match[1]!.replace(/\?v=\w+$/, ""));
        }
      }
      // The first optimizer run commits only once the crawl is idle; closing earlier never settles.
      await server.environments.client.waitForRequestsIdle();
      return [...new Set(imports)];
    } finally {
      await server.close();
    }
  }

  it("serves core, client and the injected jsx-dev-runtime from one optimized runtime", async () => {
    const imports = await servedGraph("all");
    expect(imports.some((url) => url.endsWith("/deps/@takazudo_zfb_zudo-react_jsx-dev-runtime.js"))).toBe(true);
    expect(imports.some((url) => url.endsWith("/deps/@takazudo_zfb_zudo-react.js"))).toBe(true);
    expect(imports.every((url) => url.includes("/deps/@takazudo_zfb_zudo-react"))).toBe(true);
  }, 60_000);

  it("serves every subpath from the package files when the package is excluded", async () => {
    const imports = await servedGraph("exclude");
    expect(imports.length).toBeGreaterThanOrEqual(3);
    expect(imports.every((url) => url.includes("/zfb/dist/zudo-react/"))).toBe(true);
  }, 60_000);
});
