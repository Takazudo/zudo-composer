import { build } from "esbuild";
// Separate visitor graph: the editor mounts in its own document and owns its own CSS.
await build({ entryPoints: { preview: "src/preview.tsx", review: "src/review.ts" }, outdir: "public", bundle: true, platform: "browser", format: "esm",
  target: "es2022", jsx: "automatic", jsxImportSource: "@takazudo/zfb/zudo-react", metafile: true,
  write: true }).then(async (result) => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile("preview-metafile.json", JSON.stringify(result.metafile, null, 2));
    for (const [output, detail] of Object.entries(result.metafile.outputs)) {
      if (!output.endsWith("preview.js")) continue;
      const hostComponent = Object.entries(detail.inputs).find(([input]) => input.endsWith("src/OfferPage.tsx"));
      if (!hostComponent || hostComponent[1].bytesInOutput === 0) throw Error("The preview output must execute the shared real host component");
      const markdown = Object.entries(detail.inputs).find(([input, value]) => /(?:^|\/)marked(?:@|\/)|\/marked\//.test(input) && value.bytesInOutput > 0);
      if (!markdown) throw Error("Shared preview must emit the real host-only Markdown parser");
      const receiver = Object.entries(detail.inputs).find(([input, value]) => input.endsWith("/hosted-content/preview.mjs") && value.bytesInOutput > 0);
      if (!receiver) throw Error("The preview output must execute the public neutral Composer receiver");
    }
    for (const input of Object.keys(result.metafile.inputs)) {
      if (/src\/hosted-content\/editor|preact|codemirror|node:|virtual:/.test(input)) throw Error(`Host preview graph leaked editor/runtime dependency: ${input}`);
    }
  });

// A genuine zudo-react mount requires the SDK-generated skip-SSR root boundary.
const { spawn } = await import("node:child_process");
await new Promise((ready, reject) => {
  const child = spawn("corepack", ["pnpm", "exec", "tsx", "--tsconfig", "tsconfig.json", "scripts/build-preview-document.mjs"], { stdio: "inherit" });
  child.once("error", reject);
  child.once("exit", code => code === 0 ? ready() : reject(Error(`SDK preview boundary generation exited ${code}`)));
});
