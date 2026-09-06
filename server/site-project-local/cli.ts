#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { runSiteProjectCli } from "./cli-runner";
import { createLocalSiteProjectApiService } from "./service";
import { validateMediaStoreRoot } from "../../plugins/composer-file-provider-plugin.mjs";
import { loadComponentPack } from "../../plugins/component-pack.mjs";
import { loadComposerConfig } from "../config";

try {
  // Run under `tsx`, so the host config and the pack are both plain dynamic
  // imports; the installed lane goes through `server/cli/release-entry.mjs`, whose
  // Vite module runner does the same job where Node cannot strip types.
  const config = await loadComposerConfig();
  const { identity, pack } = await loadComponentPack(config.workspaceRoot, config.settings.pack, (entryPath) =>
    import(/* @vite-ignore */ pathToFileURL(entryPath).href) as Promise<Record<string, unknown>>,
  );
  process.exitCode = await runSiteProjectCli(createLocalSiteProjectApiService({
    pack,
    packIdentity: identity,
    workspaceRoot: config.workspaceRoot,
    mediaStoreRoot: validateMediaStoreRoot(process.env.ZUDO_MEDIA_STORE_ROOT) ?? config.paths.media,
  }), {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
  });
} catch (error) {
  process.stderr.write(`SiteProject CLI internal failure: ${error instanceof Error ? error.message : "unknown error"}\n`);
  process.stdout.write('{"error":{"code":"internal","message":"The SiteProject CLI failed unexpectedly."},"ok":false}\n');
  process.exitCode = 1;
}
