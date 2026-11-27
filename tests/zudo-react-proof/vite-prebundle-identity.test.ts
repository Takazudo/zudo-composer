// @vitest-environment node
import { afterAll, beforeAll, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { createServer } from "vite";

// Dev-graph identity: a pack is linked source (excluded from optimizeDeps) and the
// tool's own imports may be prebundled. Every zudo-react subpath must come from
// one physical module graph or the scheduler/scope state is duplicated.
const repo = resolve(import.meta.dirname, "../..");
const SUBPATHS = ["@takazudo/zfb/zudo-react", "@takazudo/zfb/zudo-react/jsx-runtime", "@takazudo/zfb/zudo-react/jsx-dev-runtime", "@takazudo/zfb/zudo-react/client"];
let root = "";

beforeAll(() => {
  const cache = join(repo, "node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  root = mkdtempSync(join(cache, "zr-vite-"));
  const zfb = dirname(createRequire(join(repo, "package.json")).resolve("@takazudo/zfb/package.json"));
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
    oxc: { jsx: { runtime: "automatic", importSource: "@takazudo/zfb/zudo-react" } },
    resolve: { dedupe: ["@takazudo/zfb"] },
    optimizeDeps: {
      include: mode === "all" ? SUBPATHS : mode === "partial" ? ["@takazudo/zfb/zudo-react/client"] : [],
      exclude: mode === "exclude" ? ["@takazudo/zfb"] : [],
      noDiscovery: true, force: true,
    },
  });
  try {
    const imports: string[] = [];
    for (const id of ["/src/tool.tsx", "/pack/card.tsx"]) {
      const result = await server.transformRequest(id);
      for (const match of result!.code.matchAll(/from\s+"([^"]+)"/g)) {
        if (/zudo-react|takazudo_zfb/.test(match[1]!)) imports.push(match[1]!.replace(/\?v=\w+$/, ""));
      }
    }
    const optimizedClient = imports.find((url) => url.includes("deps/@takazudo_zfb_zudo-react_client.js"));
    const clientCode = optimizedClient ? readFileSync(join(root, optimizedClient.replace(/^\//, "")), "utf8") : "";
    return { imports: [...new Set(imports)], clientInlinesScheduler: /ZR_FLUSH_LIMIT/.test(clientCode) };
  } finally {
    await server.close();
  }
}

it("prebundling every used subpath together gives tool and pack one runtime", async () => {
  const graph = await servedGraph("all");
  expect(graph.imports.length).toBeGreaterThanOrEqual(3);
  expect(graph.imports.every((url) => url.includes("/deps/@takazudo_zfb_zudo-react"))).toBe(true);
  expect(graph.clientInlinesScheduler).toBe(false);
}, 60_000);

it("excluding the package serves every subpath from the same node_modules files", async () => {
  const graph = await servedGraph("exclude");
  expect(graph.imports.length).toBeGreaterThanOrEqual(3);
  expect(graph.imports.every((url) => url.includes("/node_modules/@takazudo/zfb/dist/zudo-react/") || url.includes("/zfb/dist/zudo-react/"))).toBe(true);
}, 60_000);

it("prebundling only some subpaths inlines a private scheduler copy (the hazard)", async () => {
  const graph = await servedGraph("partial");
  expect(graph.imports.length).toBeGreaterThanOrEqual(3);
  expect(graph.imports.some((url) => url.includes("/deps/"))).toBe(true);
  expect(graph.imports.some((url) => url.includes("/dist/zudo-react/index.js"))).toBe(true);
  expect(graph.clientInlinesScheduler).toBe(true);
}, 60_000);
