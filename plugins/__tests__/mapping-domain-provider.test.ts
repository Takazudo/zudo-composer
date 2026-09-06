import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import domainFileProviderPlugin, { DOMAIN_PROVIDERS_MODULE_ID } from "../domain-file-provider-plugin.mjs";
import mappingDomainProvider, {
  MAPPING_DIR_DEFAULT,
  MAPPING_DIR_ENV,
  MAPPING_PROVIDER_OPERATIONS,
  resolveMappingRoot,
} from "../mapping-domain-provider.mjs";
import { DEFAULT_SETTINGS } from "../../server/config";
import { domainFileProviderEndpoint } from "../../src/shared/file-provider";
import { MAPPING_FILE_PROVIDER_OPERATIONS } from "../../src/mapping/storage/file-provider";

const WORKSPACE = resolve("/tmp/host-project");

function harness(descriptors = [mappingDomainProvider()]) {
  const plugin = domainFileProviderPlugin({ descriptors, workspaceRoot: WORKSPACE });
  return {
    plugin,
    load: (command: "serve" | "build") => {
      (plugin.configResolved as (config: { command: string }) => void)({ command });
      return (plugin.load as (id: string) => string | undefined)(`\0${DOMAIN_PROVIDERS_MODULE_ID}`);
    },
  };
}

describe("Mapping domain provider descriptor", () => {
  it("keeps the plugin's fallback directory equal to the configuration default", () => {
    expect(MAPPING_DIR_DEFAULT).toBe(DEFAULT_SETTINGS.mappingsDir);
  });

  it("resolves the records root from an explicit option, the environment, then the default", () => {
    expect(resolveMappingRoot(WORKSPACE, undefined, {})).toBe(resolve(WORKSPACE, MAPPING_DIR_DEFAULT));
    expect(resolveMappingRoot(WORKSPACE, undefined, { [MAPPING_DIR_ENV]: "data/mappings" })).toBe(resolve(WORKSPACE, "data/mappings"));
    expect(resolveMappingRoot(WORKSPACE, undefined, { [MAPPING_DIR_ENV]: "  " })).toBe(resolve(WORKSPACE, MAPPING_DIR_DEFAULT));
    expect(resolveMappingRoot(WORKSPACE, resolve("/elsewhere/mappings"), {})).toBe(resolve("/elsewhere/mappings"));
    expect(() => resolveMappingRoot(WORKSPACE, "relative/mappings", {})).toThrow(/absolute resolved path/);
    expect(mappingDomainProvider().resolveRoot(WORKSPACE)).toBe(resolve(WORKSPACE, MAPPING_DIR_DEFAULT));
  });

  it("serves exactly the operations the browser store declares", () => {
    expect(Object.keys(MAPPING_PROVIDER_OPERATIONS).sort()).toEqual([...MAPPING_FILE_PROVIDER_OPERATIONS].sort());
  });

  it("opts into whole-batch transactions", () => {
    const descriptor = mappingDomainProvider();
    const bound = descriptor.bind({ isMappingPersistenceError: () => false, createFilesystemMappingStore: async () => ({}) }, WORKSPACE);
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
    expect(Object.keys(config.domains)).toEqual(["mapping"]);
    expect(config.domains.mapping!.endpoint).toBe(domainFileProviderEndpoint("mapping"));
    expect(config.domains.mapping!.capability).toMatch(/^[A-Za-z0-9_-]{20,}$/);
  });

  it("refuses two descriptors claiming the same domain", () => {
    expect(() => harness([mappingDomainProvider(), mappingDomainProvider()])).toThrow(/Duplicate file-provider domain: mapping/);
  });
});
