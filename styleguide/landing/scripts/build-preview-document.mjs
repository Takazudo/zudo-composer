import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { previewDocumentPath } from "../src/config/preview.mjs";
// Static public document bypasses zfb's automatic shell CSS/island injection.
const output = join("public", previewDocumentPath);
await mkdir(dirname(output), { recursive: true });
await writeFile(
  output,
  `<!doctype html><html lang="en" data-sg-preview-doc><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><link rel="icon" href="data:,"><title>Landing component preview</title><link rel="stylesheet" href="/_landing-preview/main.css"></head><body><div id="landing-preview"></div><script type="module" src="/_landing-preview/preview.js"></script></body></html>`,
);
