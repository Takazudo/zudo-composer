import type { ComponentPackManifest } from "@zudo-composer/component-contract";
export type HostComponentPresentation = Record<string, { labelProp?: string; transparent?: boolean }>;
export interface HostDocumentConfig {
  componentPresentation?: HostComponentPresentation;
  module: string;
  rendererId: string;
  rendererVersion: string;
  /** Trusted host JSX runtime package; defaults to Preact. Evaluated in an isolated server graph. */
  jsxImportSource?: string;
  /** Explicit host-relative public document assets; never inferred from a parent directory. */
  publicDir?: string;
}

export function parseHostDocument(value: unknown): HostDocumentConfig | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error("hostDocument must be a plain object.");
  const input = value as Record<string, unknown>;
  for (const key of Object.keys(input)) if (!["module", "rendererId", "rendererVersion", "publicDir", "jsxImportSource", "componentPresentation"].includes(key)) throw new Error(`hostDocument.${key} is not supported.`);
  for (const key of ["module", "rendererId", "rendererVersion"]) {
    if (typeof input[key] !== "string" || !input[key].trim() || input[key] !== input[key].trim()) throw new Error(`hostDocument.${key} must be a nonempty unpadded string.`);
  }
  if (!/^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)(?:\/[A-Za-z0-9._~-]+)*$/u.test(input.module as string)
    || (input.module as string).split("/").includes("src")) throw new Error("hostDocument.module must be a public package module specifier.");
  if (input.jsxImportSource !== undefined && (typeof input.jsxImportSource !== "string" || !/^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)(?:\/[A-Za-z0-9._~-]+)*$/u.test(input.jsxImportSource))) throw new Error("hostDocument.jsxImportSource must be a package module specifier.");
  if (input.publicDir !== undefined && (typeof input.publicDir !== "string" || !input.publicDir || input.publicDir !== input.publicDir.trim() || input.publicDir.startsWith("/") || input.publicDir.includes("\\") || input.publicDir.split("/").some(part => !part || part === "." || part === ".."))) throw new Error("hostDocument.publicDir must be an explicit directory inside the host root.");
  let componentPresentation: HostComponentPresentation | undefined;
  if (input.componentPresentation !== undefined) {
    const entries = input.componentPresentation;
    if (!entries || typeof entries !== "object" || Array.isArray(entries) || ![Object.prototype, null].includes(Object.getPrototypeOf(entries))) throw new Error("hostDocument.componentPresentation must be a plain record.");
    componentPresentation = Object.fromEntries(Object.entries(entries).map(([id, raw]) => {
      if (!id || !raw || typeof raw !== "object" || Array.isArray(raw) || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) throw new Error("Invalid component presentation entry.");
      const value = raw as Record<string, unknown>;
      if (Object.keys(value).some(key => !["labelProp", "transparent"].includes(key)) || (value.labelProp !== undefined && (typeof value.labelProp !== "string" || !value.labelProp.trim())) || (value.transparent !== undefined && typeof value.transparent !== "boolean")) throw new Error("Invalid component presentation properties.");
      return [id, { ...(value.labelProp === undefined ? {} : { labelProp: value.labelProp as string }), ...(value.transparent === undefined ? {} : { transparent: value.transparent as boolean }) }];
    }));
  }
  return { ...(componentPresentation === undefined ? {} : { componentPresentation }), module: input.module as string, rendererId: input.rendererId as string, rendererVersion: input.rendererVersion as string, ...(input.jsxImportSource === undefined ? {} : { jsxImportSource: input.jsxImportSource as string }), ...(input.publicDir === undefined ? {} : { publicDir: input.publicDir as string }) };
}

/** Config can choose display metadata only from the installed pack, never guess prop ownership. */
export function validateHostComponentPresentation(config: HostComponentPresentation | undefined, manifest: ComponentPackManifest): void {
  for (const [id, presentation] of Object.entries(config ?? {})) {
    const component = manifest.components.find(value => value.id === id);
    if (!component) throw new Error(`Unknown host authoring component: ${id}`);
    if (presentation.labelProp && !component.fields.some(field => field.prop === presentation.labelProp && field.schema.type === "string" && (field.editor.kind === "text" || field.editor.kind === "select"))) throw new Error(`Host authoring label ${id}.${presentation.labelProp} must name a declared textual field.`);
  }
}
