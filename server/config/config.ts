// Resolution of a host's `zudo-composer.config.ts` into a complete, validated
// configuration.
//
// Two invariants carry the whole contract:
//
//   1. The merge is a shallow top-level merge, and every object type in the
//      contract is all-required-fields. A shallow merge over *optional* nested
//      fields silently drops host settings — an object supplied by the host
//      would replace the default wholesale and quietly lose whatever it did not
//      repeat. All-required nested types make that impossible to author.
//   2. Non-serializable and machine-specific values are peeled off the host's
//      object *before* the merge, so they can never reach `settings`, which is
//      the payload that gets serialized to the browser and the CLI.

import { isAbsolute, posix, resolve } from "node:path";
import { resolveWorkspaceRoot } from "../../plugins/roots.mjs";
import { defineComposerConfig } from "./define.mjs";
import {
  DATA_DOMAIN_SEGMENTS,
  DEFAULT_SETTINGS,
  SETTING_ENVIRONMENT_KEYS,
  SETTING_KEYS,
  type ComposerSettingDefaults,
  type ComposerSettings,
} from "./settings";

// The identity helper a host imports lives in `./define.mjs`: it is the whole
// `zudo-composer/config` runtime, and it must stay plain JavaScript so a host
// config can load it out of `node_modules`. Re-exported here so this module
// stays the single place the config contract is read from.
export { defineComposerConfig };

/** The config file a host writes, resolved against the host project root. */
export const CONFIG_FILE_NAME = "zudo-composer.config.ts";

// Mirrors `parseSource`'s public-import rule in
// `@zudo-composer/component-contract`. The contract stays the authority for
// component sources; this is the cheap shape check that lets the config fail at
// load rather than at first pack resolution.
const PACK_SPECIFIER_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)(?:\/[A-Za-z0-9._~-]+)*$/u;

/**
 * Values a caller may supply that are not settings. They are absolute machine
 * paths, so they are peeled off before the merge and never reach `settings`.
 */
export interface ComposerConfigOverrides {
  /** Absolute host project root. Defaults to `process.cwd()`. */
  workspaceRoot?: string;
  /** Absolute path of the config file, used in resolution error messages. */
  configPath?: string;
}

/**
 * What a host writes inside `defineComposerConfig({ … })`. Every path setting
 * is optional and falls back to its documented default; `pack` is required.
 */
export type ComposerConfig = Partial<Omit<ComposerSettings, "pack">> &
  Pick<ComposerSettings, "pack"> &
  ComposerConfigOverrides;

/**
 * What `composer()` accepts. Looser than `ComposerConfig` because it also has
 * to describe the absent-config-file case and the `ZUDO_COMPOSER_PACK`
 * override; `pack` is enforced at resolution instead, with a loud error.
 */
export type ComposerConfigInput = Partial<ComposerSettings> & ComposerConfigOverrides;

/** Absolute paths derived from the settings. Node-side only, never serialized. */
export interface ComposerPaths {
  workspaceRoot: string;
  data: string;
  compositions: string;
  content: string;
  mappings: string;
  sitemaps: string;
  media: string;
  publicMedia: string;
  styles: string;
}

export interface ResolvedComposerConfig {
  /** Absolute host project root. Every relative setting resolves against it. */
  workspaceRoot: string;
  /** Absolute path of the host config file, whether or not it exists. */
  configPath: string;
  /** The complete, host-root-relative settings table. Safe to serialize. */
  settings: ComposerSettings;
  /** The same table resolved to absolute paths. */
  paths: ComposerPaths;
}

/** Options that are a test seam rather than host configuration. */
export interface ComposerRuntime {
  /** Environment the per-setting overrides are read from. */
  env?: Record<string, string | undefined>;
}

function fail(message: string): never {
  throw new Error(`zudo-composer config: ${message}`);
}

/** A setting a host left out is `undefined`; it must not clobber the default. */
function definedSettings(input: Record<string, unknown>): Partial<ComposerSettings> {
  const supplied: Partial<ComposerSettings> = {};
  for (const key of SETTING_KEYS) {
    const value = input[key];
    if (value === undefined) continue;
    if (typeof value !== "string") fail(`\`${key}\` must be a string, received ${typeof value}.`);
    supplied[key] = value;
  }
  return supplied;
}

function environmentSettings(env: Record<string, string | undefined>): Partial<ComposerSettings> {
  const supplied: Partial<ComposerSettings> = {};
  for (const key of SETTING_KEYS) {
    const value = env[SETTING_ENVIRONMENT_KEYS[key]]?.trim();
    if (value) supplied[key] = value;
  }
  return supplied;
}

/**
 * A path setting must stay inside the host project: relative, POSIX-separated,
 * and unable to climb out. Anything else is a config error at load, not a
 * surprise when the first read happens.
 */
function assertHostRelativePath(key: keyof ComposerSettings, value: string, configPath: string): string {
  const context = `Set it in ${configPath} or via ${SETTING_ENVIRONMENT_KEYS[key]}.`;
  if (value.trim() === "") fail(`\`${key}\` must not be empty. ${context}`);
  if (value.includes("\\")) fail(`\`${key}\` must use "/" separators, received "${value}". ${context}`);
  if (isAbsolute(value) || value.startsWith("/")) {
    fail(`\`${key}\` must be relative to the host project root, received the absolute path "${value}". ${context}`);
  }
  const normalized = posix.normalize(value).replace(/\/+$/u, "");
  if (normalized === "" || normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    fail(`\`${key}\` must stay inside the host project root, received "${value}". ${context}`);
  }
  return normalized;
}

function assertPack(value: string | undefined, configPath: string): string {
  if (value === undefined || value.trim() === "") {
    fail(
      `\`pack\` is required and has no default. Declare it in ${configPath} as a component-pack module specifier — an installed themeset ("@acme/themeset/composer-pack") or a host self-reference ("my-site/components") — or set ${SETTING_ENVIRONMENT_KEYS.pack}. zudo-composer never falls back to a bundled provider pack.`,
    );
  }
  if (!PACK_SPECIFIER_PATTERN.test(value) || value.split("/").includes("src")) {
    fail(
      `\`pack\` must be a package module specifier, not a path — received "${value}". Use an installed themeset ("@acme/themeset/composer-pack") or a host self-reference declared in the host's own \`exports\` ("my-site/components"). Declared in ${configPath}.`,
    );
  }
  return value;
}

/**
 * Resolve a host config into a complete one.
 *
 * The host spreads nothing: the returned config already carries every setting.
 * It *may* still override by spreading, because the merge is a plain shallow
 * top-level merge over a complete default table.
 */
export function composer(user: ComposerConfigInput = {}, runtime: ComposerRuntime = {}): ResolvedComposerConfig {
  // (2) Peel the non-serializable, machine-specific overrides off first.
  const { workspaceRoot: configuredRoot, configPath: configuredConfigPath, ...settingCandidates } = user;
  const workspaceRoot = resolveWorkspaceRoot(configuredRoot);
  const configPath = configuredConfigPath ?? resolve(workspaceRoot, CONFIG_FILE_NAME);

  // (3) Precedence: explicit config, then environment override, then default.
  const explicit = definedSettings(settingCandidates as Record<string, unknown>);
  const environment = environmentSettings(runtime.env ?? process.env);
  const supplied: Partial<ComposerSettings> = { ...environment, ...explicit };

  // `dataDir` is the root of the CMS domains, so moving it has to move every
  // domain the host did not pin itself. Without this the shallow merge would
  // keep the literal `cms/*` defaults and silently ignore the new `dataDir`.
  const base: ComposerSettingDefaults = { ...DEFAULT_SETTINGS };
  if (supplied.dataDir !== undefined && supplied.dataDir !== DEFAULT_SETTINGS.dataDir) {
    const dataDir = assertHostRelativePath("dataDir", supplied.dataDir, configPath);
    for (const [key, segment] of Object.entries(DATA_DOMAIN_SEGMENTS)) {
      if (segment === undefined) continue;
      base[key as keyof ComposerSettingDefaults] = posix.join(dataDir, segment);
    }
  }

  // (1) The shallow top-level merge, over a complete table.
  const merged: ComposerSettingDefaults & { pack?: string } = { ...base, ...supplied };

  const settings: ComposerSettings = {
    dataDir: assertHostRelativePath("dataDir", merged.dataDir, configPath),
    compositionsDir: assertHostRelativePath("compositionsDir", merged.compositionsDir, configPath),
    contentDir: assertHostRelativePath("contentDir", merged.contentDir, configPath),
    mappingsDir: assertHostRelativePath("mappingsDir", merged.mappingsDir, configPath),
    sitemapsDir: assertHostRelativePath("sitemapsDir", merged.sitemapsDir, configPath),
    mediaDir: assertHostRelativePath("mediaDir", merged.mediaDir, configPath),
    publicMediaDir: assertHostRelativePath("publicMediaDir", merged.publicMediaDir, configPath),
    styles: assertHostRelativePath("styles", merged.styles, configPath),
    pack: assertPack(merged.pack, configPath),
  };

  return {
    workspaceRoot,
    configPath,
    settings,
    paths: {
      workspaceRoot,
      data: resolve(workspaceRoot, settings.dataDir),
      compositions: resolve(workspaceRoot, settings.compositionsDir),
      content: resolve(workspaceRoot, settings.contentDir),
      mappings: resolve(workspaceRoot, settings.mappingsDir),
      sitemaps: resolve(workspaceRoot, settings.sitemapsDir),
      media: resolve(workspaceRoot, settings.mediaDir),
      publicMedia: resolve(workspaceRoot, settings.publicMediaDir),
      styles: resolve(workspaceRoot, settings.styles),
    },
  };
}
