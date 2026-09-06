export const APP_ROOT: string;
export function appModuleId(relativePath: string): string;
export function validateRootOverride(root: string | undefined, label: string): string | undefined;
export function resolveWorkspaceRoot(configured: string | undefined): string;
export function readRootEnvironment(value: string | undefined, label: string): string | undefined;
