import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer, type ViteDevServer } from "vite";
import type { TrustedComponentPack } from "@zudo-composer/component-contract";
import type { VNode } from "preact";
import { APP_ROOT } from "../../plugins/roots.mjs";
import { COMPONENT_PACK_ID } from "../../plugins/component-pack-plugin.mjs";
import { resolveComposerDevConfig } from "../dev-server.mjs";
import { loadHostConfig, loadHostContext } from "../host-context.mjs";
import { createModuleEvaluator } from "../module-evaluator.mjs";

let directory: string;
let hostRoot: string;
let server: ViteDevServer | undefined;

beforeEach(async () => {
  directory = realpathSync(await mkdtemp(join(tmpdir(), "zudo-composer-host-context-")));
  hostRoot = join(directory, "host");
  await Promise.all([
    mkdir(join(hostRoot, "node_modules"), { recursive: true }),
    mkdir(join(hostRoot, "styles"), { recursive: true }),
  ]);
  await writeFile(join(hostRoot, "package.json"), JSON.stringify({ name: "host-context-fixture", type: "module" }));
  await writeFile(join(hostRoot, "styles/base.css"), "/* Host-owned stylesheet. */\n");
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  await rm(directory, { recursive: true, force: true });
});

async function createDevGraph() {
  const { inlineConfig } = await resolveComposerDevConfig({ workspaceRoot: hostRoot });
  // Use the real dev plugins and SSR graph. No listening port, watcher,
  // optimizer scan or app warmup is needed to evaluate this one pack.
  server = await createServer({
    ...inlineConfig,
    logLevel: "silent",
    optimizeDeps: { ...inlineConfig.optimizeDeps, noDiscovery: true, include: [] },
    server: { ...inlineConfig.server, middlewareMode: true, hmr: false, watch: null, warmup: { clientFiles: [] } },
  });
  return server;
}

interface IdentityProbe {
  (): VNode;
  moduleUrl: string;
  dependency: { marker: string; moduleUrl: string };
  preactOptions: unknown;
  useState: unknown;
  jsx: unknown;
  editDoc: { resize: { width: number; height: number } };
}

describe("host-owned module evaluation", () => {
  it("loads the same host dependency and Preact runtime in dev and non-dev pack lanes", async () => {
    const packRoot = join(hostRoot, "node_modules/evaluator-fixture-pack");
    const packEntry = join(packRoot, "pack.tsx");
    const dependencyRoot = join(hostRoot, "node_modules/host-owned-dependency");
    const hostPreactRoot = join(hostRoot, "node_modules/preact");
    const nestedPreactRoot = join(packRoot, "node_modules/preact");
    const installedPreactRoot = realpathSync(join(APP_ROOT, "node_modules/preact"));
    await Promise.all([
      mkdir(join(packRoot, "node_modules"), { recursive: true }),
      mkdir(dependencyRoot),
      mkdir(join(hostRoot, "node_modules/@zudo-composer")),
    ]);
    await Promise.all([
      cp(installedPreactRoot, hostPreactRoot, { recursive: true }),
      cp(installedPreactRoot, nestedPreactRoot, { recursive: true }),
      symlink(realpathSync(join(APP_ROOT, "node_modules/@zudo-composer/component-contract")), join(hostRoot, "node_modules/@zudo-composer/component-contract"), "dir"),
      writeFile(join(dependencyRoot, "package.json"), JSON.stringify({ name: "host-owned-dependency", type: "module", exports: "./index.js" })),
      writeFile(join(dependencyRoot, "index.js"), 'export const identity = { marker: "host dependency", moduleUrl: import.meta.url };\n'),
      writeFile(join(packRoot, "package.json"), JSON.stringify({ name: "evaluator-fixture-pack", type: "module", exports: { "./composer-pack": "./pack.tsx" } })),
      writeFile(join(hostRoot, "zudo-composer.config.ts"), 'export default { pack: "evaluator-fixture-pack/composer-pack" };\n'),
      writeFile(packEntry, `
        import { defineComponent, defineComponentPack } from "@zudo-composer/component-contract";
        import { options } from "preact";
        import { useState } from "preact/hooks";
        import { jsx } from "preact/jsx-runtime";
        import { createEditDoc } from "@zudo-composer/image-editor";
        import { identity } from "host-owned-dependency";

        export const IdentityProbe = Object.assign(function IdentityProbe() {
          return <span>{identity.marker}</span>;
        }, {
          moduleUrl: import.meta.url, dependency: identity,
          preactOptions: options, useState, jsx,
          editDoc: createEditDoc({ width: 32, height: 24 }),
        });
        export const componentPack = defineComponentPack({
          packId: "evaluator-fixture-pack", packVersion: "1.0.0",
          components: [defineComponent()(IdentityProbe, {
            id: "identity.probe", schemaVersion: 1, title: "Identity probe",
            category: "Content", description: "Host resolution proof.",
            source: { module: "evaluator-fixture-pack/composer-pack", exportKind: "named", exportName: "IdentityProbe" },
            defaults: {}, fields: [],
          })],
        });
      `),
    ]);

    // Three different physical copies make an accidental tool-root or
    // importer-relative Preact resolution observable, even at one version.
    const requireHost = createRequire(join(hostRoot, "package.json"));
    const preactPaths = [requireHost.resolve("preact"), createRequire(packEntry).resolve("preact"), createRequire(import.meta.url).resolve("preact")];
    expect(new Set(preactPaths).size).toBe(3);
    expect(() => requireHost.resolve("@zudo-composer/image-editor")).toThrow();

    const dev = await createDevGraph();
    const devModule = await dev.ssrLoadModule(COMPONENT_PACK_ID) as { componentPack: TrustedComponentPack };
    const context = await loadHostContext({ workspaceRoot: hostRoot });
    const devProbe = devModule.componentPack.runtime.components["identity.probe"].component as IdentityProbe;
    const nonDevProbe = context.pack.runtime.components["identity.probe"].component as IdentityProbe;
    expect(context.packIdentity.entryPath).toBe(packEntry);
    expect(devProbe.moduleUrl).toBe(pathToFileURL(packEntry).href);
    expect(nonDevProbe.moduleUrl).toBe(devProbe.moduleUrl);
    expect(nonDevProbe.dependency).toBe(devProbe.dependency);
    expect(nonDevProbe.dependency.moduleUrl).toBe(pathToFileURL(join(dependencyRoot, "index.js")).href);

    const preactPackage = JSON.parse(await readFile(join(hostPreactRoot, "package.json"), "utf8")) as {
      exports: Record<string, { import: string }>;
    };
    for (const [subpath, exportName, field] of [
      [".", "options", "preactOptions"],
      ["./hooks", "useState", "useState"],
      ["./jsx-runtime", "jsx", "jsx"],
    ] as const) {
      const expectedPath = resolve(hostPreactRoot, preactPackage.exports[subpath].import);
      const expectedModule = await import(/* @vite-ignore */ pathToFileURL(expectedPath).href);
      expect(nonDevProbe[field], subpath).toBe(devProbe[field]);
      expect(nonDevProbe[field], subpath).toBe(expectedModule[exportName]);
    }
    for (const probe of [devProbe, nonDevProbe]) {
      expect(probe().type).toBe("span");
      expect(probe().props.children).toBe("host dependency");
      expect(probe.editDoc.resize).toEqual({ width: 32, height: 24 });
    }
  });

  it("keeps tool-owned TypeScript imports available without exposing tool-only dependencies to the host", async () => {
    await writeFile(join(hostRoot, "zudo-composer.config.ts"), 'export default { pack: "host-context-fixture/components" };\n');
    // Config evaluation still crosses from tool-owned TypeScript into the
    // host's config. The tool's preview protocol also needs its own zod.
    const config = await loadHostConfig(hostRoot);
    expect(config.settings.pack).toBe("host-context-fixture/components");
    const { previewSessionSchema } = await createModuleEvaluator(APP_ROOT)(resolve(APP_ROOT, "src/features/composer/preview/protocol.ts")) as
      Pick<typeof import("../../src/features/composer/preview/protocol"), "previewSessionSchema">;
    expect(previewSessionSchema.safeParse({ mode: "preview", theme: "light", selectedId: null }).success).toBe(true);
    expect(() => createRequire(join(hostRoot, "package.json")).resolve("zod")).toThrow();
    const hostEntry = join(hostRoot, "requires-tool-dependency.ts");
    await writeFile(hostEntry, 'export { z } from "zod";\n');
    await expect(createModuleEvaluator(hostRoot)(hostEntry)).rejects.toThrow(/zod/);
  });

  it("refuses a missing host Preact peer instead of borrowing the tool's copy", async () => {
    await writeFile(join(hostRoot, "package.json"), JSON.stringify({
      name: "host-context-fixture", type: "module", exports: { "./components": "./pack.ts" },
    }));
    await writeFile(join(hostRoot, "zudo-composer.config.ts"), 'export default { pack: "host-context-fixture/components" };\n');
    await writeFile(join(hostRoot, "pack.ts"), 'import { options } from "preact";\nexport const componentPack = { manifest: {}, options };\n');
    await expect(loadHostContext({ workspaceRoot: hostRoot })).rejects.toThrow(/preact/);
    await expect(createDevGraph()).rejects.toThrow(/preact/);
  });
});
