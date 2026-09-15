// @ts-check
import { resolveImageEditorAliases } from "./image-editor-aliases.mjs";

/**
 * Resolution shared by the host dev graph and server-side module evaluation.
 * Preact is a host peer: let its exports choose each public subpath from the
 * Vite root, including when the importer lives in a separately installed pack.
 * The image editor remains tool-owned source shipped inside this package.
 */
export function resolveComposerModules() {
  return {
    dedupe: ["preact"],
    alias: resolveImageEditorAliases(),
  };
}
