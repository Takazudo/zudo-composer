export type ComposerModuleEvaluator = (modulePath: string) => Promise<Record<string, unknown>>;

/** Root at the host for its config/pack, or at APP_ROOT for tool-owned source. */
export function createModuleEvaluator(root: string): ComposerModuleEvaluator;
