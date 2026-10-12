// @ts-check
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { contentEditorPlugins } from "zudo-composer/vite";

export default defineConfig({
  root: dirname(fileURLToPath(import.meta.url)),
  base: "/",
  publicDir: false,
  // `/assets` is an authoring route the service refuses; emitted files live elsewhere.
  build: { outDir: "dist", assetsDir: "static", emptyOutDir: true },
  plugins: contentEditorPlugins(),
});
