#!/usr/bin/env node
// Persistent local Hosted Content host:
//   node fixtures/hosted-content-consumer/local.mjs --prepare [--sha <commit>]   (once; installs the real renderer)
//   node fixtures/hosted-content-consumer/local.mjs [--dir <path>] [--port <n>] [--reset]
import { parseArgs } from "node:util";
import { defaultLocalDirectory, defaultLocalPort, startLocalHostedContent } from "./local/host.mjs";
import { defaultRendererHostRoot, prepareRendererHost } from "./local/renderer-host.mjs";

const { values } = parseArgs({ options: { dir: { type: "string" }, port: { type: "string" }, reset: { type: "boolean", default: false },
  prepare: { type: "boolean", default: false }, sha: { type: "string" }, "renderer-host": { type: "string" }, help: { type: "boolean", default: false } } });
const rendererHost = values["renderer-host"] ?? defaultRendererHostRoot();
if (values.help) {
  console.log(`Usage:
  node fixtures/hosted-content-consumer/local.mjs --prepare [--sha <commit>] [--renderer-host <path>]
  node fixtures/hosted-content-consumer/local.mjs [--dir <path>] [--port <n>] [--reset] [--renderer-host <path>]

  --prepare        One-time step: install the real host renderer (renderer/: ZFB + zudo-sg) with
                   scripts/install-hosted-consumer.mjs into --renderer-host, then exit. Needs network.
  --sha            Pushed zudo-composer commit to install (default: merge-base with origin/main);
                   its server/hosted-content must equal this checkout's.
  --renderer-host  Prepared renderer location (default ${defaultRendererHostRoot()})
  --dir            Data directory (default ${defaultLocalDirectory()})
  --port           Loopback port (default ${defaultLocalPort}; 0 picks a free port)
  --reset          Delete this host's data, publications and local artifacts before starting

Normal start keeps all data and never installs anything. Nothing is published live; artifacts are local files.`);
  process.exit(0);
}
if (values.prepare) {
  try {
    const prepared = await prepareRendererHost({ root: rendererHost, sha: values.sha });
    console.log(`Real host renderer prepared at ${prepared.directory} (zudo-composer@${prepared.toolSha}). Start the host without --prepare.`);
    process.exit(0);
  } catch (error) { console.error(error.message); process.exit(1); }
}
const port = values.port === undefined ? defaultLocalPort : Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("--port must be an integer between 0 and 65535");
// Test-only fault injection for the recovery proofs; never set by a person using the host.
const faults = process.env.ZUDO_LOCAL_HOSTED_FAULTS ? JSON.parse(process.env.ZUDO_LOCAL_HOSTED_FAULTS) : {};

let running;
try { running = await startLocalHostedContent({ directory: values.dir ?? defaultLocalDirectory(), port, reset: values.reset, rendererHost, faults }); }
catch (error) { console.error(error.message); process.exit(1); }
console.log(`Local Hosted Content host (local only: nothing here is live or production)
  URL:        ${running.url}
  Data:       ${running.database}
  Artifacts:  ${running.artifacts} (opened via ${running.url}local-artifacts/<publication>/)
  Renderer:   ${running.rendererLocation} (real ZFB + zudo-sg renderer)
  Sink:       ${running.sinkFile}
Press Ctrl+C to stop. Data is kept; pass --reset to start over.`);
const stop = async () => { await running.close(); process.exit(0); };
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
