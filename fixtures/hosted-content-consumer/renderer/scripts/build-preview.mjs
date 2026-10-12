import { build } from "esbuild";
// Separate visitor graph: the editor mounts in its own document and owns its own CSS.
await build({ entryPoints: { preview: "src/preview.tsx", review: "src/review.ts" }, outdir: "public", bundle: true, platform: "browser", format: "esm",
  target: "es2022", jsx: "automatic", jsxImportSource: "@takazudo/zfb/zudo-react", metafile: true,
  write: true }).then(async (result) => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile("preview-metafile.json", JSON.stringify(result.metafile, null, 2));
    for (const input of Object.keys(result.metafile.inputs)) {
      if (/src\/hosted-content\/editor|preact|codemirror|node:|virtual:/.test(input)) throw Error(`Host preview graph leaked editor/runtime dependency: ${input}`);
    }
  });
