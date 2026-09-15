// @ts-check
// Explicit preparation, outside every browser lane: discover the host fleet and
// build each artifact through the installed CLI before its browser crawl.
import { execFile as execFileCallback } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { discoverPackedHosts } from "./packed-host-helpers.mjs";

const execFile = promisify(execFileCallback);
const root = resolve(import.meta.dirname, "..");
if (process.argv.length !== 2) throw new Error("Usage: build-demo-sites.mjs");
for (const host of discoverPackedHosts(root)) {
  const { stdout, stderr } = await execFile(process.execPath, ["bin/zudo-composer.mjs", "build-site", "--root", host], {
    cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
  });
  process.stdout.write(stdout);
  process.stderr.write(stderr);
}
