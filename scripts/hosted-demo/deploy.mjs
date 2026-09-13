// @ts-check

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { verifyLiveWithRetries } from "./live-check.mjs";
import { DEFAULT_TARGET_KEY, resolveTarget } from "./targets.mjs";

const execFileAsync = promisify(execFile);
const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const DEFAULT_TARGET = resolveTarget(DEFAULT_TARGET_KEY);
// Back-compat single-target exports: these always describe the default
// (zudo-composer) target. Multi-target callers pass an explicit `target`.
export const WORKER_NAME = DEFAULT_TARGET.workerName;
export const CONFIG_PATH = DEFAULT_TARGET.configPath;
export const WRANGLER_BIN = resolve(root, "node_modules/.bin/wrangler");
export const ARTIFACT_DIRECTORY = DEFAULT_TARGET.artifactDirectory;
export const DEPLOYMENT_RETRY_DELAYS_MS = [1_000, 2_000, 4_000];
// A first rollout is also waiting on a hostname that did not exist a moment
// ago: the same call creates the custom domain's DNS records, and a resolver
// that answers with AAAA before A makes the first fetch fail outright on an
// IPv4-only runner. Measured: the ordinary ~7s live-check budget expired before
// zc-demo-*.zudolab.dev resolved on every path. Later rollouts never need this.
export const FIRST_DEPLOY_LIVE_RETRY_DELAYS_MS = [5_000, 10_000, 20_000, 30_000, 30_000, 30_000];
export const FIRST_DEPLOY_LIVE_TIMEOUT_MS = 240_000;
const VERSION_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

/** @param {Record<string, string | undefined>} environment @returns {"absent" | "partial" | "complete"} */
export function deploymentCredentialState(environment) {
  const token = Boolean([environment.CLOUDFLARE_API_TOKEN, environment.CLOUDFLARE_TOKEN].find((value) => value?.trim()));
  const account = Boolean(environment.CLOUDFLARE_ACCOUNT_ID?.trim());
  if (token && account) return "complete";
  if (!token && !account) return "absent";
  return "partial";
}

/** @param {Record<string, string | undefined>} environment @returns {{ token: string, accountId: string }} */
export function requireDeploymentCredentials(environment) {
  const state = deploymentCredentialState(environment);
  if (state === "absent") throw new Error("Missing Cloudflare deployment credentials: set CLOUDFLARE_API_TOKEN (or CLOUDFLARE_TOKEN) and CLOUDFLARE_ACCOUNT_ID.");
  if (state === "partial") throw new Error("Partial Cloudflare deployment credentials: set a Cloudflare API token (CLOUDFLARE_API_TOKEN or CLOUDFLARE_TOKEN) and CLOUDFLARE_ACCOUNT_ID.");
  const token = [environment.CLOUDFLARE_API_TOKEN, environment.CLOUDFLARE_TOKEN].find((value) => value?.trim())?.trim() ?? "";
  const accountId = environment.CLOUDFLARE_ACCOUNT_ID?.trim() ?? "";
  return { token, accountId };
}

/** @param {string} text @param {Record<string, string | undefined>} environment @returns {string} */
function redact(text, environment) {
  let result = text;
  for (const name of ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_TOKEN"]) {
    const value = environment[name];
    if (value) result = result.split(value).join("[redacted]");
  }
  return result;
}

/**
 * @param {string} file
 * @param {string[]} args
 * @param {{ cwd?: string, environment?: Record<string, string | undefined>, timeoutMs?: number }} [options]
 */
export async function runCommand(file, args, options = {}) {
  const environment = options.environment ?? process.env;
  try {
    const result = await execFileAsync(file, args, {
      cwd: options.cwd ?? root,
      env: /** @type {NodeJS.ProcessEnv} */ (environment),
      maxBuffer: 2 * 1024 * 1024,
      timeout: options.timeoutMs ?? 120_000,
    });
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = /** @type {{ stdout?: string, stderr?: string, message?: string, code?: number | string }} */ (error);
    const output = redact(`${failure.stdout ?? ""}${failure.stderr ?? ""}`.trim(), environment);
    throw new Error(`${file} ${args.join(" ")} failed${failure.code === undefined ? "" : ` with exit ${failure.code}`}${output ? `:\n${output}` : ""}`, { cause: error });
  }
}

/** @param {string} output @returns {unknown} */
export function parseWranglerJson(output) {
  const ansiEscapePattern = new RegExp(`${String.fromCharCode(0x1b)}\\[[0-?]*[ -/]*[@-~]`, "g");
  const clean = output.replaceAll(ansiEscapePattern, "").trim();
  try {
    return JSON.parse(clean);
  } catch (error) {
    throw new Error(`Wrangler JSON output was not valid JSON: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

/** @param {string[]} args @param {{ environment?: Record<string, string | undefined>, runner?: typeof runCommand }} [options] */
export async function runWrangler(args, options = {}) {
  const environment = { ...process.env, ...(options.environment ?? {}) };
  const credentials = deploymentCredentialState(environment) === "complete" ? requireDeploymentCredentials(environment) : undefined;
  if (credentials && !environment.CLOUDFLARE_API_TOKEN?.trim()) environment.CLOUDFLARE_API_TOKEN = credentials.token;
  const runner = options.runner ?? runCommand;
  return runner(WRANGLER_BIN, args, { cwd: root, environment });
}

/** @param {unknown} value @param {string} label @returns {Record<string, unknown>} */
function record(value, label) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return /** @type {Record<string, unknown>} */ (value);
}

/** @param {unknown} value @param {string} label @returns {Array<Record<string, unknown>>} */
function records(value, label) {
  assert.ok(Array.isArray(value), `${label} must be an array`);
  return value.map((item) => record(item, label));
}

/** @param {Record<string, unknown>} deployment @returns {string | undefined} */
export function singleVersionId(deployment) {
  const versions = deployment.versions;
  if (!Array.isArray(versions) || versions.length !== 1) return undefined;
  const traffic = record(versions[0], "deployment version");
  if (Number(traffic.percentage) !== 100 || typeof traffic.version_id !== "string" || !traffic.version_id) return undefined;
  return traffic.version_id;
}

/** @param {Array<Record<string, unknown>>} deployments @returns {Array<Record<string, unknown>>} */
export function sortDeploymentsNewestFirst(deployments) {
  return [...deployments].sort((left, right) => {
    const leftDate = Date.parse(String(left.created_on ?? ""));
    const rightDate = Date.parse(String(right.created_on ?? ""));
    assert.ok(Number.isFinite(leftDate) && Number.isFinite(rightDate), "Cloudflare deployments must have valid created_on timestamps");
    return rightDate - leftDate || String(right.id ?? "").localeCompare(String(left.id ?? ""));
  });
}

/**
 * Capture the active deployment and a single-version rollback target. Wrangler
 * currently prints deployments oldest-first, so this sorts independently before
 * selecting either deployment.
 *
 * @param {{ deployments: unknown, versions: unknown }} input
 */
export function captureDeploymentState({ deployments, versions }) {
  const deploymentList = sortDeploymentsNewestFirst(records(deployments, "Cloudflare deployments"));
  const versionList = records(versions, "Cloudflare versions");
  assert.ok(deploymentList.length > 0, "Cloudflare returned no deployments; refusing to mutate production");

  const activeDeployment = deploymentList[0];
  const activeDeploymentId = activeDeployment.id;
  const activeVersionId = singleVersionId(activeDeployment);
  assert.ok(typeof activeDeploymentId === "string" && activeDeploymentId, "Active Cloudflare deployment has no ID");
  assert.ok(activeVersionId, "Active Cloudflare deployment is not a single version at 100%; refusing automatic rollback setup");

  const activeVersion = versionList.find((version) => version.id === activeVersionId);
  assert.ok(activeVersion, `Active version ${activeVersionId} was not present in Wrangler versions list`);

  // The rollback target is the exact single-version deployment that was active
  // before this run. Never infer an arbitrary older version: an uploaded but
  // not-yet-deployed version can appear in `versions list`, and may not be the
  // bytes currently serving the custom domain.
  const rollbackDeployment = activeDeployment;
  const rollbackVersionId = activeVersionId;

  return {
    activeDeploymentId,
    activeVersionId,
    activeCreatedOn: String(activeDeployment.created_on),
    rollbackDeploymentId: activeDeploymentId,
    rollbackVersionId,
    rollbackCreatedOn: String(rollbackDeployment.created_on),
  };
}

/** @param {string} output @returns {string | undefined} */
export function parseUploadedVersionId(output) {
  const matches = [
    ...output.matchAll(/Worker\s+Version\s+ID:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi),
    ...output.matchAll(/"version_id"\s*:\s*"([0-9a-f-]{36})"/gi),
  ];
  const id = matches.at(-1)?.[1];
  return id && VERSION_ID_PATTERN.test(id) ? id : undefined;
}

// Keep a descriptive compatibility export for focused callers. Deployment
// code uses the upload-specific name and never infers an active version.
export const parseDeployedVersionId = parseUploadedVersionId;

// Cloudflare's API error for a script that was never uploaded. Wrangler prints
// the numeric code alongside its own message, and the wording has changed
// between versions, so match the code and both message spellings.
const WORKER_NOT_FOUND_PATTERN = /\[code:\s*10007\]|script_not_found|Worker not found|workers\.api\.error\.not_found/i;

/** @param {unknown} error @returns {boolean} */
export function isWorkerNotFound(error) {
  return WORKER_NOT_FOUND_PATTERN.test(error instanceof Error ? error.message : String(error));
}

/** @template T @param {() => Promise<T>} work @returns {Promise<{ value?: T, error?: unknown }>} */
async function settle(work) {
  try {
    return { value: await work() };
  } catch (error) {
    return { error };
  }
}

/** @typedef {import("./targets.mjs").DeployTarget} DeployTarget */

/** @param {DeployTarget} target @param {{ environment?: Record<string, string | undefined>, runner?: typeof runCommand }} [options] */
async function listDeployments(target, options = {}) {
  const result = await runWrangler(["deployments", "list", "--name", target.workerName, "--config", target.configPath, "--json"], options);
  return records(parseWranglerJson(result.stdout), "Cloudflare deployments");
}

/** @param {DeployTarget} target @param {{ environment?: Record<string, string | undefined>, runner?: typeof runCommand }} [options] */
async function listVersions(target, options = {}) {
  const result = await runWrangler(["versions", "list", "--name", target.workerName, "--config", target.configPath, "--json"], options);
  return records(parseWranglerJson(result.stdout), "Cloudflare versions");
}

/** @param {DeployTarget} target @param {{ environment?: Record<string, string | undefined>, runner?: typeof runCommand }} [options] */
async function currentDeployment(target, options = {}) {
  const deployments = await listDeployments(target, options);
  const sorted = sortDeploymentsNewestFirst(deployments);
  assert.ok(sorted.length > 0, "Cloudflare returned no active deployment after upload");
  const activeVersionId = singleVersionId(sorted[0]);
  assert.ok(activeVersionId, "Cloudflare active deployment is not a single 100% version");
  return { deployment: sorted[0], activeVersionId };
}

/** @param {{ deployment: Record<string, unknown>, activeVersionId: string }} current @param {{ activeDeploymentId: string, activeVersionId: string }} expected */
function assertCapturedActive(current, expected) {
  assert.equal(
    current.deployment.id,
    expected.activeDeploymentId,
    `Cloudflare active deployment changed during rollout: expected ${expected.activeDeploymentId}, received ${String(current.deployment.id)}`,
  );
  assert.equal(
    current.activeVersionId,
    expected.activeVersionId,
    `Cloudflare active version changed during rollout: expected ${expected.activeVersionId}, received ${current.activeVersionId}`,
  );
  return current;
}

/**
 * Rollback state for a Worker that already exists, or the first-deploy marker
 * when Cloudflare has no such script yet.
 *
 * A Worker whose very first version has not been uploaded has no deployments
 * and no rollback target, so the ordinary capture can never succeed for it —
 * that is the entire reason a new target's first rollout needs its own path.
 * Both listings must agree the script is missing: a Worker that answers one
 * listing and reports "not found" for the other is an unexplained state, and
 * still fails closed before any mutation.
 *
 * @param {DeployTarget} target
 * @param {{ environment?: Record<string, string | undefined>, runner?: typeof runCommand }} options
 * @returns {Promise<{ firstDeploy: true } | ({ firstDeploy: false } & ReturnType<typeof captureDeploymentState>)>}
 */
async function captureRolloutState(target, options) {
  const [deployments, versions] = await Promise.all([
    settle(() => listDeployments(target, options)),
    settle(() => listVersions(target, options)),
  ]);
  if (isWorkerNotFound(deployments.error) && isWorkerNotFound(versions.error)) return { firstDeploy: true };
  if (deployments.error) throw deployments.error;
  if (versions.error) throw versions.error;
  return { firstDeploy: false, ...captureDeploymentState({ deployments: deployments.value, versions: versions.value }) };
}

/**
 * @param {{ target?: DeployTarget, artifactDirectory?: string, expectedSourceRevision?: string, environment?: Record<string, string | undefined>, runner?: typeof runCommand, artifactVerifier?: import("./targets.mjs").ArtifactVerifier }} [options]
 */
export async function preflightDeployment({ target = DEFAULT_TARGET, artifactDirectory = target.artifactDirectory, expectedSourceRevision, environment = process.env, runner = runCommand, artifactVerifier = target.verifyArtifact } = {}) {
  const resolvedArtifactDirectory = resolve(artifactDirectory);
  const expectedArtifactDirectory = resolve(target.artifactDirectory);
  assert.equal(
    resolvedArtifactDirectory,
    expectedArtifactDirectory,
    `${target.workerName} deployment must verify and upload ${expectedArtifactDirectory}; received ${resolvedArtifactDirectory}`,
  );
  const credentials = requireDeploymentCredentials(environment);
  const artifact = await artifactVerifier({ directory: resolvedArtifactDirectory, expectedSourceRevision });
  assert.equal(typeof artifact.root, "string", `${target.workerName} artifact verifier must return its checked directory`);
  assert.equal(resolve(artifact.root), resolvedArtifactDirectory, `${target.workerName} artifact verifier checked a different directory`);
  if (target.kind === "doc-site") {
    assert.ok(typeof expectedSourceRevision === "string" && expectedSourceRevision.length === 40 && /^[a-f0-9]{40}$/u.test(expectedSourceRevision), "Documentation deployment requires a full expected source Git SHA");
    assert.equal(artifact.manifest.sourceRevision, expectedSourceRevision, "Documentation artifact must record the expected source Git SHA");
  }
  const sourceRevision = artifact.manifest.sourceRevision;
  assert.ok(typeof sourceRevision === "string" && sourceRevision.length === 40 && /^[a-f0-9]{40}$/u.test(sourceRevision), `${target.workerName} deployment requires a full source Git SHA`);
  await runWrangler(["whoami", "--config", target.configPath], { environment, runner });
  const state = await captureRolloutState(target, { environment, runner });
  await runWrangler([
    "deploy",
    "--dry-run",
    "--no-bundle",
    "--config",
    target.configPath,
    "--assets",
    resolvedArtifactDirectory,
  ], { environment, runner });
  return { artifact: { ...artifact, manifest: { ...artifact.manifest, sourceRevision } }, artifactDirectory: resolvedArtifactDirectory, state, credentials, target };
}

/**
 * @param {{ target?: DeployTarget, expectedVersionId: string, environment?: Record<string, string | undefined>, runner?: typeof runCommand, retryDelaysMs?: number[], delayImpl?: (milliseconds: number) => Promise<void> }} options
 */
export async function waitForVersion({ target = DEFAULT_TARGET, expectedVersionId, environment, runner, retryDelaysMs = DEPLOYMENT_RETRY_DELAYS_MS, delayImpl = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds)) }) {
  let lastError;
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    try {
      const current = await currentDeployment(target, { environment, runner });
      if (current.activeVersionId === expectedVersionId) return current;
      lastError = new Error(`Cloudflare is serving ${current.activeVersionId}; expected ${expectedVersionId}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
    if (attempt === retryDelaysMs.length) break;
    await delayImpl(retryDelaysMs[attempt]);
  }
  throw lastError ?? new Error(`Cloudflare did not restore version ${expectedVersionId}`);
}

/** @param {string} sourceRevision @param {Record<string, string | undefined>} environment @returns {{ tag: string, message: string }} */
export function rolloutIdentity(sourceRevision, environment) {
  const runId = environment.HOSTED_DEMO_RUN_ID?.trim() || `local-${process.pid}`;
  assert.match(runId, /^[A-Za-z0-9_.-]+$/, "Hosted deployment run ID contains unsupported tag characters");
  const tag = `hosted-demo-${runId}-${sourceRevision.slice(0, 12)}`;
  return { tag, message: `hosted demo ${sourceRevision} (${tag})` };
}

/** @param {unknown} value @returns {Error} */
function asError(value) {
  return value instanceof Error ? value : new Error(String(value));
}

/**
 * Create a target's very first deployment.
 *
 * This path exists because the ordinary rollout cannot bootstrap a Worker:
 * `versions upload` + `versions deploy` never applies a config's triggers, so a
 * Worker first created that way would serve nothing on its custom domain, and
 * there is no active deployment to capture as a rollback target either. Plain
 * `wrangler deploy` creates the script, uploads the assets and binds the
 * `routes` entry (the custom domain) in one call — and takes neither `--tag`
 * nor `--message`, so the first version carries no rollout tag. The active
 * version ID is then read back from Cloudflare rather than parsed out of the
 * command's output.
 *
 * Nothing is rolled back when live verification fails: the only prior state is
 * "the Worker does not exist", which a rollback cannot restore. The command
 * fails red with the created version named, and the next run takes the ordinary
 * versioned path against it.
 *
 * @param {{ preflight: Awaited<ReturnType<typeof preflightDeployment>>, target: DeployTarget, baseUrl: string, environment: Record<string, string | undefined>, runner: typeof runCommand, liveVerifier: (options: { baseUrl: string, artifactDirectory: string, expectedSourceRevision: string, retryDelaysMs?: number[], overallTimeoutMs?: number }) => Promise<{ routes: unknown[], assets: unknown[], manifest: unknown }> }} options
 */
async function createFirstDeployment({ preflight, target, baseUrl, environment, runner, liveVerifier }) {
  console.log(`${target.workerName} has no deployments on Cloudflare; creating its first one and binding ${target.domain}.`);
  await runWrangler([
    "deploy",
    "--no-bundle",
    "--config",
    target.configPath,
    "--name",
    target.workerName,
    "--assets",
    preflight.artifactDirectory,
  ], { environment, runner });
  const created = await currentDeployment(target, { environment, runner });
  const deployedVersionId = created.activeVersionId;
  console.log(`Created ${target.workerName} version ${deployedVersionId}; beginning bounded live verification at ${baseUrl}.`);
  const proof = await liveVerifier({
    baseUrl,
    artifactDirectory: preflight.artifactDirectory,
    expectedSourceRevision: preflight.artifact.manifest.sourceRevision,
    retryDelaysMs: FIRST_DEPLOY_LIVE_RETRY_DELAYS_MS,
    overallTimeoutMs: FIRST_DEPLOY_LIVE_TIMEOUT_MS,
  }).catch((error) => {
    const failure = asError(error);
    throw new Error(`${failure.message}; first ${target.workerName} deployment ${deployedVersionId} stays active — there is no earlier version to roll back to`, { cause: error });
  });
  console.log(`${target.workerName} live verification passed for first version ${deployedVersionId}: ${proof.routes.length} routes and ${proof.assets.length} assets.`);
  return { preflight, deployedVersionId, proof };
}

/**
 * Deploy the exact checked-in artifact, verify its live manifest/assets/routes,
 * and rollback only when the still-active version is this invocation's upload.
 * A smoke failure always remains a failed command even when rollback succeeds.
 *
 * @param {{ target?: DeployTarget, artifactDirectory?: string, expectedSourceRevision?: string, baseUrl?: string, environment?: Record<string, string | undefined>, runner?: typeof runCommand, artifactVerifier?: import("./targets.mjs").ArtifactVerifier, liveVerifier?: typeof verifyLiveWithRetries, retryDelaysMs?: number[], delayImpl?: (milliseconds: number) => Promise<void> }} [options]
 */
export async function deployHostedDemo({
  target = DEFAULT_TARGET,
  artifactDirectory = target.artifactDirectory,
  expectedSourceRevision,
  baseUrl = `https://${target.domain}`,
  environment = process.env,
  runner = runCommand,
  artifactVerifier = target.verifyArtifact,
  // Bind this invocation's target into the shared live verifier so callers
  // that override `liveVerifier` (tests) keep the plain three-key call below.
  liveVerifier = (liveOptions) => verifyLiveWithRetries({
    ...liveOptions,
    manifestFileName: target.manifestFileName,
    artifactVerifier: target.verifyArtifact,
    liveRoutes: target.liveRoutes,
    routeFile: target.routeFile,
    assetUrl: target.assetUrl,
  }),
  retryDelaysMs = DEPLOYMENT_RETRY_DELAYS_MS,
  delayImpl = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds)),
} = {}) {
  const preflight = await preflightDeployment({ target, artifactDirectory, expectedSourceRevision, environment, runner, artifactVerifier });
  if (preflight.state.firstDeploy) {
    return createFirstDeployment({ preflight, target, baseUrl, environment, runner, liveVerifier });
  }
  console.log(`Captured active deployment ${preflight.state.activeDeploymentId} (version ${preflight.state.activeVersionId}); rollback target ${preflight.state.rollbackVersionId}.`);

  let deployedVersionId;
  let activationAttempted = false;
  const rollout = rolloutIdentity(preflight.artifact.manifest.sourceRevision, environment);
  try {
    // Upload creates a known, inactive Version. Do not request activation until
    // Wrangler has returned that exact ID; a lost response therefore fails
    // safely before production traffic can change.
    const uploadResult = await runWrangler([
      "versions",
      "upload",
      "--no-bundle",
      "--config",
      target.configPath,
      "--name",
      target.workerName,
      "--tag",
      rollout.tag,
      "--message",
      rollout.message,
      "--assets",
      preflight.artifactDirectory,
    ], { environment, runner });
    deployedVersionId = parseUploadedVersionId(`${uploadResult.stdout}\n${uploadResult.stderr}`);
    assert.ok(deployedVersionId, "Wrangler versions upload did not return a version ID; refusing to activate an unknown upload");
    assertCapturedActive(await currentDeployment(target, { environment, runner }), preflight.state);

    // Set ownership before invoking the command. Wrangler can return a
    // non-zero exit after Cloudflare accepted the replacement, so the catch
    // path must still be able to prove and recover this exact version.
    assertCapturedActive(await currentDeployment(target, { environment, runner }), preflight.state);
    activationAttempted = true;
    await runWrangler([
      "versions",
      "deploy",
      `${deployedVersionId}@100`,
      "--name",
      target.workerName,
      "--config",
      target.configPath,
      "--message",
      rollout.message,
      "--yes",
    ], { environment, runner });
    await waitForVersion({ target, expectedVersionId: deployedVersionId, environment, runner, retryDelaysMs, delayImpl });
    console.log(`Uploaded ${target.workerName} version ${deployedVersionId}; beginning bounded live verification at ${baseUrl}.`);
    const proof = await liveVerifier({ baseUrl, artifactDirectory: preflight.artifactDirectory, expectedSourceRevision: preflight.artifact.manifest.sourceRevision });
    console.log(`${target.workerName} live verification passed for version ${deployedVersionId}: ${proof.routes.length} routes and ${proof.assets.length} assets.`);
    return { preflight, deployedVersionId, proof };
  } catch (error) {
    const failure = asError(error);
    if (!deployedVersionId || !activationAttempted) throw failure;

    try {
      const current = await currentDeployment(target, { environment, runner });
      assert.equal(current.activeVersionId, deployedVersionId, `Refusing automatic rollback: production now serves ${current.activeVersionId}, not this rollout ${deployedVersionId}`);
      await runWrangler([
        "rollback",
        preflight.state.rollbackVersionId,
        "--config",
        target.configPath,
        "--name",
        target.workerName,
        "--message",
        `automatic hosted demo rollback after failed ${deployedVersionId}`,
        "--yes",
      ], { environment, runner });
      await waitForVersion({ target, expectedVersionId: preflight.state.rollbackVersionId, environment, runner, retryDelaysMs, delayImpl });
      throw new Error(`${failure.message}; automatic rollback to ${preflight.state.rollbackVersionId} completed and was verified`, { cause: error });
    } catch (rollbackError) {
      const rollbackFailure = asError(rollbackError);
      if (rollbackFailure.message.startsWith(`${failure.message}; automatic rollback to ${preflight.state.rollbackVersionId} completed`)) throw rollbackFailure;
      throw new Error(`${failure.message}; automatic rollback failed or was refused: ${rollbackFailure.message}`, { cause: rollbackError });
    }
  }
}

/** @param {string[]} argv @returns {Record<string, string | undefined>} */
function parseArguments(argv) {
  /** @type {Record<string, string | undefined>} */
  const options = {};
  const args = [...argv];
  if (args[0] === "--") args.shift();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);
    const key = arg.slice(2).replaceAll("-", "_");
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
    options[key] = value;
    index += 1;
  }
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const options = parseArguments(process.argv.slice(2));
  const target = resolveTarget(options.target ?? process.env.HOSTED_DEMO_TARGET ?? DEFAULT_TARGET_KEY);
  await deployHostedDemo({
    target,
    artifactDirectory: options.artifact ?? process.env.HOSTED_DEMO_ARTIFACT,
    expectedSourceRevision: options.expected_sha ?? process.env.HOSTED_DEMO_EXPECTED_SHA,
    baseUrl: options.base_url ?? process.env.HOSTED_DEMO_BASE_URL,
  });
}
