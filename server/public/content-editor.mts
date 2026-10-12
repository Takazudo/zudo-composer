// Browser entry of the restricted content-only editor. Declaration-only facade:
// the runtime is the shipped source module `src/features/content-editor/index.ts`,
// which a host bundles with `contentEditorPlugins()` from `zudo-composer/vite`.
export * from "../../src/features/content-editor/index.js";
