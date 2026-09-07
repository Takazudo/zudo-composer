import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import domainFileProviderPlugin, { DOMAIN_PROVIDERS_MODULE_ID } from "../domain-file-provider-plugin.mjs";
import sitemapperDomainProvider, {
  SITEMAPPER_DIR_DEFAULT,
  SITEMAPPER_DIR_ENV,
  SITEMAPPER_PROVIDER_OPERATIONS,
  resolveSitemapperRoot,
} from "../sitemapper-domain-provider.mjs";
import { DEFAULT_SETTINGS } from "../../server/config";
import { domainFileProviderEndpoint } from "../../src/shared/file-provider";
import { SITEMAP_FILE_PROVIDER_OPERATIONS } from "../../src/sitemapper/storage/file-provider";

const WORKSPACE = resolve("/tmp/host-project");

function harness(descriptors = [sitemapperDomainProvider()]) {
  const plugin = domainFileProviderPlugin({ descriptors, workspaceRoot: WORKSPACE });
  return {
    plugin,
    load: (command: "serve" | "build") => {
      (plugin.configResolved as (config: { command: string }) => void)({ command });
      return (plugin.load as (id: string) => string | undefined)(`\0${DOMAIN_PROVIDERS_MODULE_ID}`);
    },
  };
}

describe("Sitemapper domain provider descriptor", () => {
  it("keeps the plugin's fallback directory equal to the configuration default", () => {
    expect(SITEMAPPER_DIR_DEFAULT).toBe(DEFAULT_SETTINGS.sitemapsDir);
  });

  it("resolves the records root from an explicit option, the environment, then the default", () => {
    expect(resolveSitemapperRoot(WORKSPACE, undefined, {})).toBe(resolve(WORKSPACE, SITEMAPPER_DIR_DEFAULT));
    expect(resolveSitemapperRoot(WORKSPACE, undefined, { [SITEMAPPER_DIR_ENV]: "data/sitemaps" })).toBe(resolve(WORKSPACE, "data/sitemaps"));
    expect(resolveSitemapperRoot(WORKSPACE, undefined, { [SITEMAPPER_DIR_ENV]: "  " })).toBe(resolve(WORKSPACE, SITEMAPPER_DIR_DEFAULT));
    expect(resolveSitemapperRoot(WORKSPACE, resolve("/elsewhere/sitemaps"), {})).toBe(resolve("/elsewhere/sitemaps"));
    expect(() => resolveSitemapperRoot(WORKSPACE, "relative/sitemaps", {})).toThrow(/absolute resolved path/);
    expect(sitemapperDomainProvider().resolveRoot(WORKSPACE)).toBe(resolve(WORKSPACE, SITEMAPPER_DIR_DEFAULT));
  });

  it("serves exactly the operations the browser store declares", () => {
    expect(Object.keys(SITEMAPPER_PROVIDER_OPERATIONS).sort()).toEqual([...SITEMAP_FILE_PROVIDER_OPERATIONS].sort());
  });

  it("opts into whole-batch transactions", () => {
    const descriptor = sitemapperDomainProvider();
    const bound = descriptor.bind({ isSitemapPersistenceError: () => false, createFilesystemSitemapStore: async () => ({}) }, WORKSPACE);
    expect(typeof bound.applyTransaction).toBe("function");
  });
});

describe("Domain file provider plugin", () => {
  it("emits one endpoint and capability per domain only while serving", () => {
    const { load } = harness();
    expect(load("build")).toBe("export const domainProviderConfig = undefined;\n");

    const source = load("serve")!;
    const config = JSON.parse(source.slice(source.indexOf("{"), source.lastIndexOf("}") + 1)) as {
      domains: Record<string, { endpoint: string; capability: string; maxBodyBytes: number }>;
    };
    expect(Object.keys(config.domains)).toEqual(["sitemapper"]);
    expect(config.domains.sitemapper!.endpoint).toBe(domainFileProviderEndpoint("sitemapper"));
    expect(config.domains.sitemapper!.capability).toMatch(/^[A-Za-z0-9_-]{20,}$/);
  });

  it("refuses two descriptors claiming the same domain", () => {
    expect(() => harness([sitemapperDomainProvider(), sitemapperDomainProvider()])).toThrow(/Duplicate file-provider domain: sitemapper/);
  });
});
