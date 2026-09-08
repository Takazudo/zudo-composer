// @vitest-environment node

import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  ARTIFACT_DIRECTORY,
  captureDeploymentState,
  deployHostedDemo,
  deploymentCredentialState,
  parseUploadedVersionId,
  preflightDeployment,
  requireDeploymentCredentials,
  rolloutIdentity,
  sortDeploymentsNewestFirst,
} from "./deploy.mjs";

const SOURCE_REVISION = "a".repeat(40);
const PROJECT_REVISION = "b".repeat(64);
const OLD_VERSION = "11111111-1111-4111-8111-111111111111";
const NEW_VERSION = "22222222-2222-4222-8222-222222222222";
const EXTERNAL_VERSION = "33333333-3333-4333-8333-333333333333";
const OLD_DEPLOYMENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NEW_DEPLOYMENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ENVIRONMENT = {
  CLOUDFLARE_API_TOKEN: "test-token",
  CLOUDFLARE_ACCOUNT_ID: "test-account",
  HOSTED_DEMO_RUN_ID: "12345",
};

const artifactVerifier = async ({ directory }: { directory: string }) => ({
  root: directory,
  manifest: {
    schemaVersion: 1,
    sourceRevision: SOURCE_REVISION,
    projectSourceRevision: PROJECT_REVISION,
    mode: "disposable-hosted-demo",
    assets: {},
  },
  files: [],
});

function deployment(versionId: string, id: string, createdOn: string) {
  return { id, created_on: createdOn, versions: [{ version_id: versionId, percentage: 100 }] };
}

function fakeRunner(options: { uploadOutput?: string; failAfterAccept?: boolean } = {}) {
  let activeVersion = OLD_VERSION;
  const calls: string[][] = [];
  const runner = async (_file: string, args: string[]) => {
    calls.push(args);
    if (args[0] === "whoami") return { stdout: "", stderr: "" };
    if (args[0] === "deploy" && args.includes("--dry-run")) return { stdout: "", stderr: "" };
    if (args[0] === "deployments" && args[1] === "list") {
      const id = activeVersion === OLD_VERSION ? OLD_DEPLOYMENT : NEW_DEPLOYMENT;
      return { stdout: JSON.stringify([deployment(activeVersion, id, activeVersion === OLD_VERSION ? "2026-09-07T08:00:00Z" : "2026-09-09T08:00:00Z")]), stderr: "" };
    }
    if (args[0] === "versions" && args[1] === "list") {
      return { stdout: JSON.stringify([{ id: OLD_VERSION }, { id: NEW_VERSION }]), stderr: "" };
    }
    if (args[0] === "versions" && args[1] === "upload") {
      return { stdout: options.uploadOutput ?? `Worker Version ID: ${NEW_VERSION}\n`, stderr: "" };
    }
    if (args[0] === "versions" && args[1] === "deploy") {
      activeVersion = NEW_VERSION;
      if (options.failAfterAccept) throw new Error("CLI disconnected after accepted replacement");
      return { stdout: "", stderr: "" };
    }
    if (args[0] === "rollback") {
      activeVersion = args[1]!;
      return { stdout: "", stderr: "" };
    }
    throw new Error(`Unexpected Wrangler command: ${args.join(" ")}`);
  };
  return { calls, runner, get activeVersion() { return activeVersion; }, set activeVersion(value: string) { activeVersion = value; } };
}

describe("hosted demo deployment guard", () => {
  it("requires both Cloudflare credentials and never prints a token", () => {
    expect(deploymentCredentialState({})).toBe("absent");
    expect(deploymentCredentialState({ CLOUDFLARE_API_TOKEN: "token" })).toBe("partial");
    expect(deploymentCredentialState({ CLOUDFLARE_ACCOUNT_ID: "account" })).toBe("partial");
    expect(deploymentCredentialState(ENVIRONMENT)).toBe("complete");
    expect(requireDeploymentCredentials(ENVIRONMENT)).toEqual({ token: "test-token", accountId: "test-account" });
    expect(deploymentCredentialState({ CLOUDFLARE_API_TOKEN: "", CLOUDFLARE_TOKEN: "alias-token", CLOUDFLARE_ACCOUNT_ID: "account" })).toBe("complete");
    expect(requireDeploymentCredentials({ CLOUDFLARE_API_TOKEN: " ", CLOUDFLARE_TOKEN: "alias-token", CLOUDFLARE_ACCOUNT_ID: "account" })).toEqual({ token: "alias-token", accountId: "account" });
    expect(() => requireDeploymentCredentials({ CLOUDFLARE_API_TOKEN: "token" })).toThrow(/Partial Cloudflare/);
  });

  it("sorts Wrangler's ascending deployments and captures the active version as rollback target", () => {
    const state = captureDeploymentState({
      deployments: [
        deployment("old-old", "old-deployment", "2026-09-06T08:00:00Z"),
        deployment(OLD_VERSION, OLD_DEPLOYMENT, "2026-09-07T08:00:00Z"),
      ],
      versions: [{ id: OLD_VERSION }],
    });
    expect(sortDeploymentsNewestFirst([
      { id: "old", created_on: "2026-09-06T08:00:00Z" },
      { id: "new", created_on: "2026-09-07T08:00:00Z" },
    ]).map((item) => item.id)).toEqual(["new", "old"]);
    expect(state).toMatchObject({
      activeDeploymentId: OLD_DEPLOYMENT,
      activeVersionId: OLD_VERSION,
      rollbackDeploymentId: OLD_DEPLOYMENT,
      rollbackVersionId: OLD_VERSION,
    });
  });

  it("refuses missing, split, or unlisted active deployment state before mutation", () => {
    expect(() => captureDeploymentState({ deployments: [], versions: [] })).toThrow(/no deployments/);
    expect(() => captureDeploymentState({ deployments: [
      { id: OLD_DEPLOYMENT, created_on: "2026-09-07T08:00:00Z", versions: [
        { version_id: OLD_VERSION, percentage: 50 },
        { version_id: NEW_VERSION, percentage: 50 },
      ] },
    ], versions: [{ id: OLD_VERSION }, { id: NEW_VERSION }] })).toThrow(/single version/);
    expect(() => captureDeploymentState({ deployments: [deployment(OLD_VERSION, OLD_DEPLOYMENT, "2026-09-07T08:00:00Z")], versions: [] })).toThrow(/not present/);
  });

  it("parses only an upload response and does not invent an ID from empty output", () => {
    expect(parseUploadedVersionId(`Total Upload: 1 KiB\nWorker Version ID: ${NEW_VERSION}`)).toBe(NEW_VERSION);
    expect(parseUploadedVersionId(JSON.stringify({ version_id: NEW_VERSION }))).toBe(NEW_VERSION);
    expect(parseUploadedVersionId("Current Version ID: 33333333-3333-4333-8333-333333333333")).toBeUndefined();
    expect(parseUploadedVersionId("")) .toBeUndefined();
    expect(rolloutIdentity(SOURCE_REVISION, ENVIRONMENT)).toEqual({
      tag: `hosted-demo-12345-${SOURCE_REVISION.slice(0, 12)}`,
      message: `hosted demo ${SOURCE_REVISION} (hosted-demo-12345-${SOURCE_REVISION.slice(0, 12)})`,
    });
  });

  it("rejects an artifact directory that differs from the Wrangler config", async () => {
    await expect(preflightDeployment({
      artifactDirectory: join(ARTIFACT_DIRECTORY, "other"),
      environment: ENVIRONMENT,
      runner: vi.fn(),
    })).rejects.toThrow(/must verify and upload/);
  });

  it("uploads first, activates only the returned version, and verifies live proof", async () => {
    const fake = fakeRunner();
    const liveVerifier = vi.fn(async () => ({ manifest: {}, routes: [], assets: [] }));
    const result = await deployHostedDemo({
      artifactDirectory: ARTIFACT_DIRECTORY,
      expectedSourceRevision: SOURCE_REVISION,
      environment: ENVIRONMENT,
      runner: fake.runner,
      artifactVerifier,
      liveVerifier,
      retryDelaysMs: [],
      delayImpl: async () => {},
    });
    expect(result.deployedVersionId).toBe(NEW_VERSION);
    expect(liveVerifier).toHaveBeenCalledWith({
      baseUrl: "https://zudo-composer.zudolab.dev",
      artifactDirectory: ARTIFACT_DIRECTORY,
      expectedSourceRevision: SOURCE_REVISION,
    });
    const upload = fake.calls.find((args) => args[0] === "versions" && args[1] === "upload");
    const activate = fake.calls.find((args) => args[0] === "versions" && args[1] === "deploy");
    expect(upload).toEqual(expect.arrayContaining(["--assets", ARTIFACT_DIRECTORY, "--tag", `hosted-demo-12345-${SOURCE_REVISION.slice(0, 12)}`]));
    expect(activate).toEqual(expect.arrayContaining([`${NEW_VERSION}@100`, "--yes"]));
  });

  it("fails safely without activation when upload output has no known version ID", async () => {
    const fake = fakeRunner({ uploadOutput: "Total Upload: 1 KiB\n" });
    await expect(deployHostedDemo({
      artifactDirectory: ARTIFACT_DIRECTORY,
      expectedSourceRevision: SOURCE_REVISION,
      environment: ENVIRONMENT,
      runner: fake.runner,
      artifactVerifier,
      retryDelaysMs: [],
    })).rejects.toThrow(/did not return a version ID/);
    expect(fake.calls.some((args) => args[0] === "versions" && args[1] === "deploy")).toBe(false);
    expect(fake.calls.some((args) => args[0] === "rollback")).toBe(false);
  });

  it("refuses activation when another deployment appears during upload", async () => {
    const fake = fakeRunner();
    const originalRunner = fake.runner;
    const runner = async (file: string, args: string[], options: unknown) => {
      const result = await originalRunner(file, args, options);
      if (args[0] === "versions" && args[1] === "upload") fake.activeVersion = EXTERNAL_VERSION;
      return result;
    };
    await expect(deployHostedDemo({
      artifactDirectory: ARTIFACT_DIRECTORY,
      expectedSourceRevision: SOURCE_REVISION,
      environment: ENVIRONMENT,
      runner,
      artifactVerifier,
      retryDelaysMs: [],
    })).rejects.toThrow(/active deployment changed/);
    expect(fake.calls.some((args) => args[0] === "versions" && args[1] === "deploy")).toBe(false);
    expect(fake.calls.some((args) => args[0] === "rollback")).toBe(false);
  });

  it("rolls back the captured active version after a live failure", async () => {
    const fake = fakeRunner();
    await expect(deployHostedDemo({
      artifactDirectory: ARTIFACT_DIRECTORY,
      expectedSourceRevision: SOURCE_REVISION,
      environment: ENVIRONMENT,
      runner: fake.runner,
      artifactVerifier,
      liveVerifier: async () => { throw new Error("live asset mismatch"); },
      retryDelaysMs: [],
    })).rejects.toThrow(new RegExp(`live asset mismatch; automatic rollback to ${OLD_VERSION} completed and was verified`));
    const rollback = fake.calls.find((args) => args[0] === "rollback");
    expect(rollback).toEqual(expect.arrayContaining([OLD_VERSION, "--yes"]));
    expect(fake.activeVersion).toBe(OLD_VERSION);
  });

  it("recovers a CLI failure after Cloudflare accepted the known replacement", async () => {
    const fake = fakeRunner({ failAfterAccept: true });
    await expect(deployHostedDemo({
      artifactDirectory: ARTIFACT_DIRECTORY,
      expectedSourceRevision: SOURCE_REVISION,
      environment: ENVIRONMENT,
      runner: fake.runner,
      artifactVerifier,
      retryDelaysMs: [],
    })).rejects.toThrow(/CLI disconnected after accepted replacement; automatic rollback/);
    expect(fake.calls.filter((args) => args[0] === "rollback")).toHaveLength(1);
    expect(fake.activeVersion).toBe(OLD_VERSION);
  });

  it("refuses rollback when production no longer serves this run's version", async () => {
    const fake = fakeRunner();
    await expect(deployHostedDemo({
      artifactDirectory: ARTIFACT_DIRECTORY,
      expectedSourceRevision: SOURCE_REVISION,
      environment: ENVIRONMENT,
      runner: fake.runner,
      artifactVerifier,
      liveVerifier: async () => {
        fake.activeVersion = EXTERNAL_VERSION;
        throw new Error("live route mismatch");
      },
      retryDelaysMs: [],
    })).rejects.toThrow(/Refusing automatic rollback/);
    expect(fake.calls.some((args) => args[0] === "rollback")).toBe(false);
  });
});
