// @ts-check
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { discoverPackedHosts } from "./packed-host-helpers.mjs";
import { buildDemoEditor } from "./build-demo-editor.mjs";

/** Discovery owns fleet membership; each editor build must finish before the next.
 * @param {string} [root]
 * @param {(host: string) => Promise<void>} [buildEditor]
 */
export async function buildDemoEditors(root = resolve(import.meta.dirname, ".."), buildEditor = buildDemoEditor) {
  for (const host of discoverPackedHosts(root)) await buildEditor(host);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 2) throw new Error("Usage: pnpm demo:build-editors");
  await buildDemoEditors();
}
