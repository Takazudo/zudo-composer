// Reading `zudo-composer.config.ts` off a host project root.
//
// The module evaluator is injected. `zudo-composer.config.ts` is TypeScript, so
// only Node 24+ (or a `--experimental-strip-types` Node 22) can `import()` it
// directly; the dev CLI hands in Vite's `ssrLoadModule` instead, and tests hand
// in a stub. Everything below the evaluator is deterministic.

import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { resolveWorkspaceRoot } from "../../plugins/roots.mjs";
import { CONFIG_FILE_NAME, composer, type ComposerConfigInput, type ComposerRuntime, type ResolvedComposerConfig } from "./config";

/** Evaluates a config module and returns its exports. */
export type ComposerConfigLoader = (configPath: string) => Promise<Record<string, unknown>>;

export interface LoadComposerConfigOptions extends ComposerRuntime {
  /** Absolute host project root. Defaults to `process.cwd()`. */
  workspaceRoot?: string;
  load?: ComposerConfigLoader;
}

const importConfigModule: ComposerConfigLoader = async (configPath) =>
  (await import(pathToFileURL(configPath).href)) as Record<string, unknown>;

export interface ComposerConfigModule {
  /** Absolute path the config was looked for at, whether or not it exists. */
  configPath: string;
  exists: boolean;
  /** `{}` when the file is absent, so resolution falls back to the defaults. */
  userConfig: ComposerConfigInput;
}

/**
 * Read the host config module. An absent file is not an error — it yields an
 * empty config, and resolution then applies every default. Anything else about
 * the file that is wrong (no default export, a non-object export) fails here
 * rather than at first use.
 */
export async function readComposerConfigModule(
  workspaceRoot: string,
  load: ComposerConfigLoader = importConfigModule,
): Promise<ComposerConfigModule> {
  const configPath = resolve(workspaceRoot, CONFIG_FILE_NAME);
  if (!existsSync(configPath)) return { configPath, exists: false, userConfig: {} };

  const module = await load(configPath);
  const exported = module.default;
  if (exported === undefined) {
    throw new Error(`zudo-composer config: ${configPath} must have a default export — \`export default defineComposerConfig({ … })\`.`);
  }
  if (typeof exported !== "object" || exported === null || Array.isArray(exported)) {
    throw new Error(`zudo-composer config: the default export of ${configPath} must be a config object, received ${Array.isArray(exported) ? "an array" : typeof exported}.`);
  }
  return { configPath, exists: true, userConfig: exported as ComposerConfigInput };
}

/**
 * Resolve the host config for a workspace. Every resolution error — a missing
 * `pack`, an escaping path, a malformed specifier — is thrown here, at load,
 * with the offending config path named.
 */
export async function loadComposerConfig(options: LoadComposerConfigOptions = {}): Promise<ResolvedComposerConfig> {
  const workspaceRoot = resolveWorkspaceRoot(options.workspaceRoot);
  const { configPath, userConfig } = await readComposerConfigModule(workspaceRoot, options.load);
  return composer({ ...userConfig, workspaceRoot, configPath }, { env: options.env });
}
