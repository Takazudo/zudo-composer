// Bundles the local shell (public editor + its explicit CSS) in memory. The preview frame is the real
// renderer's own preview build, served from the prepared renderer installation.
import { fileURLToPath } from "node:url";
import { build } from "vite";

const here = fileURLToPath(new URL(".", import.meta.url));
const aliases = ["zudo-composer/hosted-content/editor.css", "zudo-composer/hosted-content/editor", "zudo-composer/hosted-content"]
  .map(find => ({ find, replacement: fileURLToPath(import.meta.resolve(find)) }));

export async function buildLocalUi() {
  const result = await build({
    configFile: false, root: here, logLevel: "warn", publicDir: false,
    resolve: { alias: aliases },
    build: {
      write: false, minify: false, modulePreload: false, copyPublicDir: false, reportCompressedSize: false,
      rollupOptions: {
        input: { shell: fileURLToPath(new URL("ui/shell.mjs", import.meta.url)) },
        output: { entryFileNames: "[name].js", chunkFileNames: "chunks/[name]-[hash].js", assetFileNames: "[name][extname]" },
      },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap(item => item.output);
  const files = new Map(outputs.map(item => [`/${item.fileName}`, item.type === "chunk" ? item.code : item.source]));
  if (!files.has("/shell.js") || !files.has("/shell.css")) throw new Error("Local shell bundle is incomplete");
  return files;
}
