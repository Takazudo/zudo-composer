#!/usr/bin/env node
import { runSiteProjectCli } from "./cli-runner";
import { createLocalSiteProjectApiService } from "./service";
import { validateMediaStoreRoot } from "../../plugins/composer-file-provider-plugin.mjs";

try {
  process.exitCode = await runSiteProjectCli(createLocalSiteProjectApiService({ mediaStoreRoot: validateMediaStoreRoot(process.env.ZUDO_MEDIA_STORE_ROOT) }), {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
  });
} catch (error) {
  process.stderr.write(`SiteProject CLI internal failure: ${error instanceof Error ? error.message : "unknown error"}\n`);
  process.stdout.write('{"error":{"code":"internal","message":"The SiteProject CLI failed unexpectedly."},"ok":false}\n');
  process.exitCode = 1;
}
