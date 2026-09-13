// @vitest-environment node

import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  ARTIFACT_DIRECTORY,
  captureDeploymentState,
  deployHostedDemo,
  deploymentCredentialState,
  FIRST_DEPLOY_LIVE_RETRY_DELAYS_MS,
  FIRST_DEPLOY_LIVE_TIMEOUT_MS,
  parseUploadedVersionId,
  preflightDeployment,
  requireDeploymentCredentials,
  rolloutIdentity,
  sortDeploymentsNewestFirst,
} from "./deploy.mjs";
import { TARGET_KEYS, TARGETS } from "./targets.mjs";
import { sha256 } from "./artifact.mjs";

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
    tool: { name: "zudo-composer", version: "0.0.0" },
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

const siteArtifactVerifier = async ({ directory }: { directory: string }) => ({
  root: directory,
  manifest: { schemaVersion: 1, projectId: "demo-webshop", tool: { name: "zudo-composer", version: "0.0.0" }, sourceRevision: SOURCE_REVISION, projectSourceRevision: PROJECT_REVISION, routes: ["/", "/about"], files: {} },
  files: [],
});

/** A Worker Cloudflare has never seen: both listings fail until `deploy` creates it. */
function firstDeployRunner(options: { versionsListExists?: boolean } = {}) {
  const notFound = () => new Error("wrangler deployments list failed with exit 1:\nA request to the Cloudflare API failed. Worker not found. [code: 10007]");
  let exists = false;
  const calls: string[][] = [];
  const runner = async (_file: string, args: string[]) => {
    calls.push(args);
    if (args[0] === "whoami") return { stdout: "", stderr: "" };
    if (args[0] === "deploy" && args.includes("--dry-run")) return { stdout: "", stderr: "" };
    if (args[0] === "deploy") {
      exists = true;
      return { stdout: `Current Version ID: ${NEW_VERSION}\n`, stderr: "" };
    }
    if (args[0] === "deployments" && args[1] === "list") {
      if (!exists) throw notFound();
      return { stdout: JSON.stringify([deployment(NEW_VERSION, NEW_DEPLOYMENT, "2026-09-12T08:00:00Z")]), stderr: "" };
    }
    if (args[0] === "versions" && args[1] === "list") {
      if (!exists && !options.versionsListExists) throw notFound();
      return { stdout: JSON.stringify([{ id: NEW_VERSION }]), stderr: "" };
    }
    throw new Error(`Unexpected Wrangler command: ${args.join(" ")}`);
  };
  return { calls, runner };
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

  it("deploys a non-default target against its own Worker, config and domain", async () => {
    const target = TARGETS.webshop;
    const fake = fakeRunner();
    const liveVerifier = vi.fn(async () => ({ manifest: {}, routes: [], assets: [] }));
    const result = await deployHostedDemo({
      target,
      environment: ENVIRONMENT,
      runner: fake.runner,
      artifactVerifier: siteArtifactVerifier,
      liveVerifier,
      retryDelaysMs: [],
      delayImpl: async () => {},
    });
    expect(result.deployedVersionId).toBe(NEW_VERSION);
    expect(liveVerifier).toHaveBeenCalledWith({
      baseUrl: "https://zc-demo-shop.zudolab.dev",
      artifactDirectory: target.artifactDirectory,
      expectedSourceRevision: SOURCE_REVISION,
    });
    const upload = fake.calls.find((args) => args[0] === "versions" && args[1] === "upload");
    const activate = fake.calls.find((args) => args[0] === "versions" && args[1] === "deploy");
    const rollback = fake.calls.find((args) => args[0] === "deployments" && args[1] === "list");
    expect(upload).toEqual(expect.arrayContaining(["--config", "wrangler.demo-shop.jsonc", "--name", "zudo-composer-demo-shop"]));
    expect(activate).toEqual(expect.arrayContaining(["--name", "zudo-composer-demo-shop", "--config", "wrangler.demo-shop.jsonc"]));
    expect(rollback).toEqual(expect.arrayContaining(["--name", "zudo-composer-demo-shop", "--config", "wrangler.demo-shop.jsonc"]));
  });

  it.each(TARGET_KEYS)("deploys %s against its own Worker, config and domain", async (key) => {
    const target = TARGETS[key];
    const fake = fakeRunner();
    const liveVerifier = vi.fn(async () => ({ manifest: {}, routes: [], assets: [] }));
    const result = await deployHostedDemo({
      target,
      expectedSourceRevision: SOURCE_REVISION,
      environment: ENVIRONMENT,
      runner: fake.runner,
      artifactVerifier: siteArtifactVerifier,
      liveVerifier,
      retryDelaysMs: [],
      delayImpl: async () => {},
    });
    expect(result.deployedVersionId).toBe(NEW_VERSION);
    expect(liveVerifier).toHaveBeenCalledWith({
      baseUrl: `https://${target.domain}`,
      artifactDirectory: target.artifactDirectory,
      expectedSourceRevision: SOURCE_REVISION,
    });
    const upload = fake.calls.find((args) => args[0] === "versions" && args[1] === "upload");
    const activate = fake.calls.find((args) => args[0] === "versions" && args[1] === "deploy");
    expect(upload).toEqual(expect.arrayContaining(["--config", target.configPath, "--name", target.workerName]));
    expect(activate).toEqual(expect.arrayContaining(["--name", target.workerName, "--config", target.configPath]));
  });

  it.each([undefined, "short", `${SOURCE_REVISION}\n`])("requires the doc site's full expected source SHA before any Wrangler call: %j", async (expectedSourceRevision) => {
    const fake = fakeRunner();
    await expect(deployHostedDemo({
      target: TARGETS.doc,
      expectedSourceRevision,
      environment: ENVIRONMENT,
      runner: fake.runner,
      artifactVerifier: siteArtifactVerifier,
    })).rejects.toThrow(/full expected source Git SHA/);
    expect(fake.calls).toEqual([]);
  });

  it.each([undefined, "b".repeat(40)])("refuses an unpinned or mismatched doc artifact before any Wrangler call: %j", async (sourceRevision) => {
    const fake = fakeRunner();
    await expect(preflightDeployment({
      target: TARGETS.doc,
      expectedSourceRevision: SOURCE_REVISION,
      environment: ENVIRONMENT,
      runner: fake.runner,
      artifactVerifier: async ({ directory }) => ({ root: directory, manifest: { kind: "doc-site", sourceRevision }, files: [] }),
    })).rejects.toThrow(/must record the expected source Git SHA/);
    expect(fake.calls).toEqual([]);
  });

  it.each([["existing", fakeRunner], ["first", firstDeployRunner]] as const)("passes multi-page hooks to the default live verifier for an %s deployment", async (_label, createRunner) => {
    const fake = createRunner();
    const bodies = {
      "index.html": "<!doctype html><html><body>Home</body></html>",
      "docs/a/index.html": "<!doctype html><html><body>Document A</body></html>",
      "404.html": "<!doctype html><html><body>Not found</body></html>",
    };
    const files = Object.entries(bodies).map(([path, body]) => ({ path, sha256: sha256(Buffer.from(body)), mime: "text/html" }));
    const manifest = { sourceRevision: SOURCE_REVISION, routes: ["/", "/docs/a/"], files };
    const routeFile = vi.fn((route: string) => route === "/" ? "index.html" : "docs/a/index.html");
    const assetUrl = vi.fn((path: string) => path === "docs/a/index.html" ? null : path === "404.html" ? "/404" : "/");
    const target = {
      ...TARGETS.webshop,
      manifestFileName: "test-multi-page-manifest.json",
      verifyArtifact: async ({ directory }: { directory: string }) => ({ root: directory, manifest, files }),
      liveRoutes: (routeManifest: Record<string, unknown>) => routeManifest.routes as string[],
      routeFile,
      assetUrl,
    };
    const requests: string[] = [];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const path = new URL(input.toString()).pathname;
      requests.push(path);
      if (path === "/test-multi-page-manifest.json") return new Response(JSON.stringify(manifest), { headers: { "content-type": "application/json" } });
      const body = path === "/" ? bodies["index.html"] : path === "/docs/a/" ? bodies["docs/a/index.html"] : path === "/404" ? bodies["404.html"] : undefined;
      if (!body) throw new Error(`Unexpected asset URL: ${path}`);
      return new Response(body, { headers: { "content-type": "text/html" } });
    });
    try {
      const result = await deployHostedDemo({ target, environment: ENVIRONMENT, runner: fake.runner, retryDelaysMs: [], delayImpl: async () => {} });
      expect(result.deployedVersionId).toBe(NEW_VERSION);
      expect(result.proof.routes.map(({ path }) => path)).toEqual(["/", "/docs/a/"]);
      expect(result.proof.assets.map(({ path }) => path)).toEqual(["index.html", "404.html"]);
      expect(routeFile.mock.calls).toEqual([["/", manifest], ["/docs/a/", manifest]]);
      expect(assetUrl.mock.calls).toEqual([["index.html"], ["docs/a/index.html"], ["404.html"]]);
      expect(requests).toEqual(["/test-multi-page-manifest.json", "/", "/docs/a/", "/", "/404"]);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it.each(TARGET_KEYS)("creates a never-deployed %s target with wrangler deploy, binding its custom domain", async (key) => {
    const target = TARGETS[key];
    const fake = firstDeployRunner();
    const liveVerifier = vi.fn(async () => ({ manifest: {}, routes: ["/"], assets: [] }));
    const result = await deployHostedDemo({
      target,
      expectedSourceRevision: SOURCE_REVISION,
      environment: ENVIRONMENT,
      runner: fake.runner,
      artifactVerifier: siteArtifactVerifier,
      liveVerifier,
      retryDelaysMs: [],
      delayImpl: async () => {},
    });
    expect(result.deployedVersionId).toBe(NEW_VERSION);
    expect(result.preflight.state).toEqual({ firstDeploy: true });
    // A brand-new hostname gets a longer live-check budget than a rollout onto an
    // existing domain, whose DNS is already in place.
    expect(liveVerifier).toHaveBeenCalledWith({
      baseUrl: `https://${target.domain}`,
      artifactDirectory: target.artifactDirectory,
      expectedSourceRevision: SOURCE_REVISION,
      retryDelaysMs: FIRST_DEPLOY_LIVE_RETRY_DELAYS_MS,
      overallTimeoutMs: FIRST_DEPLOY_LIVE_TIMEOUT_MS,
    });
    // `versions upload` never applies a config's routes, so the bootstrap must be
    // a plain `deploy` — and there is nothing to roll back from "no Worker".
    const create = fake.calls.find((args) => args[0] === "deploy" && !args.includes("--dry-run"));
    expect(create).toEqual(expect.arrayContaining(["--config", target.configPath, "--name", target.workerName, "--assets", target.artifactDirectory]));
    expect(fake.calls.some((args) => args[0] === "versions" && args[1] === "upload")).toBe(false);
    expect(fake.calls.some((args) => args[0] === "rollback")).toBe(false);
  });

  it.each(TARGET_KEYS)("leaves a failed first %s deployment in place and says why no rollback happened", async (key) => {
    const target = TARGETS[key];
    const fake = firstDeployRunner();
    await expect(deployHostedDemo({
      target,
      expectedSourceRevision: SOURCE_REVISION,
      environment: ENVIRONMENT,
      runner: fake.runner,
      artifactVerifier: siteArtifactVerifier,
      liveVerifier: async () => { throw new Error("live route mismatch"); },
      retryDelaysMs: [],
    })).rejects.toThrow(new RegExp(`live route mismatch; first ${target.workerName} deployment ${NEW_VERSION} stays active`));
    expect(fake.calls.some((args) => args[0] === "rollback")).toBe(false);
  });

  it("refuses to treat a half-missing Worker as a first deployment", async () => {
    const fake = firstDeployRunner({ versionsListExists: true });
    await expect(deployHostedDemo({
      target: TARGETS.webshop,
      environment: ENVIRONMENT,
      runner: fake.runner,
      artifactVerifier: siteArtifactVerifier,
      retryDelaysMs: [],
    })).rejects.toThrow(/code: 10007/);
    expect(fake.calls.some((args) => args[0] === "deploy" && !args.includes("--dry-run"))).toBe(false);
  });

  it("rejects a webshop artifact directory that differs from its Wrangler config", async () => {
    await expect(preflightDeployment({
      target: TARGETS.webshop,
      artifactDirectory: join(TARGETS.webshop.artifactDirectory, "other"),
      environment: ENVIRONMENT,
      runner: vi.fn(),
      artifactVerifier: async ({ directory }: { directory: string }) => ({ root: directory, manifest: {}, files: [] }),
    })).rejects.toThrow(/zudo-composer-demo-shop deployment must verify and upload/);
  });
});
