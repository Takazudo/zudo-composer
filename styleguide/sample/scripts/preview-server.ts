import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  definePlugin,
  type ZfbDevMiddlewareContext,
  type ZfbDevMiddlewareResponse,
} from "@takazudo/zfb/plugins";
import {
  externalPreview,
  previewDocumentPath,
} from "../src/config/preview.mjs";

function registerPreview({ projectRoot, register }: ZfbDevMiddlewareContext) {
  register(
    externalPreview.url,
    async (request): Promise<ZfbDevMiddlewareResponse | undefined> => {
      const pathname = new URL(request.url, "http://localhost").pathname;
      if (
        pathname !== externalPreview.url &&
        pathname !== `${externalPreview.url}/`
      ) {
        return;
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        return { status: 405, headers: { allow: "GET, HEAD" } };
      }
      return {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
        body:
          request.method === "HEAD"
            ? ""
            : await readFile(
                resolve(projectRoot, "public", previewDocumentPath),
                "utf8",
              ),
      };
    },
  );
}

// zfb dev otherwise injects shell assets even into a static public HTML file.
// The public middleware response preserves the same isolated document as SSG.
export default definePlugin({
  name: "sample-preact-preview",
  devMiddleware: registerPreview,
});
