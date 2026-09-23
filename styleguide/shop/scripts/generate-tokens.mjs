import { resolve } from "node:path";
import { generateDemoTokenManifest } from "../../shared/generate-demo-token-manifest.mjs";

const host = resolve(import.meta.dirname, "..");
const manifest = await generateDemoTokenManifest(
  resolve(host, "../../packages/demo-webshop/styles/base.css"),
  resolve(host, "src/styleguide/token-manifest.ts"),
  "shop",
);
console.log(`Shop tokens: ${Object.values(manifest).reduce((sum, values) => sum + values.length, 0)} actual CSS variables`);
