export interface ContentValidationConfig { module: string; id: string; version: string }
export function parseContentValidation(value: unknown): ContentValidationConfig | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error("contentValidation must be a plain object.");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !["module", "id", "version"].includes(key))) throw new Error("Unsupported contentValidation setting.");
  for (const key of ["module", "id", "version"]) if (typeof input[key] !== "string" || !input[key].trim() || input[key] !== input[key].trim()) throw new Error(`contentValidation.${key} must be a nonempty unpadded string.`);
  if (!/^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)(?:\/[A-Za-z0-9._~-]+)*$/u.test(input.module as string) || (input.module as string).split("/").includes("src")) throw new Error("contentValidation.module must be a public package module specifier.");
  return { module: input.module as string, id: input.id as string, version: input.version as string };
}
