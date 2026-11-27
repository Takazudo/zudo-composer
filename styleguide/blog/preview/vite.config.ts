import { defineConfig } from "vite";
import tailwind from "@tailwindcss/vite";
import { resolve } from "node:path";
export default defineConfig({
  root: resolve(import.meta.dirname),
  base: "/_blog-preview/",
  plugins: [tailwind()],
  // A second zudo-react copy would split signals and roots silently.
  resolve: { dedupe: ["@takazudo/zfb"] },
  esbuild: { jsx: "automatic", jsxImportSource: "@takazudo/zfb/zudo-react" },
  build: {
    outDir: resolve(import.meta.dirname, "../public/_blog-preview"),
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
