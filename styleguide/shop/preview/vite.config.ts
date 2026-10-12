import { defineConfig } from "vite";
import tailwind from "@tailwindcss/vite";
import { resolve } from "node:path";
export default defineConfig({
  root: resolve(import.meta.dirname),
  base: "/_shop-preview/",
  plugins: [tailwind()],
  esbuild: { jsx: "automatic", jsxImportSource: "preact" },
  build: {
    outDir: resolve(import.meta.dirname, "../public/_shop-preview"),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(import.meta.dirname, "main.tsx"),
      output: {
        entryFileNames: "preview.js",
        assetFileNames: "[name][extname]",
      },
    },
  },
});
