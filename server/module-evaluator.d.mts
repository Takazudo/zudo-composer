export type ComposerModuleEvaluator = (modulePath: string) => Promise<Record<string, unknown>>;

export function createModuleEvaluator(root: string): ComposerModuleEvaluator;
