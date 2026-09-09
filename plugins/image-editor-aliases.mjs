import { resolve } from "node:path";
import { APP_ROOT } from "./roots.mjs";
/** @param {string} [appRoot] */
export function resolveImageEditorAliases(appRoot = APP_ROOT) {
  return [
    {
      find: /^@zudo-composer\/image-editor$/,
      replacement: resolve(appRoot, "packages/image-editor/src/index.ts"),
    },
    {
      find: /^@zudo-composer\/image-editor\/worker$/,
      replacement: resolve(
        appRoot,
        "packages/image-editor/src/worker/client.ts",
      ),
    },
    {
      find: /^@zudo-composer\/image-editor\/ui$/,
      replacement: resolve(appRoot, "packages/image-editor/src/ui/index.ts"),
    },
  ];
}
