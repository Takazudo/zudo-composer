#!/usr/bin/env node
// Renders the hand-built demo illustrations (scripts/demo/art/*) to budgeted WebP
// files plus per-demo manifests. Usage: node scripts/demo/optimise-images.mjs [demo...]
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import * as blog from "./art/blog.mjs";
import * as landing from "./art/landing.mjs";
import * as shop from "./art/shop.mjs";
import * as studio from "./art/studio.mjs";

export const MAX_FILE_BYTES = 250 * 1024;
const TARGET_BYTES = MAX_FILE_BYTES - 8 * 1024;
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
export const demos = [shop, landing, blog, studio];

/** Encodes at the highest WebP quality that stays under the per-file budget. */
export async function encode(image) {
  const raster = await sharp(Buffer.from(image.svg)).resize(image.width, image.height, { fit: "cover" }).png().toBuffer();
  for (let quality = 86; quality >= 40; quality -= 6) {
    const bytes = await sharp(raster).webp({ quality, effort: 6, smartSubsample: true }).toBuffer();
    if (bytes.byteLength <= TARGET_BYTES) return { bytes, quality };
  }
  throw new Error(`${image.file} cannot meet ${TARGET_BYTES} bytes even at quality 40`);
}

async function build(module) {
  const dir = resolve(repositoryRoot, module.demo.dir);
  await mkdir(dir, { recursive: true });
  let total = 0;
  for (const image of module.images) {
    const { bytes, quality } = await encode(image);
    await writeFile(resolve(dir, image.file), bytes);
    total += bytes.byteLength;
    console.log(`${module.demo.name}/${image.file}  ${image.width}x${image.height}  q${quality}  ${(bytes.byteLength / 1024).toFixed(1)} KB`);
  }
  const manifest = module.images.map(({ file, alt, use, aspect }) => ({ file, alt, use, aspect }));
  await writeFile(resolve(repositoryRoot, module.demo.manifestPath), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`${module.demo.name}: ${module.images.length} files, ${(total / 1024).toFixed(1)} KB`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const only = process.argv.slice(2);
  for (const module of demos.filter(({ demo }) => only.length === 0 || only.includes(demo.name))) await build(module);
}
