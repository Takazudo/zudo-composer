import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assetAuthoringUrl } from "../../src/assets/model/types";

/**
 * File name → canonical authoring URL for the active assets in a resolved host
 * config. Use `loadHostContext()` from `zudo-composer/vite` to resolve that config.
 * Asset ids are minted at upload, so authored sites look them up by file name.
 */
export function readAssetUrls(config: { paths: { assets: string } }): Record<string, string> {
  const catalog = JSON.parse(readFileSync(join(config.paths.assets, "catalog.json"), "utf8")) as {
    records: { id: string; document: { fileName: string; state: "active" | "trash" } }[];
  };
  const urls = new Map<string, string>();
  for (const record of catalog.records) {
    if (record.document.state !== "active") continue;
    if (urls.has(record.document.fileName)) throw new Error(`Two active assets are named ${record.document.fileName}.`);
    urls.set(record.document.fileName, assetAuthoringUrl(record.id));
  }
  return Object.fromEntries(urls);
}
