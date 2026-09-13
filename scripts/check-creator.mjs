// @ts-check
import assert from "node:assert/strict";
import { lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { assertCreatorVersionParity, createHostConfigFiles, HOST_TEMPLATE_ROOT, readCreatorMetadata, writeHostProject } from "../server/creator/project.mjs";
import { scanConsumerHost } from "./check-consumer-boundary.mjs";

// No install is needed to scan a verbatim template copy with its generated
// configuration. --host adds the complete output of a real init invocation.
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--host")) throw new Error("Usage: check-creator.mjs [--host <generated-host>]");
const metadata = await readCreatorMetadata();
const temporary = await mkdtemp(join(tmpdir(), "zudo-creator-boundary-"));
try {
  for (const path of [...Object.keys(createHostConfigFiles("creator-boundary", metadata)), "site-project.json", "cms"]) {
    await assert.rejects(lstat(join(HOST_TEMPLATE_ROOT, path)), { code: "ENOENT" }, `Template must not contain generated ${path}`);
  }
  const template = join(temporary, "host");
  await writeHostProject(template, "creator-boundary", metadata);
  const hosts = [template, ...(args.length ? [resolve(args[1])] : [])];
  for (const hostRoot of hosts) {
    assertCreatorVersionParity(JSON.parse(await readFile(join(hostRoot, "package.json"), "utf8")), metadata);
    assert.deepEqual(scanConsumerHost({ root: hostRoot, hostRoot }), [], `Creator consumer boundary failed in ${hostRoot}`);
  }
  if (args.length) {
    const required = JSON.parse(await readFile(new URL("./creator-required-files.json", import.meta.url), "utf8"));
    for (const path of /** @type {string[]} */ (Object.values(required).flat())) {
      assert.ok((await lstat(join(resolve(args[1]), path))).isFile(), `Generated host is missing required file ${path}`);
    }
  }
  console.log(`Creator checks passed: version parity and strict consumer boundary (${hosts.length} host trees).`);
} finally { await rm(temporary, { recursive: true, force: true }); }
