import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import domainFileProviderPlugin, { DOMAIN_PROVIDERS_MODULE_ID } from "../domain-file-provider-plugin.mjs";
import contentDomainProvider, {
  CONTENT_DIR_DEFAULT,
  CONTENT_DIR_ENV,
  CONTENT_PROVIDER_OPERATIONS,
  resolveContentRoot,
} from "../content-domain-provider.mjs";
import { DEFAULT_SETTINGS } from "../../server/config";
import { domainFileProviderEndpoint } from "../../src/shared/file-provider";
import { CONTENT_FILE_PROVIDER_OPERATIONS } from "../../src/content/storage/file-provider";

const WORKSPACE = resolve("/tmp/host-project");

function harness(descriptors = [contentDomainProvider()]) {
  const plugin = domainFileProviderPlugin({ descriptors, workspaceRoot: WORKSPACE });
  return {
    plugin,
    load: (command: "serve" | "build") => {
      (plugin.configResolved as (config: { command: string }) => void)({ command });
      return (plugin.load as (id: string) => string | undefined)(`\0${DOMAIN_PROVIDERS_MODULE_ID}`);
    },
  };
}

describe("Content domain provider descriptor", () => {
  it("keeps the plugin's fallback directory equal to the configuration default", () => {
    expect(CONTENT_DIR_DEFAULT).toBe(DEFAULT_SETTINGS.contentDir);
  });

  it("resolves the records root from an explicit option, the environment, then the default", () => {
    expect(resolveContentRoot(WORKSPACE, undefined, {})).toBe(resolve(WORKSPACE, CONTENT_DIR_DEFAULT));
    expect(resolveContentRoot(WORKSPACE, undefined, { [CONTENT_DIR_ENV]: "data/content" })).toBe(resolve(WORKSPACE, "data/content"));
    expect(resolveContentRoot(WORKSPACE, undefined, { [CONTENT_DIR_ENV]: "  " })).toBe(resolve(WORKSPACE, CONTENT_DIR_DEFAULT));
    expect(resolveContentRoot(WORKSPACE, resolve("/elsewhere/content"), {})).toBe(resolve("/elsewhere/content"));
    expect(() => resolveContentRoot(WORKSPACE, "relative/content", {})).toThrow(/absolute resolved path/);
    expect(contentDomainProvider().resolveRoot(WORKSPACE)).toBe(resolve(WORKSPACE, CONTENT_DIR_DEFAULT));
  });

  it("serves exactly the operations the browser store declares", () => {
    expect(Object.keys(CONTENT_PROVIDER_OPERATIONS).sort()).toEqual([...CONTENT_FILE_PROVIDER_OPERATIONS].sort());
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
    expect(Object.keys(config.domains)).toEqual(["content"]);
    expect(config.domains.content!.endpoint).toBe(domainFileProviderEndpoint("content"));
    expect(config.domains.content!.capability).toMatch(/^[A-Za-z0-9_-]{20,}$/);

    // Every dev-server closure mints its own capability.
    expect(harness().load("serve")).not.toBe(source);
  });

  it("resolves only its own virtual module", () => {
    const { plugin } = harness();
    const resolveId = plugin.resolveId as (id: string) => string | undefined;
    expect(resolveId(DOMAIN_PROVIDERS_MODULE_ID)).toBe(`\0${DOMAIN_PROVIDERS_MODULE_ID}`);
    expect(resolveId("virtual:composer-file-provider-config")).toBeUndefined();
    expect((plugin.load as (id: string) => string | undefined)("virtual:other")).toBeUndefined();
  });

  it("refuses two descriptors claiming the same domain", () => {
    expect(() => harness([contentDomainProvider(), contentDomainProvider()])).toThrow(/Duplicate file-provider domain: content/);
  });
});
