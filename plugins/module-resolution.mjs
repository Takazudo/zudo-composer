// @ts-check
import { resolveImageEditorAliases } from "./image-editor-aliases.mjs";

/** The one JSX runtime the tool, its packs and generated hosts compile against. */
export const ZUDO_REACT_JSX_IMPORT_SOURCE = "@takazudo/zfb/zudo-react";

/** The package that owns the zudo-react runtime; exactly one copy may load. */
export const ZUDO_REACT_PACKAGE = "@takazudo/zfb";

/**
 * Vite 8 `oxc` options compiling `.tsx` to the zudo-react automatic runtime.
 * @param {string} [importSource]
 */
export function zudoReactOxc(importSource = ZUDO_REACT_JSX_IMPORT_SOURCE) {
  return { jsx: { runtime: /** @type {const} */ ("automatic"), importSource } };
}

/**
 * Resolution shared by the host dev graph and server-side module evaluation.
 * `@takazudo/zfb` is a host peer: dedupe it so every zudo-react subpath resolves
 * from the Vite root, including when the importer lives in a separately
 * installed pack. A second runtime copy fails silently, so there must be one.
 * The image editor remains tool-owned source shipped inside this package.
 */
export function resolveComposerModules() {
  return {
    dedupe: [ZUDO_REACT_PACKAGE],
    alias: resolveImageEditorAliases(),
  };
}

/**
 * SSR/module-runner options: keep the runtime external so Node's ESM cache,
 * keyed by realpath, holds the only instance. Never `noExternal` it.
 */
export function zudoReactSsr() {
  return { external: [ZUDO_REACT_PACKAGE] };
}
