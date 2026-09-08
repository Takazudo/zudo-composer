// @vitest-environment node

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { HOSTED_DEMO_LIVE_ROUTES, verifyLiveDeployment, verifyLiveWithRetries } from "./live-check.mjs";

const SOURCE_REVISION = "c".repeat(40);
const PROJECT_REVISION = "d".repeat(64);

async function writeArtifact() {
  const root = await mkdtemp(join(tmpdir(), "hosted-live-check-"));
  await mkdir(join(root, "assets"), { recursive: true });
  await mkdir(join(root, "uploaded-media"), { recursive: true });
  const files = new Map<string, Buffer>([
    ["index.html", Buffer.from("<!doctype html><html><body>live</body></html>\n")],
    ["hosted-demo-media-worker.js", Buffer.from("export default {};\n")],
    ["assets/preview-entry-test.js", Buffer.from("export const preview = true;\n")],
  ]);
  for (const content of [Buffer.from("one"), Buffer.from("two"), Buffer.from("three"), Buffer.from("four")]) {
    files.set(`uploaded-media/sha256-${createHash("sha256").update(content).digest("hex")}.png`, content);
  }
  const assets = Object.fromEntries([...files].map(([path, content]) => [path, createHash("sha256").update(content).digest("hex")]));
  await Promise.all([...files].map(([path, content]) => writeFile(join(root, path), content)));
  const manifest = { schemaVersion: 1, sourceRevision: SOURCE_REVISION, projectSourceRevision: PROJECT_REVISION, mode: "disposable-hosted-demo", assets };
  await writeFile(join(root, "hosted-demo-manifest.json"), JSON.stringify(manifest));
  return { root, manifest, files };
}

function response(body: string | Buffer, mime: string, status = 200) {
  return new Response(body, { status, headers: { "content-type": mime } });
}

function mockFetch(fixture: Awaited<ReturnType<typeof writeArtifact>>, options: { corruptPath?: string; staleManifest?: boolean } = {}) {
  const requests: Array<{ url: URL; path: string; init: RequestInit | undefined }> = [];
  const fetchImpl = async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(input.toString());
    const path = url.pathname;
    requests.push({ url, path, init });
    if (path === "/hosted-demo-manifest.json") {
      const manifest = options.staleManifest ? { ...fixture.manifest, sourceRevision: "e".repeat(40) } : fixture.manifest;
      return response(JSON.stringify(manifest), "application/json");
    }
    if (HOSTED_DEMO_LIVE_ROUTES.includes(path)) return response(fixture.files.get("index.html")!, "text/html");
    const relative = path.slice(1);
    const bytes = fixture.files.get(relative);
    if (!bytes) return response("missing", "text/plain", 404);
    if (relative === options.corruptPath) return response(Buffer.from("changed"), relative.endsWith(".png") ? "image/png" : "text/javascript");
    return response(bytes, relative.endsWith(".png") ? "image/png" : "text/javascript");
  };
  return { fetchImpl, requests };
}

const fixtures: string[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("hosted demo live verification", () => {
  it("checks the exact manifest, routes and assets and separates navigation headers", async () => {
    const fixture = await writeArtifact();
    fixtures.push(fixture.root);
    const mock = mockFetch(fixture);
    const proof = await verifyLiveDeployment({
      baseUrl: "https://demo.example.test",
      artifactDirectory: fixture.root,
      expectedSourceRevision: SOURCE_REVISION,
      fetchImpl: mock.fetchImpl,
    });
    expect(proof.routes.map(({ path }) => path)).toEqual(HOSTED_DEMO_LIVE_ROUTES);
    expect(proof.assets).toHaveLength(6);
    const routeRequest = mock.requests.find(({ path }) => path === "/composer");
    expect(routeRequest?.init?.headers).toEqual({ accept: "text/html", "sec-fetch-mode": "navigate" });
    const assetRequest = mock.requests.find(({ path }) => path.startsWith("/uploaded-media/"));
    expect(assetRequest?.init?.headers).toEqual({});
    expect(mock.requests.every(({ url }) => url.searchParams.get("hosted-demo-revision") === SOURCE_REVISION)).toBe(true);
  });

  it("rejects stale manifests and changed asset bytes", async () => {
    const fixture = await writeArtifact();
    fixtures.push(fixture.root);
    await expect(verifyLiveDeployment({
      baseUrl: "https://demo.example.test",
      artifactDirectory: fixture.root,
      expectedSourceRevision: SOURCE_REVISION,
      fetchImpl: mockFetch(fixture, { staleManifest: true }).fetchImpl,
    })).rejects.toThrow(/manifest does not match/);
    const assetPath = [...fixture.files.keys()].find((path) => path.startsWith("uploaded-media/"))!;
    await expect(verifyLiveDeployment({
      baseUrl: "https://demo.example.test",
      artifactDirectory: fixture.root,
      expectedSourceRevision: SOURCE_REVISION,
      fetchImpl: mockFetch(fixture, { corruptPath: assetPath }).fetchImpl,
    })).rejects.toThrow(/response SHA-256 does not match/);
  });

  it("retries transient live failures within the caller's bounded delay policy", async () => {
    const fixture = await writeArtifact();
    fixtures.push(fixture.root);
    let attempt = 0;
    const retries: Array<{ attempt: number; delayMs: number }> = [];
    const proof = await verifyLiveWithRetries({
      baseUrl: "https://demo.example.test",
      artifactDirectory: fixture.root,
      expectedSourceRevision: SOURCE_REVISION,
      fetchImpl: async (input, init) => {
        const url = new URL(input.toString());
        if (url.pathname === "/hosted-demo-manifest.json" && attempt++ === 0) return mockFetch(fixture, { staleManifest: true }).fetchImpl(input, init);
        return mockFetch(fixture).fetchImpl(input, init);
      },
      retryDelaysMs: [25],
      delayImpl: async () => {},
      onRetry: ({ attempt: retryAttempt, delayMs }) => retries.push({ attempt: retryAttempt, delayMs }),
    });
    expect(proof.routes).toHaveLength(HOSTED_DEMO_LIVE_ROUTES.length);
    expect(retries).toEqual([{ attempt: 1, delayMs: 25 }]);
  });
});
