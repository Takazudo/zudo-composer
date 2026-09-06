import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  CONFIG_FILE_NAME,
  DEFAULT_SETTINGS,
  SETTING_ENVIRONMENT_KEYS,
  SETTING_KEYS,
  composer,
  defineComposerConfig,
  loadComposerConfig,
  readComposerConfigModule,
} from "../index";

const HOST_ROOT = resolve("/tmp/zudo-composer-host");
const PACK = "my-site/components";

/** Resolution reads the real environment by default; every test injects one. */
function resolveConfig(user: Parameters<typeof composer>[0] = {}, env: Record<string, string | undefined> = {}) {
  return composer({ workspaceRoot: HOST_ROOT, ...user }, { env });
}

async function withHostRoot(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(resolve(tmpdir(), "zudo-composer-config-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("composer()", () => {
  it("resolves the documented defaults from a pack alone", () => {
    const config = resolveConfig({ pack: PACK });

    expect(config.settings).toEqual({
      dataDir: "cms",
      compositionsDir: "cms/compositions",
      contentDir: "cms/content",
      mappingsDir: "cms/mappings",
      sitemapsDir: "cms/sitemaps",
      mediaDir: "cms/media",
      publicMediaDir: "public/uploaded-media",
      styles: "styles/base.css",
      pack: PACK,
    });
    expect(config.workspaceRoot).toBe(HOST_ROOT);
    expect(config.configPath).toBe(resolve(HOST_ROOT, CONFIG_FILE_NAME));
  });

  it("leaves every other default intact when one setting is overridden", () => {
    const config = resolveConfig({ pack: PACK, contentDir: "cms/copy" });

    expect(config.settings.contentDir).toBe("cms/copy");
    for (const key of SETTING_KEYS) {
      if (key === "pack" || key === "contentDir") continue;
      expect(config.settings[key]).toBe(DEFAULT_SETTINGS[key]);
    }
  });

  it("keeps the settings table complete for every partial host config", () => {
    for (const key of SETTING_KEYS) {
      if (key === "pack") continue;
      const config = resolveConfig({ pack: PACK, [key]: "custom/place" });
      expect(Object.keys(config.settings).sort()).toEqual([...SETTING_KEYS].sort());
    }
  });

  it("re-bases the CMS domains when dataDir moves, but not the public media dir", () => {
    const config = resolveConfig({ pack: PACK, dataDir: "store" });

    expect(config.settings).toMatchObject({
      dataDir: "store",
      compositionsDir: "store/compositions",
      contentDir: "store/content",
      mappingsDir: "store/mappings",
      sitemapsDir: "store/sitemaps",
      mediaDir: "store/media",
      publicMediaDir: "public/uploaded-media",
    });
  });

  it("lets an explicit domain directory win over a moved dataDir", () => {
    const config = resolveConfig({ pack: PACK, dataDir: "store", mediaDir: "assets/media" });

    expect(config.settings.mediaDir).toBe("assets/media");
    expect(config.settings.contentDir).toBe("store/content");
  });

  it("ignores keys the host left explicitly undefined", () => {
    const config = resolveConfig({ pack: PACK, contentDir: undefined });

    expect(config.settings.contentDir).toBe(DEFAULT_SETTINGS.contentDir);
  });
});

describe("precedence", () => {
  it("prefers an environment override to the default", () => {
    const config = resolveConfig({ pack: PACK }, { [SETTING_ENVIRONMENT_KEYS.contentDir]: "env/content" });

    expect(config.settings.contentDir).toBe("env/content");
  });

  it("prefers explicit config to an environment override", () => {
    const config = resolveConfig(
      { pack: PACK, contentDir: "explicit/content" },
      { [SETTING_ENVIRONMENT_KEYS.contentDir]: "env/content" },
    );

    expect(config.settings.contentDir).toBe("explicit/content");
  });

  it("re-bases the domains from an environment dataDir too", () => {
    const config = resolveConfig({ pack: PACK }, { [SETTING_ENVIRONMENT_KEYS.dataDir]: "env-store" });

    expect(config.settings.compositionsDir).toBe("env-store/compositions");
  });

  it("accepts the pack from the environment", () => {
    const config = resolveConfig({}, { [SETTING_ENVIRONMENT_KEYS.pack]: "@acme/themeset/composer-pack" });

    expect(config.settings.pack).toBe("@acme/themeset/composer-pack");
  });

  it("treats a blank environment value as absent", () => {
    const config = resolveConfig({ pack: PACK }, { [SETTING_ENVIRONMENT_KEYS.contentDir]: "   " });

    expect(config.settings.contentDir).toBe(DEFAULT_SETTINGS.contentDir);
  });
});

describe("absolute paths", () => {
  it("resolves every relative setting against the host root", () => {
    const config = resolveConfig({ pack: PACK, dataDir: "store", styles: "css/entry.css" });

    expect(config.paths).toEqual({
      workspaceRoot: HOST_ROOT,
      data: resolve(HOST_ROOT, "store"),
      compositions: resolve(HOST_ROOT, "store/compositions"),
      content: resolve(HOST_ROOT, "store/content"),
      mappings: resolve(HOST_ROOT, "store/mappings"),
      sitemaps: resolve(HOST_ROOT, "store/sitemaps"),
      media: resolve(HOST_ROOT, "store/media"),
      publicMedia: resolve(HOST_ROOT, "public/uploaded-media"),
      styles: resolve(HOST_ROOT, "css/entry.css"),
    });
  });

  it("defaults the host root to the current working directory", () => {
    const config = composer({ pack: PACK }, { env: {} });

    expect(config.workspaceRoot).toBe(resolve(process.cwd()));
  });

  it("keeps machine-specific overrides out of the serialized settings", () => {
    const config = resolveConfig({ pack: PACK, configPath: resolve(HOST_ROOT, "elsewhere.ts") });

    expect(JSON.parse(JSON.stringify(config.settings))).toEqual(config.settings);
    expect(Object.keys(config.settings)).not.toContain("workspaceRoot");
    expect(Object.keys(config.settings)).not.toContain("configPath");
    expect(JSON.stringify(config.settings)).not.toContain(HOST_ROOT);
  });
});

describe("loud resolution errors", () => {
  it("names the resolved absolute config path when pack is missing", () => {
    expect(() => resolveConfig({})).toThrow(resolve(HOST_ROOT, CONFIG_FILE_NAME));
    expect(() => resolveConfig({})).toThrow(/`pack` is required and has no default/u);
    expect(() => resolveConfig({})).toThrow(/never falls back to a bundled provider pack/u);
  });

  it("rejects a pack that is a path rather than a package specifier", () => {
    expect(() => resolveConfig({ pack: "./components/pack.ts" })).toThrow(/must be a package module specifier, not a path/u);
    expect(() => resolveConfig({ pack: "/abs/components" })).toThrow(/must be a package module specifier, not a path/u);
    expect(() => resolveConfig({ pack: "my-site/src/components" })).toThrow(/must be a package module specifier, not a path/u);
  });

  it("accepts both admitted pack shapes", () => {
    expect(resolveConfig({ pack: "@acme/themeset/composer-pack" }).settings.pack).toBe("@acme/themeset/composer-pack");
    expect(resolveConfig({ pack: "my-site/components" }).settings.pack).toBe("my-site/components");
  });

  it("rejects an absolute or escaping path setting", () => {
    expect(() => resolveConfig({ pack: PACK, contentDir: "/var/data" })).toThrow(/must be relative to the host project root/u);
    expect(() => resolveConfig({ pack: PACK, contentDir: "../outside" })).toThrow(/must stay inside the host project root/u);
    expect(() => resolveConfig({ pack: PACK, contentDir: "cms\\content" })).toThrow(/must use "\/" separators/u);
    expect(() => resolveConfig({ pack: PACK, contentDir: "" })).toThrow(/must not be empty/u);
  });

  it("names the environment variable alongside the config path", () => {
    expect(() => resolveConfig({ pack: PACK, contentDir: "/var/data" })).toThrow(SETTING_ENVIRONMENT_KEYS.contentDir);
  });

  it("rejects a non-string setting", () => {
    expect(() => resolveConfig({ pack: PACK, contentDir: 7 as unknown as string })).toThrow(/`contentDir` must be a string/u);
  });
});

describe("loadComposerConfig()", () => {
  it("falls back to the defaults when the host has no config file", async () => {
    await withHostRoot(async (root) => {
      const module = await readComposerConfigModule(root);
      expect(module.exists).toBe(false);
      expect(module.userConfig).toEqual({});
      expect(module.configPath).toBe(resolve(root, CONFIG_FILE_NAME));

      const config = await loadComposerConfig({
        workspaceRoot: root,
        env: { [SETTING_ENVIRONMENT_KEYS.pack]: PACK },
      });
      expect(config.settings).toMatchObject({ ...DEFAULT_SETTINGS, pack: PACK });
    });
  });

  it("throws the loud pack error naming the absent config file", async () => {
    await withHostRoot(async (root) => {
      await expect(loadComposerConfig({ workspaceRoot: root, env: {} })).rejects.toThrow(resolve(root, CONFIG_FILE_NAME));
    });
  });

  it("resolves a real host config file through an injected evaluator", async () => {
    await withHostRoot(async (root) => {
      await writeFile(
        resolve(root, CONFIG_FILE_NAME),
        `import { defineComposerConfig } from "zudo-composer/config";\nexport default defineComposerConfig({ pack: "${PACK}", dataDir: "store" });\n`,
        "utf8",
      );

      const config = await loadComposerConfig({
        workspaceRoot: root,
        env: {},
        load: async () => ({ default: defineComposerConfig({ pack: PACK, dataDir: "store" }) }),
      });

      expect(config.configPath).toBe(resolve(root, CONFIG_FILE_NAME));
      expect(config.settings.compositionsDir).toBe("store/compositions");
      expect(config.paths.compositions).toBe(resolve(root, "store/compositions"));
    });
  });

  it("rejects a config file without a usable default export", async () => {
    await withHostRoot(async (root) => {
      await writeFile(resolve(root, CONFIG_FILE_NAME), "export const config = {};\n", "utf8");

      await expect(loadComposerConfig({ workspaceRoot: root, load: async () => ({}) })).rejects.toThrow(/must have a default export/u);
      await expect(loadComposerConfig({ workspaceRoot: root, load: async () => ({ default: [] }) })).rejects.toThrow(/must be a config object, received an array/u);
    });
  });

  it("ignores a host config that tries to reset the workspace root", async () => {
    await withHostRoot(async (root) => {
      await writeFile(resolve(root, CONFIG_FILE_NAME), "export default {};\n", "utf8");

      const config = await loadComposerConfig({
        workspaceRoot: root,
        env: {},
        load: async () => ({ default: { pack: PACK, workspaceRoot: "/somewhere/else" } }),
      });

      expect(config.workspaceRoot).toBe(root);
    });
  });
});

describe("defineComposerConfig()", () => {
  it("is the identity, so evaluating a host config needs nothing else", () => {
    const authored = { pack: PACK, styles: "styles/base.css" };
    expect(defineComposerConfig(authored)).toBe(authored);
  });
});
