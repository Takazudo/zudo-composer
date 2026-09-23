import { resolve } from "node:path";
import { generateDemoTokenManifest } from "../../shared/generate-demo-token-manifest.mjs";

const host = resolve(import.meta.dirname, "..");
const manifest = await generateDemoTokenManifest(
  resolve(host, "../../packages/demo-landing/styles/base.css"),
  resolve(host, "src/styleguide/token-manifest.ts"),
  "land",
);
console.log(`Landing tokens: ${Object.values(manifest).reduce((sum, values) => sum + values.length, 0)} actual CSS variables`);
