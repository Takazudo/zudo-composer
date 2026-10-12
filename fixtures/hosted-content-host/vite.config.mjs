// @ts-check
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { contentEditorPlugins } from "zudo-composer/vite";

export default defineConfig({
  root: dirname(fileURLToPath(import.meta.url)),
  base: "/",
  publicDir: false,
  build: { outDir: "dist", emptyOutDir: true },
  plugins: contentEditorPlugins(),
});
