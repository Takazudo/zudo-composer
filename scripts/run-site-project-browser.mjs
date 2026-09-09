// @ts-check

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

/** @typedef {import("node:child_process").SpawnOptions} SpawnOptions */
/** @typedef {{status: number | null, signal: NodeJS.Signals | null, stdout: string, stderr: string}} RunResult */
/** @typedef {import("../src/site-project/api/types.ts").SiteProjectApiRequest} SiteProjectApiRequest */
/** @typedef {import("../src/site-project/api/types.ts").SiteProjectApiResponse} SiteProjectApiResponse */
/** @typedef {import("../src/site-project/api/types.ts").ReleasePlan} ReleasePlan */
/** @typedef {import("../src/site-project/model/types.ts").SiteProject} SiteProject */
/** @typedef {{revision: string, buildId: string}} ApplyResult */

const root = resolve(import.meta.dirname, "..");

/**
 * @param {string} command
 * @param {string[]} args
 * @param {({input?: string} & SpawnOptions)} [runOptions]
 * @returns {Promise<RunResult>}
 */
function run(command, args, { input, ...options } = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: ["pipe", "pipe", "pipe"], ...options });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (status, signal) => resolveRun({ status, signal, stdout, stderr }));
    if (input !== undefined) child.stdin?.end(input);
  });
}

/**
 * @param {RunResult} result
 * @param {string} operation
 * @returns {import("@zudo-composer/component-contract").JsonValue}
 */
function parseCli(result, operation) {
  if (result.status !== 0) throw new Error(`${operation} exited ${result.status}: ${result.stderr || result.stdout}`);
  /** @type {SiteProjectApiResponse} */
  let response;
  try { response = JSON.parse(result.stdout); }
  catch (error) { throw new Error(`${operation} did not return one JSON response: ${result.stdout}`, { cause: error }); }
  if (!response.ok) throw new Error(`${operation} was rejected: ${JSON.stringify(response.error)}`);
  return response.result;
}

/**
 * @param {SiteProjectApiRequest} request
 * @param {NodeJS.ProcessEnv} environment
 * @returns {Promise<import("@zudo-composer/component-contract").JsonValue>}
 */
async function runCli(request, environment) {
  const result = await run(process.execPath, ["--import", "tsx", "server/site-project-local/cli.ts"], {
    env: { ...process.env, ...environment },
    input: `${JSON.stringify(request)}\n`,
  });
  return parseCli(result, request.operation);
}

// `realpath` is harmless here, not required: the store accepts a root behind
// a symlinked ancestor (e.g. macOS `os.tmpdir()` -> `/private/var/folders/...`).
const temporaryRoot = await realpath(await mkdtemp(join(tmpdir(), "zudo-composer-site-project-browser-")));
try {
  const releaseRoot = join(temporaryRoot, "release");
  const mediaRoot = join(temporaryRoot, "media");
  // The data root covers content, mappings, sitemaps and the workspace
  // registry. Without it the lane seeds its workspace into THIS repository's
  // `cms/`, which both leaves state behind and makes the run order matter.
  const dataRoot = join(temporaryRoot, "data");
  await Promise.all([mkdir(releaseRoot), mkdir(mediaRoot), mkdir(dataRoot)]);
  const environment = { ZUDO_SITE_PROJECT_ROOT: releaseRoot, ZUDO_ASSETS_STORE_ROOT: mediaRoot, ZUDO_DATA_ROOT: dataRoot };
  const project = /** @type {SiteProject} */ (JSON.parse(await readFile(join(root, "src/test/site-project-fixture.json"), "utf8")));
  const plan = /** @type {ReleasePlan} */ (/** @type {unknown} */ (await runCli({
    protocolVersion: 2,
    operation: "plan",
    project,
    workingPrecondition: null,
    selection: project.providers.content.flatMap((provider) => provider.entries.map((entry) => ({ ref: { providerId: provider.id, modelId: entry.modelId, recordId: entry.id }, action: "publish" }))),
    expectedRevision: null,
    expectedActive: null,
  }, environment)));
  const applyResult = /** @type {ApplyResult} */ (await runCli({ protocolVersion: 2, operation: "apply", plan }, environment));
  const revision = applyResult.revision;
  if (typeof revision !== "string" || !/^[a-f0-9]{64}$/u.test(revision)) throw new Error("CLI apply did not return a revision digest.");
  await runCli({ protocolVersion: 2, operation: "build", projectId: project.id, buildId: applyResult.buildId }, environment);
  await runCli({
    protocolVersion: 2,
    operation: "activate",
    projectId: project.id,
    revision,
    buildId: applyResult.buildId,
    expectedActive: null,
  }, environment);

  const playwright = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const result = await run(playwright, ["exec", "playwright", "test", "--config", "playwright.site-project.config.ts", "tests/browser/site-project-acceptance.pw.ts"], {
    env: { ...process.env, ...environment },
    stdio: "inherit",
  });
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
