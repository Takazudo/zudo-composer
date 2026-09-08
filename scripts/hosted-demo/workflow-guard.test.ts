// @vitest-environment node

import { describe, expect, it } from "vitest";
import { guardWorkflow, validateTrustedRun, verifyMainHead, verifyWorkflowRunApi } from "./workflow-guard.mjs";

const SHA = "a".repeat(40);
const OTHER_SHA = "b".repeat(40);
const baseEnvironment = {
  GITHUB_EVENT_NAME: "workflow_run",
  GITHUB_REPOSITORY: "Takazudo/zudo-composer",
  HOSTED_DEMO_WORKFLOW_EVENT: "push",
  HOSTED_DEMO_HEAD_BRANCH: "main",
  HOSTED_DEMO_HEAD_REPOSITORY: "Takazudo/zudo-composer",
  HOSTED_DEMO_CONCLUSION: "success",
  HOSTED_DEMO_HEAD_SHA: SHA,
  HOSTED_DEMO_RUN_ID: "34267634566",
  GITHUB_TOKEN: "github-token",
};

function successfulRun(sha = SHA) {
  return {
    id: 34267634566,
    name: "CI",
    event: "push",
    head_branch: "main",
    head_sha: sha,
    conclusion: "success",
    repository: { full_name: "Takazudo/zudo-composer" },
  };
}

describe("hosted demo trusted workflow guard", () => {
  it("accepts only a successful same-repository main push", () => {
    expect(validateTrustedRun(baseEnvironment)).toEqual({
      repository: "Takazudo/zudo-composer",
      sha: SHA,
      runId: "34267634566",
      eventName: "workflow_run",
    });
    expect(() => validateTrustedRun({ ...baseEnvironment, HOSTED_DEMO_WORKFLOW_EVENT: "pull_request" })).toThrow(/push workflow/);
    expect(() => validateTrustedRun({ ...baseEnvironment, HOSTED_DEMO_HEAD_REPOSITORY: "attacker/fork" })).toThrow(/another repository/);
    expect(() => validateTrustedRun({ ...baseEnvironment, HOSTED_DEMO_CONCLUSION: "failure" })).toThrow(/successful CI/);
    expect(() => validateTrustedRun({ ...baseEnvironment, HOSTED_DEMO_HEAD_SHA: OTHER_SHA.slice(0, 39) })).toThrow(/full 40/);
  });

  it("requires explicit run and SHA for manual dispatch", () => {
    expect(validateTrustedRun({
      ...baseEnvironment,
      GITHUB_EVENT_NAME: "workflow_dispatch",
      HOSTED_DEMO_DISPATCH_RUN_ID: "34267634566",
      HOSTED_DEMO_DISPATCH_SHA: SHA,
    })).toMatchObject({ eventName: "workflow_dispatch", runId: "34267634566", sha: SHA });
    expect(() => validateTrustedRun({ ...baseEnvironment, GITHUB_EVENT_NAME: "workflow_dispatch" })).toThrow(/run_id/);
    expect(() => validateTrustedRun({ ...baseEnvironment, GITHUB_EVENT_NAME: "pull_request" })).toThrow(/unavailable/);
  });

  it("checks the selected CI run through mocked GitHub JSON and rejects stale SHA", async () => {
    const requests: string[] = [];
    const fetchImpl = async (input: URL | RequestInfo) => {
      requests.push(String(input));
      return new Response(JSON.stringify(successfulRun()), { headers: { "content-type": "application/json" } });
    };
    await expect(verifyWorkflowRunApi({
      repository: "Takazudo/zudo-composer",
      runId: "34267634566",
      sha: SHA,
      token: "github-token",
      fetchImpl,
    })).resolves.toMatchObject({ head_sha: SHA });
    expect(requests[0]).toContain("/actions/runs/34267634566");
    await expect(verifyWorkflowRunApi({
      repository: "Takazudo/zudo-composer",
      runId: "34267634566",
      sha: OTHER_SHA,
      token: "github-token",
      fetchImpl,
    })).rejects.toThrow(/differs/);
  });

  it("fails before deployment if origin/main moved", async () => {
    await expect(verifyMainHead({
      expectedSha: SHA,
      runCommand: async () => ({ stdout: `${OTHER_SHA}\trefs/heads/main\n` }),
    })).rejects.toThrow(/stale/);
  });

  it("combines event, API and fresh-main checks", async () => {
    const trusted = await guardWorkflow(baseEnvironment, {
      fetchImpl: async () => new Response(JSON.stringify(successfulRun())),
      runCommand: async () => ({ stdout: `${SHA}\trefs/heads/main\n` }),
    });
    expect(trusted).toMatchObject({ runId: "34267634566", sha: SHA });
  });
});
