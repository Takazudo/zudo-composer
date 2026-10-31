import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { loadHostContext } from "../../host-context.mjs";
import { enforceComputedLoadBoundary } from "../load-boundary";
import { collectPackSourceGraph } from "../pack-source-graph";

describe("collectPackSourceGraph on the Sample host", () => {
  it("attests the computed WASM loader's whole package and its declared dependency closure for editing", async () => {
    const root = resolve("packages/demo-sample");
    const host = await loadHostContext({ workspaceRoot: root });
    const graph = await collectPackSourceGraph({
      hostRoot: root,
      entryPath: host.packIdentity.entryPath,
      sourceModules: host.pack.manifest.components.map(component => component.source.module),
      extraRoots: [host.composerConfig.configPath],
      attestExternalFiles: true,
    });
    const attested = (graph.attestedFiles ?? []).map(path => path.split(sep).join("/"));
    expect(attested.some(path => path.endsWith("/zfb-md-wasm/dist/wasm/zfb_md_wasm_bg.wasm"))).toBe(true);
    // Declared by @takazudo/zfb-md-wasm and reachable by its computed loads.
    expect(attested.some(path => /\/mdast-util-mdx\/.*\.js$/.test(path))).toBe(true);
    expect(graph.dependencies.map(({ name }) => name)).toEqual(expect.arrayContaining(["@takazudo/zfb-md-wasm", "mdast-util-mdx", "mdast-util-directive", "micromark"]));

    // Under the load boundary the real computed glue load still works, and the same loader cannot reach an unattested file.
    enforceComputedLoadBoundary(graph);
    const wasmDir = graph.confinedPackages?.find(path => path.split(sep).join("/").endsWith("/@takazudo/zfb-md-wasm"));
    expect(wasmDir).toBeDefined();
    const wasm = await import(pathToFileURL(join(wasmDir!, "dist/index.js")).href) as { init(): Promise<void>; renderHtml(source: string): Promise<unknown> };
    await wasm.init();
    expect(JSON.stringify(await wasm.renderHtml("# Attested"))).toContain("Attested");
    const { createWasmApi } = await import(pathToFileURL(join(wasmDir!, "dist/runtime.js")).href) as { createWasmApi(options: { glueUrl: URL; loadWasmBytes(): Promise<ArrayBuffer>; compileWasm(bytes: ArrayBuffer): Promise<unknown> }): { init(): Promise<void> } };
    const stray = createWasmApi({ glueUrl: pathToFileURL(resolve("package.json")), loadWasmBytes: async () => new ArrayBuffer(0), compileWasm: async () => ({}) });
    await expect(stray.init()).rejects.toThrow(/did not attest/);
  }, 60_000);
});
