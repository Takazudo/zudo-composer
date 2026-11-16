export interface HostDocumentConfig {
  module: string;
  rendererId: string;
  rendererVersion: string;
  /** Explicit host-relative public document assets; never inferred from a parent directory. */
  publicDir?: string;
}

export function parseHostDocument(value: unknown): HostDocumentConfig | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error("hostDocument must be a plain object.");
  const input = value as Record<string, unknown>;
  for (const key of Object.keys(input)) if (!["module", "rendererId", "rendererVersion", "publicDir"].includes(key)) throw new Error(`hostDocument.${key} is not supported.`);
  for (const key of ["module", "rendererId", "rendererVersion"]) {
    if (typeof input[key] !== "string" || !input[key].trim() || input[key] !== input[key].trim()) throw new Error(`hostDocument.${key} must be a nonempty unpadded string.`);
  }
  if (!/^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)(?:\/[A-Za-z0-9._~-]+)*$/u.test(input.module as string)
    || (input.module as string).split("/").includes("src")) throw new Error("hostDocument.module must be a public package module specifier.");
  if (input.publicDir !== undefined && (typeof input.publicDir !== "string" || !input.publicDir || input.publicDir !== input.publicDir.trim() || input.publicDir.startsWith("/") || input.publicDir.includes("\\") || input.publicDir.split("/").some(part => !part || part === "." || part === ".."))) throw new Error("hostDocument.publicDir must be an explicit directory inside the host root.");
  return { module: input.module as string, rendererId: input.rendererId as string, rendererVersion: input.rendererVersion as string, ...(input.publicDir === undefined ? {} : { publicDir: input.publicDir as string }) };
}
