// @ts-check

import assert from "node:assert/strict";
import { appendFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SHA_PATTERN = /^[a-f0-9]{40}$/;
export const WORKFLOW_API_TIMEOUT_MS = 10_000;

/**
 * Validate the event fields that are allowed to select a production artifact.
 * This function is deliberately pure so operational failure paths can be
 * tested with mocked workflow-run JSON without invoking GitHub or git.
 *
 * @param {Record<string, string | undefined>} environment
 * @returns {{ repository: string, sha: string, runId: string, eventName: string }}
 */
export function validateTrustedRun(environment) {
  const eventName = environment.GITHUB_EVENT_NAME;
  const repository = environment.GITHUB_REPOSITORY;
  assert.ok(typeof repository === "string" && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository), "GITHUB_REPOSITORY must be owner/name");

  if (eventName === "workflow_run") {
    assert.equal(environment.HOSTED_DEMO_WORKFLOW_EVENT, "push", "Hosted deployment requires a push workflow run");
    assert.equal(environment.HOSTED_DEMO_HEAD_BRANCH, "main", "Hosted deployment requires the main branch");
    assert.equal(environment.HOSTED_DEMO_HEAD_REPOSITORY, repository, "Hosted deployment refuses a workflow run from another repository");
    assert.equal(environment.HOSTED_DEMO_CONCLUSION, "success", "Hosted deployment requires a successful CI workflow run");
  } else if (eventName === "workflow_dispatch") {
    assert.ok(environment.HOSTED_DEMO_DISPATCH_RUN_ID, "Manual hosted deployment requires a CI run_id");
    assert.ok(environment.HOSTED_DEMO_DISPATCH_SHA, "Manual hosted deployment requires a CI sha");
  } else {
    throw new Error(`Hosted deployment is unavailable for event ${eventName ?? "<missing>"}`);
  }

  const sha = eventName === "workflow_dispatch" ? environment.HOSTED_DEMO_DISPATCH_SHA : environment.HOSTED_DEMO_HEAD_SHA;
  const runId = eventName === "workflow_dispatch" ? environment.HOSTED_DEMO_DISPATCH_RUN_ID : environment.HOSTED_DEMO_RUN_ID;
  assert.ok(typeof sha === "string", "Trusted CI head SHA is required");
  assert.ok(typeof runId === "string", "Trusted CI run ID is required");
  assert.match(sha, SHA_PATTERN, "Trusted CI head SHA must be a full 40-character commit SHA");
  assert.match(runId, /^\d+$/, "Trusted CI run ID must be numeric");
  return { repository, sha, runId, eventName };
}

/** @param {unknown} value @param {string} label @returns {Record<string, unknown>} */
function record(value, label) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return /** @type {Record<string, unknown>} */ (value);
}

/**
 * Check the run selected by a manual dispatch (and re-check the event run)
 * through GitHub's read-only Actions API. The Cloudflare credentials are not
 * available to this step.
 *
 * @param {{ repository: string, runId: string, sha: string, token: string, fetchImpl?: typeof fetch }} options
 */
export async function verifyWorkflowRunApi({ repository, runId, sha, token, fetchImpl = globalThis.fetch }) {
  assert.ok(token.trim(), "GITHUB_TOKEN is required to verify the CI workflow run");
  const response = await fetchImpl(`https://api.github.com/repos/${repository}/actions/runs/${runId}`, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
    },
    redirect: "error",
    signal: globalThis.AbortSignal.timeout(WORKFLOW_API_TIMEOUT_MS),
  });
  assert.ok(response.ok, `GitHub workflow-run lookup failed with HTTP ${response.status}`);
  const run = record(await response.json(), "GitHub workflow-run response");
  assert.equal(String(run.id), runId, "Selected Actions run ID differs from the trusted input");
  assert.equal(run.name, "CI", "Selected Actions run is not the repository CI workflow");
  assert.equal(run.event, "push", "Selected Actions run was not triggered by a push");
  assert.equal(run.head_branch, "main", "Selected Actions run did not build main");
  assert.equal(record(run.repository, "workflow repository").full_name, repository, "Selected Actions run belongs to another repository");
  assert.equal(run.conclusion, "success", "Selected Actions run did not succeed");
  assert.equal(run.head_sha, sha, "Selected Actions run SHA differs from the trusted checkout");
  return run;
}

/** @param {{ expectedSha: string, runCommand?: (file: string, args: string[]) => Promise<{ stdout: string }> }} options */
export async function verifyMainHead({ expectedSha, runCommand = async (file, args) => execFileAsync(file, args) }) {
  const { stdout } = await runCommand("git", ["ls-remote", "origin", "refs/heads/main"]);
  const mainSha = stdout.trim().split(/\s+/)[0] ?? "";
  assert.match(mainSha, SHA_PATTERN, "Could not resolve origin/main to a full commit SHA");
  assert.equal(mainSha, expectedSha, "Trusted CI SHA is stale: origin/main moved before deployment");
  return mainSha;
}

/** @param {Record<string, string | undefined>} environment @param {{ fetchImpl?: typeof fetch, runCommand?: (file: string, args: string[]) => Promise<{ stdout: string }> }} [dependencies] */
export async function guardWorkflow(environment, dependencies = {}) {
  const trusted = validateTrustedRun(environment);
  await verifyWorkflowRunApi({
    repository: trusted.repository,
    runId: trusted.runId,
    sha: trusted.sha,
    token: environment.GITHUB_TOKEN ?? "",
    fetchImpl: dependencies.fetchImpl,
  });
  await verifyMainHead({ expectedSha: trusted.sha, runCommand: dependencies.runCommand });
  return trusted;
}

if (process.argv[1]?.endsWith("workflow-guard.mjs")) {
  const trusted = await guardWorkflow(process.env);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `sha=${trusted.sha}\nrun_id=${trusted.runId}\n`);
  console.log(`Trusted CI run ${trusted.runId} selected at ${trusted.sha}; origin/main is current.`);
}
