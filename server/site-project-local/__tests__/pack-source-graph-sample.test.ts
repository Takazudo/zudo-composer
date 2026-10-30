import { resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { loadHostContext } from "../../host-context.mjs";
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
  }, 60_000);
});
