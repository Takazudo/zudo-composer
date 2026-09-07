// The pack seam, proven against two real packs neither of which is the
// provider: an installed themeset package and a host self-reference.
//
// These are the two shapes `parseSource` admits, and the point of the fixtures
// is that swapping between them is a config edit — no tool source, no contract
// version, no build wiring.

import { lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { componentPackManifestSchema } from "@zudo-composer/component-contract";
import { assertPackSourcesResolvable, resolveComponentPack } from "../component-pack.mjs";
import { COMPONENT_PACK_ID, RESOLVED_COMPONENT_PACK_ID, componentPackPlugin } from "../component-pack-plugin.mjs";
import { componentPack as themeset } from "@zudo-composer/fixture-themeset/composer-pack";
import { componentPack as selfPack } from "../../fixtures/self-host/components/pack";
import { generateJsx } from "../../src/composer/source/generate-jsx";
import { createComponentCatalog } from "../../src/composer/model/types";
import { doc, node } from "../../src/composer/__tests__/fixtures";

const repoRoot = resolve(".");
const themesetHost = resolve("fixtures/themeset-host");
const selfHost = resolve("fixtures/self-host");

describe("component pack resolution", () => {
  it("resolves an installed themeset out of the host's node_modules", () => {
    const identity = resolveComponentPack(themesetHost, "@zudo-composer/fixture-themeset/composer-pack");
    expect(identity.packageName).toBe("@zudo-composer/fixture-themeset");
    expect(identity.entryPath.endsWith("/composer-pack.ts")).toBe(true);
    // It is a real INSTALLED package — the host links it under node_modules —
    // not a relative path, because the contract admits only public bare-package
    // imports. `packageRoot` is the resolved (link-followed) location, which is
    // what the release digest has to attest.
    expect(lstatSync(resolve(themesetHost, "node_modules/@zudo-composer/fixture-themeset")).isSymbolicLink()).toBe(true);
    expect(JSON.parse(readFileSync(resolve(identity.packageRoot, "package.json"), "utf8")).name).toBe("@zudo-composer/fixture-themeset");
  });

  it("resolves a host self-reference through the host's own name and exports", () => {
    const identity = resolveComponentPack(selfHost, "self-host/components");
    expect(identity.packageName).toBe("self-host");
    // A self-reference resolves to the HOST package itself, which is what makes
    // host-owned `components/` reachable as a public bare import.
    expect(identity.packageRoot).toBe(selfHost);
    expect(identity.entryPath).toBe(resolve(selfHost, "components/pack.ts"));
  });

  it("fails loudly, naming the specifier and the package.json it looked from", () => {
    expect(() => resolveComponentPack(repoRoot, "@acme/not-installed/composer-pack")).toThrow(
      new RegExp(
        `^Component pack "@acme/not-installed/composer-pack" could not be resolved from ${resolve(repoRoot, "package.json")}: [\\s\\S]*Install it as a dependency of the host, or expose it through the host package's own "name" \\+ "exports"\\.$`,
      ),
    );
  });

  it("accepts both fixtures' source modules and refuses one that does not resolve", () => {
    expect(() => assertPackSourcesResolvable(themesetHost, themeset.manifest, "@zudo-composer/fixture-themeset/composer-pack")).not.toThrow();
    expect(() => assertPackSourcesResolvable(selfHost, selfPack.manifest, "self-host/components")).not.toThrow();

    const broken = { ...themeset.manifest, components: [{ ...themeset.manifest.components[0]!, id: "themeset.panel", source: { ...themeset.manifest.components[0]!.source, module: "not-installed" } }] };
    expect(() => assertPackSourcesResolvable(themesetHost, broken, "@zudo-composer/fixture-themeset/composer-pack")).toThrow(
      `Component "themeset.panel" in pack "@zudo-composer/fixture-themeset/composer-pack" declares source.module "not-installed", which does not resolve from ${themesetHost}. A pack's source.module must be a public export of an installed package or of the host package's own "exports"; every generated composition module imports it.`,
    );
  });
});

describe("virtual:zudo-composer-pack", () => {
  it("re-exports the resolved entry through /@fs so a pack outside the host root loads", () => {
    const plugin = componentPackPlugin({ workspaceRoot: themesetHost, pack: "@zudo-composer/fixture-themeset/composer-pack" });
    expect((plugin.resolveId as (id: string) => string)(COMPONENT_PACK_ID)).toBe(RESOLVED_COMPONENT_PACK_ID);
    const code = (plugin.load as (id: string) => string)(RESOLVED_COMPONENT_PACK_ID);
    expect(code).toBe(`export { componentPack } from ${JSON.stringify(`/@fs${plugin.identity.entryPath}`)};`);
  });

  it("derives the optimizer exclusion and the fs allowance from the resolved pack", () => {
    const plugin = componentPackPlugin({ workspaceRoot: themesetHost, pack: "@zudo-composer/fixture-themeset/composer-pack" });
    const config = (plugin.config as () => { server: { fs: { allow: string[] } }; optimizeDeps: { exclude: string[] } })();
    expect(config.optimizeDeps.exclude).toEqual(["@zudo-composer/fixture-themeset"]);
    expect(config.server.fs.allow).toEqual([plugin.identity.packageRoot]);
  });
});

describe("generated source for a themeset", () => {
  it("imports from the themeset package, and the contract admits that module", () => {
    const catalog = createComponentCatalog(themeset.manifest);
    const document = doc([node("themeset.panel", { title: "Hello", tone: "loud" }, { content: [node("themeset.note", { body: "Body" })] })]);
    const result = generateJsx(document, catalog);
    expect(result.ok).toBe(true);
    expect(result.code).toContain('from "@zudo-composer/fixture-themeset"');
    expect(result.code).not.toContain("@zudo-sg/ui");
    expect(result.imports.every(({ module }) => module === "@zudo-composer/fixture-themeset")).toBe(true);
    // The same manifest survives a round trip through the contract's own
    // validator, so `source.module` really is a public bare-package import.
    expect(componentPackManifestSchema.safeParse(themeset.manifest).success).toBe(true);
  });
});
